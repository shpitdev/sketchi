import { assert, describe, expect, it, layer, vi } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { candidateFromText, responseErrorDiagnostic } from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
  type CloudflareAiGateway,
  CloudflareAiGatewayBinding,
  CloudflareGoogleAiStudioClientLive,
  CloudflareGoogleAiStudioConfig,
} from "./cloudflare-google-ai-studio.js";
import {
  buildGeminiGenerateContentBody,
  stripCloudflareGoogleModelPrefix,
} from "./gemini.js";
import {
  buildDiagramGenerationMessages,
  DiagramGenerationPrompt,
} from "./messages.js";

const prompt: DiagramGenerationPrompt = {
  id: "pharma-batch-disposition",
  request:
    "Create a flowchart for pharma batch disposition. A batch is received, QA reviews the Certificate of Analysis, and then decides whether it passes specs. Passing goes to QA Manager final review and packaging. Retest goes through investigation and returns to final review. Reject ends at reject batch.",
  requiredBranchLabels: ["yes", "retest", "reject"],
  requiredNodeLabels: [
    "Batch received",
    "QA reviews Certificate of Analysis",
    "Passes specs?",
    "QA Manager final review",
    "Send to packaging",
    "Investigate retesting",
    "Reject batch",
  ],
  title: "Pharma batch disposition",
};
const expectedDiagram = {
  id: "pharma-batch-disposition-fixture",
  title: "Pharma batch disposition",
  type: "flowchart",
  nodes: [
    { id: "received", label: "Batch received", kind: "start" },
    { id: "packaging", label: "Send to packaging", kind: "end" },
  ],
  edges: [
    {
      id: "received-to-packaging",
      source: "received",
      target: "packaging",
    },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
  style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
};
const expectedText = JSON.stringify(expectedDiagram, null, 2);
const expectedSystem = [
  "You are creating a Sketchi typed intermediate diagram.",
  "",
  "Flowchart IR rules:",
  "- Return only JSON. Do not wrap the JSON in markdown.",
  '- Use type "flowchart".',
  '- Every node must have id, label, and kind: "start", "process", "decision", or "end".',
  "- Use exactly one start node and at least one end node.",
  "- Every non-end node must have at least one outgoing edge.",
  "- Every end node must have zero outgoing edges.",
  "- Every decision node must have at least two outgoing edges.",
  "- Every outgoing edge from a decision node must have a non-empty unique label.",
  "- Edges must use existing node ids.",
  '- Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the prompt says otherwise.',
].join("\n");
const expectedUser = [
  "Scenario:",
  prompt.request,
  "",
  "Required node labels:",
  ...prompt.requiredNodeLabels.map((label) => `- ${label}`),
  "",
  "Required decision branch labels:",
  ...prompt.requiredBranchLabels.map((label) => `- ${label}`),
  "",
  "Use these required labels exactly unless the scenario explicitly asks for a clearer synonym.",
  "",
  "Expected JSON shape:",
  JSON.stringify(
    {
      id: "short-kebab-case-id",
      title: "Pharma batch disposition",
      type: "flowchart",
      nodes: [
        { id: "start-id", label: "Human label", kind: "start" },
        { id: "decision-id", label: "Question?", kind: "decision" },
      ],
      edges: [
        {
          id: "edge-id",
          source: "decision-id",
          target: "target-id",
          label: "yes",
        },
      ],
      layout: { direction: "TB", edgeRouting: "orthogonal" },
      style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
    },
    null,
    2,
  ),
].join("\n");
const expectedGeminiBody = {
  contents: [{ role: "user", parts: [{ text: expectedUser }] }],
  generationConfig: {
    maxOutputTokens: 512,
    response_mime_type: "application/json",
    temperature: 0.2,
  },
  system_instruction: { parts: [{ text: expectedSystem }] },
};
const geminiResponse = {
  candidates: [
    {
      content: { role: "model", parts: [{ text: expectedText }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    candidatesTokenCount: 23,
    promptTokenCount: 11,
    totalTokenCount: 34,
  },
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const configLayer = Layer.succeed(CloudflareGoogleAiStudioConfig, {
  collectLog: true,
  gatewayId: "sketchi",
});
const retryPolicyLayer = Layer.succeed(DiagramGenerationPolicy, {
  concurrency: 2,
  maxRetries: 2,
  requestTimeoutMs: 1_000,
  retryDelayMs: 100,
});
const cancellationPolicyLayer = Layer.succeed(DiagramGenerationPolicy, {
  concurrency: 2,
  maxRetries: 1,
  requestTimeoutMs: 500,
  retryDelayMs: 100,
});

describe("diagram generation prompt mapping", () => {
  it.effect.prop(
    "round-trips generated prompt contracts through their encoded form",
    { generatedPrompt: DiagramGenerationPrompt },
    ({ generatedPrompt }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(DiagramGenerationPrompt)(
          generatedPrompt,
        );
        const decoded = yield* Schema.decodeUnknownEffect(
          DiagramGenerationPrompt,
        )(encoded);
        assert.deepStrictEqual(decoded, generatedPrompt);
      }),
  );

  it("keeps the provider-facing prompt messages byte-for-byte stable", () => {
    expect(buildDiagramGenerationMessages(prompt)).toEqual({
      messages: [
        { role: "system", content: expectedSystem },
        { role: "user", content: expectedUser },
      ],
      system: expectedSystem,
      user: expectedUser,
    });
  });

  it("keeps the Gemini REST body byte-for-byte stable", () => {
    expect(
      buildGeminiGenerateContentBody({
        maxOutputTokens: 512,
        model: "google/gemini-3.1-flash-lite",
        prompt,
        temperature: 0.2,
      }),
    ).toEqual(expectedGeminiBody);
  });

  it("normalizes Cloudflare Google model ids for provider-native calls", () => {
    expect(
      stripCloudflareGoogleModelPrefix("google/gemini-3.1-flash-lite"),
    ).toBe("gemini-3.1-flash-lite");
    expect(
      stripCloudflareGoogleModelPrefix(
        "google-ai-studio/gemini-3.1-flash-lite",
      ),
    ).toBe("gemini-3.1-flash-lite");
  });
});

describe("pure candidate behavior", () => {
  it("preserves explicit provider errors instead of replacing them with parse errors", () => {
    const candidate = candidateFromText({
      diagnostics: ["Google AI Studio Gateway request failed with HTTP 401."],
      error: "HTTP 401",
      model: "gemini-3.1-flash-lite",
      provider: "cloudflare-google-ai-studio",
      text: "",
    });

    expect(candidate.error).toBe("HTTP 401");
    expect(candidate.diagnostics).toContain(
      "Google AI Studio Gateway request failed with HTTP 401.",
    );
  });

  it("extracts common provider error diagnostics from HTTP response bodies", () => {
    expect(
      responseErrorDiagnostic({
        errors: [{ message: "Gateway authentication failed." }],
      }),
    ).toBe("Gateway authentication failed.");
    expect(
      responseErrorDiagnostic({ error: { message: "Unknown model." } }),
    ).toBe("Unknown model.");
  });

  it("parses a local generation fixture without importing eval scenarios", () => {
    const candidate = candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: expectedText,
    });

    expect(candidate.error).toBeUndefined();
    expect(candidate.diagram?.id).toBe(expectedDiagram.id);
  });
});

const successfulRun = vi.fn(async () => jsonResponse(geminiResponse));
const successfulClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: successfulRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(successfulClientLayer)("Cloudflare Google AI Studio live layer", (it) => {
  it.effect("uses the provider-native Google route", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        maxOutputTokens: 512,
        model: "google/gemini-3.1-flash-lite",
        prompt,
        temperature: 0.2,
      });

      expect(successfulRun).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: "v1beta/models/gemini-3.1-flash-lite:generateContent",
          headers: expect.not.objectContaining({
            "Cache-Control": "no-store",
          }),
          provider: "google-ai-studio",
          query: expectedGeminiBody,
        }),
        expect.objectContaining({
          gateway: expect.objectContaining({
            collectLog: true,
            metadata: expect.objectContaining({ scenarioId: prompt.id }),
          }),
        }),
      );
      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
      assert.strictEqual(candidate.usage?.totalTokens, 34);
    }),
  );

  it.effect("sends no-store headers and metadata for fresh runs", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        cacheMode: "fresh",
        model: "google/gemini-3.1-flash-lite",
        prompt,
      });

      expect(successfulRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "Cache-Control": "no-store",
            Pragma: "no-cache",
          }),
        }),
        expect.objectContaining({
          gateway: expect.objectContaining({
            metadata: expect.objectContaining({ cacheMode: "fresh" }),
          }),
        }),
      );
      assert.strictEqual(candidate.cacheMode, "fresh");
    }),
  );
});

let transientAttempts = 0;
const transientRun = vi.fn(async () => {
  transientAttempts += 1;
  return transientAttempts < 3
    ? jsonResponse(
        { error: { message: "temporarily unavailable" } },
        { status: 503 },
      )
    : jsonResponse(geminiResponse);
});
const retryClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: transientRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(retryClientLayer)("bounded retry policy", (it) => {
  it.effect("retries transient failures with TestClock", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const fiber = yield* Effect.forkChild(
        client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        }),
      );
      yield* TestClock.adjust("1 second");
      const candidate = yield* Fiber.join(fiber);

      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
      assert.strictEqual(transientAttempts, 3);
    }),
  );
});

const permanentRun = vi.fn(async () =>
  jsonResponse({ error: { message: "invalid request" } }, { status: 400 }),
);
const permanentClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: permanentRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(permanentClientLayer)("non-retryable failures", (it) => {
  it.effect("does not retry a permanent HTTP failure", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const error = yield* Effect.flip(
        client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        }),
      );

      assert.strictEqual(error._tag, "DiagramGenerationHttpError");
      assert.strictEqual(permanentRun.mock.calls.length, 1);
    }),
  );
});

const cancellationSignals: AbortSignal[] = [];
let activeUpstreamRequests = 0;
let maxActiveUpstreamRequests = 0;
const timeoutRun = vi.fn<CloudflareAiGateway["run"]>((_data, options) => {
  const signal = options?.signal;

  if (!signal) {
    return Promise.reject(new Error("Generation request omitted AbortSignal."));
  }

  cancellationSignals.push(signal);
  activeUpstreamRequests += 1;
  maxActiveUpstreamRequests = Math.max(
    maxActiveUpstreamRequests,
    activeUpstreamRequests,
  );

  return new Promise<Response>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        activeUpstreamRequests -= 1;
        reject(signal.reason);
      },
      { once: true },
    );
  });
});
const timeoutClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: timeoutRun }),
      }),
      configLayer,
      cancellationPolicyLayer,
    ),
  ),
);

layer(timeoutClientLayer)("timeouts and interruption", (it) => {
  it.effect("aborts timed-out attempts before a bounded retry begins", () =>
    Effect.gen(function* () {
      cancellationSignals.length = 0;
      activeUpstreamRequests = 0;
      maxActiveUpstreamRequests = 0;
      timeoutRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const fiber = yield* Effect.forkChild(
        Effect.flip(
          client.generate({
            model: "google/gemini-3.1-flash-lite",
            prompt,
          }),
        ),
      );
      yield* TestClock.adjust("2 seconds");
      const error = yield* Fiber.join(fiber);

      assert.strictEqual(error._tag, "DiagramGenerationTimeoutError");
      assert.strictEqual(timeoutRun.mock.calls.length, 2);
      assert.strictEqual(cancellationSignals.length, 2);
      assert.isTrue(cancellationSignals.every((signal) => signal.aborted));
      assert.strictEqual(activeUpstreamRequests, 0);
      assert.strictEqual(maxActiveUpstreamRequests, 1);
    }),
  );

  it.effect("preserves interruption instead of translating it", () =>
    Effect.gen(function* () {
      cancellationSignals.length = 0;
      activeUpstreamRequests = 0;
      maxActiveUpstreamRequests = 0;
      timeoutRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const signalCountBeforeInterrupt = cancellationSignals.length;
      const fiber = yield* Effect.forkChild(
        client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        }),
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      if (Exit.isSuccess(exit)) {
        return assert.fail("Interrupted generation unexpectedly succeeded.");
      }
      assert.isTrue(Cause.hasInterrupts(exit.cause));
      assert.strictEqual(
        cancellationSignals.length,
        signalCountBeforeInterrupt + 1,
      );
      assert.isTrue(cancellationSignals.at(-1)?.aborted);
      assert.strictEqual(activeUpstreamRequests, 0);
    }),
  );
});

const malformedRun = vi.fn(async () => jsonResponse({ candidates: [] }));
const malformedClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: malformedRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(malformedClientLayer)("malformed model responses", (it) => {
  it.effect("returns a typed response error without retrying", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const error = yield* Effect.flip(
        client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        }),
      );

      assert.strictEqual(error._tag, "DiagramGenerationResponseError");
      assert.strictEqual(
        error.message,
        "Gemini response did not include text content.",
      );
      assert.strictEqual(malformedRun.mock.calls.length, 1);
    }),
  );
});

const substitutedClientLayer = Layer.succeed(DiagramGenerationClient, {
  provider: "fixture",
  generate: Effect.fn("diagramGeneration.test.generate")(function* () {
    return candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: expectedText,
    });
  }),
});

layer(substitutedClientLayer)("client layer substitution", (it) => {
  it.effect("substitutes the client without changing business code", () =>
    Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({ model: "fixture", prompt });

      assert.strictEqual(client.provider, "fixture");
      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
    }),
  );
});
