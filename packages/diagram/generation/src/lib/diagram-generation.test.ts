import { assert, describe, expect, it, layer, vi } from "@effect/vitest";
import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  type TelemetryLogEvent,
  type TelemetryMetricEvent,
  type TelemetrySpanEvent,
} from "@sketchi/observability";
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
  stripGoogleModelPrefix,
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
  type: "flowchart",
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
  style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
};
const expectedText = JSON.stringify(
  {
    ...expectedDiagram,
    style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
  },
  null,
  2,
);
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

  it("maps mindmap requests to the mindmap IR contract", () => {
    const messages = buildDiagramGenerationMessages({
      ...prompt,
      type: "mindmap",
    });

    expect(messages.system).toContain('Use type "mindmap".');
    expect(messages.system).toContain("exactly one root node");
    expect(messages.user).toContain('"type": "mindmap"');
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
    expect(stripGoogleModelPrefix("google/gemini-3.1-flash-lite")).toBe(
      "gemini-3.1-flash-lite",
    );
    expect(
      stripGoogleModelPrefix("google-ai-studio/gemini-3.1-flash-lite"),
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
    expect(candidate.diagram?.style).toEqual(expectedDiagram.style);
  });

  it("parses validated mindmap candidates through diagram-core", () => {
    const candidate = candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: JSON.stringify({
        id: "launch-map",
        title: "Launch map",
        type: "mindmap",
        nodes: [
          {
            id: "root",
            label: "Launch",
            kind: "root",
            metadata: { depth: 0, siblingIndex: 0 },
          },
          {
            id: "product",
            label: "Product",
            kind: "topic",
            metadata: { depth: 1, siblingIndex: 0 },
          },
        ],
        edges: [
          {
            id: "root-product",
            source: "root",
            target: "product",
            metadata: { depth: 1, siblingIndex: 0 },
          },
        ],
        layout: { direction: "LR", edgeRouting: "curved" },
        style: { accentColor: "#7c3aed", backgroundColor: "#ffffff" },
      }),
    });

    expect(candidate.diagram?.type).toBe("mindmap");
    expect(candidate.diagram?.style).toEqual({
      accentColor: "#8f707f",
      backgroundColor: "#fffdf8",
    });
    expect(candidate.error).toBeUndefined();
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

const gatewayConstructionFailure = new Error("gateway construction failed");
const gatewayConstructionFailureLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => {
          throw gatewayConstructionFailure;
        },
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(gatewayConstructionFailureLayer)("provider preflight failures", (it) => {
  it.effect(
    "records terminal telemetry without an upstream attempt when gateway construction fails",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const telemetryLayer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-generation-preflight-test" },
        sink,
      });
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const error = yield* Effect.flip(
          client.generate({
            model: "google/gemini-3.1-flash-lite",
            prompt,
          }),
        );

        assert.strictEqual(error._tag, "DiagramGenerationTransportError");
        if (error._tag === "DiagramGenerationTransportError") {
          assert.strictEqual(error.operation, "ai.gateway");
          assert.isFalse(error.retryable);
        }
        const metrics = probe.events.filter(
          (event): event is TelemetryMetricEvent =>
            event.event === "effect.metric",
        );
        assert.strictEqual(
          metrics.filter(
            (metric) => metric.metric === "sketchi_generation_attempts",
          ).length,
          0,
        );
        assert.strictEqual(
          metrics.filter(
            (metric) => metric.metric === "sketchi_generation_retries",
          ).length,
          0,
        );
        for (const metricName of [
          "sketchi_generation_requests",
          "sketchi_generation_failures",
          "sketchi_generation_duration_ms",
        ]) {
          const matching = metrics.filter(
            (metric) => metric.metric === metricName,
          );
          assert.strictEqual(matching.length, 1);
          assert.deepInclude(matching[0]?.attributes, {
            failure_category: "DiagramGenerationTransportError",
            operation: "generate",
            provider: "cloudflare-google-ai-studio",
          });
        }
      }).pipe(Effect.provide(telemetryLayer));
    },
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
  it.effect("retries transient failures with correlated telemetry", () => {
    const { probe, sink } = makeTelemetryTestSink();
    const telemetryLayer = makeWorkersTelemetryLayer({
      resource: { serviceName: "sketchi-generation-test" },
      sink,
    });
    return Effect.gen(function* () {
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
      const metrics = probe.events.filter(
        (event): event is TelemetryMetricEvent =>
          event.event === "effect.metric",
      );
      const logs = probe.events.filter(
        (event): event is TelemetryLogEvent => event.event === "effect.log",
      );
      const attempts = probe.events.filter(
        (event): event is TelemetrySpanEvent =>
          event.event === "effect.span" &&
          event.name === "diagramGeneration.cloudflareGoogleAiStudio.attempt",
      );
      assert.strictEqual(
        metrics.filter(
          (metric) => metric.metric === "sketchi_generation_attempts",
        ).length,
        3,
      );
      assert.strictEqual(
        metrics.filter(
          (metric) => metric.metric === "sketchi_generation_retries",
        ).length,
        2,
      );
      assert.deepStrictEqual(
        logs.map((log) => log.fields["attempt"]),
        [2, 3],
      );
      assert.deepStrictEqual(
        attempts.map((span) => span.attributes["attempt"]),
        [1, 2, 3],
      );
      assert.isTrue(
        attempts.every(
          (span) =>
            span.attributes["sketchi.scenario_id"] === prompt.id &&
            span.trace_id === attempts[0]?.trace_id,
        ),
      );
    }).pipe(Effect.provide(telemetryLayer));
  });
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
  it.effect(
    "aborts timed-out attempts and records one terminal timeout",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const telemetryLayer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-generation-timeout-test" },
        sink,
      });
      return Effect.gen(function* () {
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
        const metrics = probe.events.filter(
          (event): event is TelemetryMetricEvent =>
            event.event === "effect.metric",
        );
        const logs = probe.events.filter(
          (event): event is TelemetryLogEvent => event.event === "effect.log",
        );
        assert.strictEqual(
          metrics.filter(
            (metric) => metric.metric === "sketchi_generation_timeouts",
          ).length,
          1,
        );
        assert.deepInclude(
          metrics.find(
            (metric) => metric.metric === "sketchi_generation_failures",
          )?.attributes,
          {
            failure_category: "DiagramGenerationTimeoutError",
            operation: "generate",
            provider: "cloudflare-google-ai-studio",
          },
        );
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0]?.message, "Retrying diagram generation");
        assert.strictEqual(logs[0]?.fields["attempt"], 2);
      }).pipe(Effect.provide(telemetryLayer));
    },
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
