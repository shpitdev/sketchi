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

import {
  candidateFromText,
  enforceCandidateRequestRequirements,
  extractJsonObject,
  responseErrorDiagnostic,
} from "./candidates.js";
import {
  diagramGenerationPolicyDefaults,
  DiagramGenerationClient,
  DiagramGenerationPolicy,
} from "./client.js";
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
import {
  GeneratedMindmapTree,
  generatedMindmapTreeToDiagram,
} from "./mindmap-tree.js";

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
    {
      id: "final-review",
      label: "QA Manager final review",
      kind: "decision",
    },
    {
      id: "investigation",
      label: "Investigate retesting",
      kind: "process",
    },
    { id: "packaging", label: "Send to packaging", kind: "end" },
  ],
  edges: [
    {
      id: "received-to-final-review",
      source: "received",
      target: "final-review",
    },
    {
      id: "final-review-to-packaging",
      source: "final-review",
      target: "packaging",
      label: "yes",
    },
    {
      id: "final-review-to-investigation",
      source: "final-review",
      target: "investigation",
      label: "retest",
    },
    {
      id: "investigation-to-final-review",
      source: "investigation",
      target: "final-review",
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
  "- Return only compact, minified JSON on one line. Do not use markdown.",
  '- Use type "flowchart".',
  '- Every node must have id, label, and kind: "start", "process", "decision", or "end".',
  "- Use exactly one start node and at least one end node.",
  "- Every non-end node must have at least one outgoing edge.",
  "- Every end node must have zero outgoing edges.",
  "- Every decision node must have at least two outgoing edges.",
  "- Every outgoing edge from a decision node must have a non-empty unique label.",
  "- When the scenario describes a retry, resubmission, return, or feedback loop, include a real back-edge from the loop path to the intended earlier process or decision; naming a loop or drawing a one-way list is insufficient.",
  "- Loop-back edges must target a process or decision node, never the start node; start nodes have no incoming edges.",
  "- Self-loop edges are forbidden. Model every retry or re-check as a decision whose retry branch routes back to an earlier distinct process or decision node.",
  '- Minimal loop example: decision "Retry?" --"yes"--> process "Try again" --> decision "Retry?"; decision "Retry?" --"no"--> end.',
  "- Honor every explicit count or minimum for nodes, steps, decisions, branches, ends, and loops; never return fewer. For a rich scenario without an explicit count, include the major actions and decisions rather than collapsing them into a short summary.",
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
  JSON.stringify({
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
  }),
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
  maxRepairAttempts: 1,
  maxRetries: 2,
  requestTimeoutMs: 1_000,
  retryDelayMs: 100,
});
const cancellationPolicyLayer = Layer.succeed(DiagramGenerationPolicy, {
  concurrency: 2,
  maxRepairAttempts: 1,
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
    expect(messages.system).toContain("one nested root topic");
    expect(messages.system).toContain("required top-level diagram id");
    expect(messages.system).toContain("Do not return flat nodes");
    expect(messages.system).toContain("derived topic/node/edge ids");
    expect(messages.system).toContain("2-4 children per major topic");
    expect(messages.system).toContain("2-3 levels of meaningful depth");
    expect(messages.user).toContain('"type":"mindmap"');
  });

  it("requires real loop topology and flowchart richness", () => {
    const messages = buildDiagramGenerationMessages(prompt);

    expect(messages.system).toContain(
      "include a real back-edge from the loop path",
    );
    expect(messages.system).toContain(
      "Loop-back edges must target a process or decision node, never the start node",
    );
    expect(messages.system).toContain("start nodes have no incoming edges");
    expect(messages.system).toContain("Self-loop edges are forbidden");
    expect(messages.system).toContain(
      "retry branch routes back to an earlier distinct process or decision node",
    );
    expect(messages.system).toContain('decision "Retry?" --"yes"-->');
    expect(messages.system).toContain(
      "Honor every explicit count or minimum for nodes, steps, decisions, branches, ends, and loops",
    );
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

  it("uses the expanded output budget unless the request overrides it", () => {
    expect(
      buildGeminiGenerateContentBody({
        model: "google/gemini-3.1-flash-lite",
        prompt,
      }).generationConfig.maxOutputTokens,
    ).toBe(16_384);
    expect(diagramGenerationPolicyDefaults.maxRepairAttempts).toBe(2);
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
  it("extracts the first complete JSON object without swallowing trailing output", () => {
    expect(
      extractJsonObject(
        'Result: {"label":"Review {draft}","nested":{"ok":true}}\n{"duplicate":true}',
      ),
    ).toEqual({ label: "Review {draft}", nested: { ok: true } });
  });

  it.effect.prop(
    "derives a valid flat mindmap from every generated nested hierarchy",
    { tree: GeneratedMindmapTree },
    ({ tree }) =>
      Effect.gen(function* () {
        const diagram = generatedMindmapTreeToDiagram(tree);
        const root = diagram.nodes.find((node) => node.kind === "root");

        assert.strictEqual(root?.id, "topic-0");
        assert.strictEqual(diagram.edges.length, diagram.nodes.length - 1);
        assert.isTrue(diagram.nodes.length >= 2);
      }),
  );

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

  it("normalizes empty optional edge labels before schema validation", () => {
    const candidate = candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: JSON.stringify({
        ...expectedDiagram,
        edges: expectedDiagram.edges.map((edge, index) =>
          index === 0 ? { ...edge, label: "" } : edge,
        ),
      }),
    });

    expect(candidate.error).toBeUndefined();
    expect(candidate.diagram?.edges[0]?.label).toBeUndefined();
  });

  it("turns an explicitly undersized valid result into semantic repair input", () => {
    const candidate = enforceCandidateRequestRequirements(
      candidateFromText({
        model: "fixture",
        provider: "fixture",
        text: expectedText,
      }),
      {
        model: "fixture",
        prompt: {
          ...prompt,
          request: "Create a return flow with at least 18 distinct steps.",
        },
      },
    );

    expect(candidate.diagram).toBeUndefined();
    expect(candidate.diagnostics).toContain(
      "request_minimum_not_met: requested at least 18 steps, but the generated flowchart contained 4. Hint: return a complete diagram with at least 18 nodes.",
    );
  });

  it("turns missing explicit decision counts into semantic repair input", () => {
    const candidate = enforceCandidateRequestRequirements(
      candidateFromText({
        model: "fixture",
        provider: "fixture",
        text: expectedText,
      }),
      {
        model: "fixture",
        prompt: {
          ...prompt,
          request: "Use at least five labeled decision nodes.",
        },
      },
    );

    expect(candidate.diagram).toBeUndefined();
    expect(candidate.diagnostics).toContain(
      "request_minimum_not_met: requested at least 5 decision nodes, but the generated flowchart contained 1. Hint: return a complete diagram with at least 5 decision nodes.",
    );
  });

  it("turns a named loop without a directed cycle into semantic repair input", () => {
    const candidate = enforceCandidateRequestRequirements(
      candidateFromText({
        model: "fixture",
        provider: "fixture",
        text: JSON.stringify({
          ...expectedDiagram,
          nodes: expectedDiagram.nodes.filter(
            (node) => node.id === "received" || node.id === "packaging",
          ),
          edges: [
            {
              id: "received-to-packaging",
              source: "received",
              target: "packaging",
            },
          ],
        }),
      }),
      {
        model: "fixture",
        prompt: {
          ...prompt,
          request: "Add a fraud review loop before closure.",
        },
      },
    );

    expect(candidate.diagram).toBeUndefined();
    expect(candidate.diagnostics).toContain(
      "request_loop_not_met: prompt requires a retry or loop, but the generated flowchart contains no directed cycle. Hint: add a real back-edge from the loop path to the intended process or decision node, never the start node.",
    );
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

  it("derives deterministic graph metadata from nested mindmap output", () => {
    const candidate = candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: JSON.stringify({
        id: "launch-map",
        layout: { direction: "LR", edgeRouting: "curved" },
        root: {
          children: [
            {
              children: [{ children: [], label: "Positioning" }],
              label: "Product",
            },
            { children: [], label: "Go to market" },
          ],
          label: "Launch",
        },
        title: "Launch map",
        type: "mindmap",
      }),
    });

    expect(candidate.error).toBeUndefined();
    expect(candidate.diagram?.nodes.map((node) => node.id)).toEqual([
      "topic-0",
      "topic-0-0",
      "topic-0-0-0",
      "topic-0-1",
    ]);
    expect(candidate.diagram?.edges[1]).toMatchObject({
      id: "branch-0-0-0",
      metadata: { depth: 2, siblingIndex: 0 },
      source: "topic-0-0",
      target: "topic-0-0-0",
    });
  });

  it("captures every flowchart validator issue with its repair hint", () => {
    const candidate = candidateFromText({
      model: "fixture",
      provider: "fixture",
      text: JSON.stringify({
        id: "broken-loop",
        title: "Broken loop",
        type: "flowchart",
        nodes: [
          { id: "start", label: "Start", kind: "start" },
          { id: "retry", label: "Retry?", kind: "decision" },
          { id: "done", label: "Done", kind: "end" },
        ],
        edges: [
          { id: "start-retry", source: "start", target: "retry" },
          { id: "retry-done", source: "retry", target: "done" },
          { id: "done-start", source: "done", target: "start" },
        ],
        layout: { direction: "TB", edgeRouting: "orthogonal" },
      }),
    });

    expect(candidate.diagram).toBeUndefined();
    expect(candidate.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("start_has_incoming"),
        expect.stringContaining("end_has_outgoing"),
        expect.stringContaining("underbranched_decision"),
        expect.stringContaining("unlabeled_decision_branch"),
        expect.stringContaining("Hint:"),
      ]),
    );
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
            "cf-aig-skip-cache": "true",
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

const invalidDiagramText = JSON.stringify({
  id: "invalid-retry",
  title: "Invalid retry",
  type: "flowchart",
  nodes: [
    { id: "start", kind: "start", label: "Start" },
    { id: "retry", kind: "decision", label: "Retry?" },
    { id: "end", kind: "end", label: "Done" },
  ],
  edges: [
    { id: "start-retry", source: "start", target: "retry" },
    { id: "retry-end", source: "retry", target: "end" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
});

const startIncomingDiagramText = JSON.stringify({
  id: "expense-resubmission",
  title: "Expense resubmission",
  type: "flowchart",
  nodes: [
    { id: "start", kind: "start", label: "Start" },
    { id: "submission", kind: "process", label: "Submission" },
    { id: "manager", kind: "decision", label: "Manager approves?" },
    { id: "finance", kind: "decision", label: "Finance approves?" },
    { id: "rejection", kind: "process", label: "Rejection" },
    { id: "resubmit", kind: "process", label: "Resubmit" },
    { id: "reimbursement", kind: "end", label: "Reimbursement" },
  ],
  edges: [
    { id: "start-submission", source: "start", target: "submission" },
    { id: "submission-manager", source: "submission", target: "manager" },
    {
      id: "manager-finance",
      source: "manager",
      target: "finance",
      label: "approved",
    },
    {
      id: "manager-rejection",
      source: "manager",
      target: "rejection",
      label: "rejected",
    },
    {
      id: "finance-reimbursement",
      source: "finance",
      target: "reimbursement",
      label: "approved",
    },
    {
      id: "finance-rejection",
      source: "finance",
      target: "rejection",
      label: "rejected",
    },
    { id: "rejection-resubmit", source: "rejection", target: "resubmit" },
    { id: "resubmit-start", source: "resubmit", target: "start" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
});

const selfLoopDiagramText = JSON.stringify({
  id: "returns-fraud-review",
  title: "Returns fraud review",
  type: "flowchart",
  nodes: [
    { id: "start", kind: "start", label: "Start" },
    { id: "return", kind: "process", label: "Receive return" },
    { id: "fraud", kind: "decision", label: "Fraud check passes?" },
    { id: "done", kind: "end", label: "Refund complete" },
  ],
  edges: [
    { id: "start-return", source: "start", target: "return" },
    { id: "return-fraud", source: "return", target: "fraud" },
    {
      id: "fraud-self",
      source: "fraud",
      target: "fraud",
      label: "re-check",
    },
    { id: "fraud-done", source: "fraud", target: "done", label: "clear" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
});

function returnsDiagramText(nodeCount: number, selfLoop: boolean): string {
  const processCount = nodeCount - 3;
  const processNodes = Array.from({ length: processCount }, (_, index) => ({
    id: `step-${index + 1}`,
    kind: "process",
    label: `Return step ${index + 1}`,
  }));
  const processEdges = processNodes.map((node, index) => ({
    id: `step-edge-${index + 1}`,
    source: node.id,
    target: processNodes[index + 1]?.id ?? "fraud-check",
  }));
  const lastProcessId = processNodes.at(-1)?.id ?? "fraud-review";
  return JSON.stringify({
    id: "returns-minimum-repair",
    title: "Ecommerce returns",
    type: "flowchart",
    nodes: [
      { id: "start", kind: "start", label: "Return initiated" },
      ...processNodes,
      { id: "fraud-check", kind: "decision", label: "Fraud check?" },
      { id: "done", kind: "end", label: "Return closed" },
    ],
    edges: [
      {
        id: "start-step",
        source: "start",
        target: processNodes[0]?.id ?? "fraud-check",
      },
      ...processEdges,
      {
        id: "fraud-recheck",
        source: "fraud-check",
        target: selfLoop ? "fraud-check" : lastProcessId,
        label: "re-check",
      },
      {
        id: "fraud-clear",
        source: "fraud-check",
        target: "done",
        label: "clear",
      },
    ],
    layout: { direction: "TB", edgeRouting: "orthogonal" },
  });
}

function geminiTextResponse(text: string): Response {
  return jsonResponse({
    candidates: [
      { content: { role: "model", parts: [{ text }] }, finishReason: "STOP" },
    ],
  });
}

let repairedRunCalls = 0;
const repairedRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  repairedRunCalls += 1;
  return repairedRunCalls === 1
    ? geminiTextResponse(invalidDiagramText)
    : jsonResponse(geminiResponse);
});
const repairedClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: repairedRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(repairedClientLayer)("semantic repair policy", (it) => {
  it.effect("repairs one invalid response and records repair outcomes", () => {
    const { probe, sink } = makeTelemetryTestSink();
    const telemetryLayer = makeWorkersTelemetryLayer({
      resource: { serviceName: "sketchi-generation-repair-test" },
      sink,
    });
    return Effect.gen(function* () {
      repairedRunCalls = 0;
      repairedRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        model: "google/gemini-3.1-flash-lite",
        prompt,
      });

      assert.strictEqual(repairedRun.mock.calls.length, 2);
      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
      assert.isTrue(
        candidate.diagnostics.some((diagnostic) =>
          diagnostic.startsWith("flowchart.underbranched_decision:"),
        ),
      );
      assert.isTrue(
        candidate.diagnostics.includes(
          "repair_succeeded: semantic repair attempt 1 succeeded.",
        ),
      );
      expect(repairedRun.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            "Cache-Control": "no-store",
            "cf-aig-skip-cache": "true",
          }),
          query: expect.objectContaining({
            contents: [
              expect.objectContaining({
                parts: [
                  expect.objectContaining({
                    text: expect.stringContaining("Invalid model output:"),
                  }),
                ],
              }),
            ],
          }),
        }),
      );
      const repairs = probe.events.filter(
        (event): event is TelemetryMetricEvent =>
          event.event === "effect.metric" &&
          event.metric === "sketchi_generation_repairs",
      );
      assert.deepStrictEqual(
        repairs.map((event) => event.attributes["outcome"]),
        ["attempted", "succeeded"],
      );
    }).pipe(Effect.provide(telemetryLayer));
  });
});

let startIncomingRepairCalls = 0;
const startIncomingRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  startIncomingRepairCalls += 1;
  return startIncomingRepairCalls === 1
    ? geminiTextResponse(startIncomingDiagramText)
    : jsonResponse(geminiResponse);
});
const startIncomingRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: startIncomingRepairRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(startIncomingRepairClientLayer)("start edge semantic repair", (it) => {
  it.effect("prioritizes rerouting loop-back edges away from start", () =>
    Effect.gen(function* () {
      startIncomingRepairCalls = 0;
      startIncomingRepairRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        model: "google/gemini-3.1-flash-lite",
        prompt,
      });

      assert.strictEqual(startIncomingRepairRun.mock.calls.length, 2);
      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
      const repairBody = startIncomingRepairRun.mock.calls[1]?.[0];
      expect(repairBody).toEqual(
        expect.objectContaining({
          query: expect.objectContaining({
            contents: [
              expect.objectContaining({
                parts: [
                  expect.objectContaining({
                    text: expect.stringMatching(
                      /Priority validator issue and hint:\n- flowchart\.start_has_incoming: Start node "start" cannot have incoming edges\. Hint: Route the start node only to later nodes\.[\s\S]*reroute each offending loop-back edge to the first process node after start\. Never target the start node; start nodes have no incoming edges\./u,
                    ),
                  }),
                ],
              }),
            ],
          }),
        }),
      );
    }),
  );
});

let selfLoopRepairCalls = 0;
const selfLoopRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  selfLoopRepairCalls += 1;
  return selfLoopRepairCalls === 1
    ? geminiTextResponse(selfLoopDiagramText)
    : jsonResponse(geminiResponse);
});
const selfLoopRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: selfLoopRepairRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(selfLoopRepairClientLayer)("self-loop semantic repair", (it) => {
  it.effect(
    "prioritizes rerouting self-loops to an earlier distinct node",
    () =>
      Effect.gen(function* () {
        selfLoopRepairCalls = 0;
        selfLoopRepairRun.mockClear();
        const client = yield* DiagramGenerationClient;
        const candidate = yield* client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        });

        assert.strictEqual(selfLoopRepairRun.mock.calls.length, 2);
        assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
        const repairBody = selfLoopRepairRun.mock.calls[1]?.[0];
        expect(repairBody).toEqual(
          expect.objectContaining({
            query: expect.objectContaining({
              contents: [
                expect.objectContaining({
                  parts: [
                    expect.objectContaining({
                      text: expect.stringMatching(
                        /Priority validator issue and hint:\n- flowchart\.self_loop: Edge "fraud-self" connects node "fraud" to itself\. Hint: Connect the edge to a different target node\.[\s\S]*reroute each offending edge to an earlier distinct process or decision node\.[\s\S]*model every retry or re-check as a decision branch returning to that earlier distinct node\./u,
                      ),
                    }),
                  ],
                }),
              ],
            }),
          }),
        );
      }),
  );
});

const returnsMinimumPrompt: DiagramGenerationPrompt = {
  id: "returns-minimum-repair",
  request:
    "Create an ecommerce returns flowchart with at least 18 distinct steps and a fraud review loop.",
  requiredBranchLabels: ["re-check", "clear"],
  requiredNodeLabels: ["Fraud check?", "Return closed"],
  title: "Ecommerce returns",
  type: "flowchart",
};
let compactingRepairCalls = 0;
const compactingRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  compactingRepairCalls += 1;
  if (compactingRepairCalls === 1) {
    return geminiTextResponse(returnsDiagramText(18, true));
  }
  return geminiTextResponse(
    compactingRepairCalls === 2
      ? returnsDiagramText(16, false)
      : returnsDiagramText(18, false),
  );
});
const compactingRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: compactingRepairRun }),
      }),
      configLayer,
      Layer.succeed(DiagramGenerationPolicy, diagramGenerationPolicyDefaults),
    ),
  ),
);

layer(compactingRepairClientLayer)("repair-introduced violations", (it) => {
  it.effect(
    "preserves original hard requirements and repairs a new violation class",
    () =>
      Effect.gen(function* () {
        compactingRepairCalls = 0;
        compactingRepairRun.mockClear();
        const client = yield* DiagramGenerationClient;
        const candidate = yield* client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt: returnsMinimumPrompt,
        });

        assert.strictEqual(compactingRepairRun.mock.calls.length, 3);
        assert.strictEqual(candidate.diagram?.nodes.length, 18);
        expect(candidate.diagnostics).toEqual(
          expect.arrayContaining([
            expect.stringContaining("flowchart.self_loop:"),
            expect.stringContaining(
              "request_minimum_not_met: requested at least 18 steps",
            ),
            "repair_failed: semantic repair attempt 1 failed.",
            "repair_succeeded: semantic repair attempt 2 succeeded.",
          ]),
        );

        const firstRepairBody = JSON.stringify(
          compactingRepairRun.mock.calls[1]?.[0].query,
        );
        expect(firstRepairBody).toContain(
          "PRESERVE all existing nodes and labels except the minimal edit needed",
        );
        expect(firstRepairBody).toContain(
          "Original hard requirements (all remain mandatory):",
        );
        expect(firstRepairBody).toContain(
          "Parsed minimum: at least 18 nodes (from the original request for at least 18 steps).",
        );
        expect(firstRepairBody).toContain(
          "Required decision branch label: re-check",
        );
        expect(firstRepairBody).toContain("Required node label: Fraud check?");

        const secondRepairBody = JSON.stringify(
          compactingRepairRun.mock.calls[2]?.[0].query,
        );
        expect(secondRepairBody).toContain(
          "request_minimum_not_met: requested at least 18 steps",
        );
        expect(secondRepairBody).toContain("Parsed minimum: at least 18 nodes");
      }),
  );
});

let failedRepairCalls = 0;
const failedRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  failedRepairCalls += 1;
  return geminiTextResponse(
    failedRepairCalls === 1 ? invalidDiagramText : '{"type":"flowchart"',
  );
});
const failedRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: failedRepairRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(failedRepairClientLayer)("failed semantic repair", (it) => {
  it.effect("returns composed diagnostics after the bounded repair fails", () =>
    Effect.gen(function* () {
      failedRepairCalls = 0;
      failedRepairRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        model: "google/gemini-3.1-flash-lite",
        prompt,
      });

      assert.strictEqual(failedRepairRun.mock.calls.length, 2);
      assert.isUndefined(candidate.diagram);
      assert.strictEqual(candidate.text, invalidDiagramText);
      assert.notStrictEqual(candidate.text, '{"type":"flowchart"');
      assert.match(candidate.error ?? "", /Decision node/u);
      assert.isTrue(
        candidate.diagnostics.some((diagnostic) =>
          diagnostic.startsWith("flowchart.underbranched_decision:"),
        ),
      );
      assert.isTrue(
        candidate.diagnostics.some((diagnostic) =>
          diagnostic.startsWith("json_parse_error:"),
        ),
      );
      assert.isTrue(
        candidate.diagnostics.includes(
          "repair_failed: semantic repair attempt 1 failed.",
        ),
      );
    }),
  );
});

let exhaustedRepairCalls = 0;
const exhaustedRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  exhaustedRepairCalls += 1;
  return exhaustedRepairCalls === 1
    ? geminiTextResponse(invalidDiagramText)
    : jsonResponse(
        { error: { message: "repair provider temporarily unavailable" } },
        { status: 503 },
      );
});
const exhaustedRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: exhaustedRepairRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(exhaustedRepairClientLayer)("failed repair transport", (it) => {
  it.effect(
    "returns the original malformed candidate and records a failed repair",
    () => {
      const { probe, sink } = makeTelemetryTestSink();
      const telemetryLayer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-generation-repair-failure-test" },
        sink,
      });
      return Effect.gen(function* () {
        exhaustedRepairCalls = 0;
        exhaustedRepairRun.mockClear();
        const client = yield* DiagramGenerationClient;
        const fiber = yield* Effect.forkChild(
          client.generate({
            model: "google/gemini-3.1-flash-lite",
            prompt,
          }),
        );
        yield* TestClock.adjust("1 second");
        const candidate = yield* Fiber.join(fiber);

        assert.strictEqual(exhaustedRepairRun.mock.calls.length, 4);
        assert.isUndefined(candidate.diagram);
        assert.strictEqual(candidate.text, invalidDiagramText);
        assert.match(candidate.error ?? "", /Decision node/u);
        assert.isTrue(
          candidate.diagnostics.some((diagnostic) =>
            diagnostic.includes("repair provider temporarily unavailable"),
          ),
        );
        assert.isTrue(
          candidate.diagnostics.includes(
            "repair_failed: semantic repair attempt 1 failed.",
          ),
        );
        const repairs = probe.events.filter(
          (event): event is TelemetryMetricEvent =>
            event.event === "effect.metric" &&
            event.metric === "sketchi_generation_repairs",
        );
        assert.deepStrictEqual(
          repairs.map((event) => event.attributes["outcome"]),
          ["attempted", "failed"],
        );
        assert.strictEqual(
          probe.events.filter(
            (event): event is TelemetryMetricEvent =>
              event.event === "effect.metric" &&
              event.metric === "sketchi_generation_failures",
          ).length,
          0,
        );
      }).pipe(Effect.provide(telemetryLayer));
    },
  );
});

let interruptedRepairCalls = 0;
const interruptedRepairSignals: AbortSignal[] = [];
const interruptedRepairRun = vi.fn<CloudflareAiGateway["run"]>(
  async (_data, options) => {
    interruptedRepairCalls += 1;
    if (interruptedRepairCalls === 1) {
      return geminiTextResponse(invalidDiagramText);
    }
    const signal = options?.signal;
    if (!signal) {
      throw new Error("Repair request omitted AbortSignal.");
    }
    interruptedRepairSignals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  },
);
const interruptedRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: interruptedRepairRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(interruptedRepairClientLayer)("repair interruption", (it) => {
  it.effect("does not turn repair interruption into malformed output", () =>
    Effect.gen(function* () {
      interruptedRepairCalls = 0;
      interruptedRepairSignals.length = 0;
      interruptedRepairRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const fiber = yield* Effect.forkChild(
        client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        }),
      );
      while (interruptedRepairSignals.length === 0) {
        yield* Effect.yieldNow;
      }
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);

      if (Exit.isSuccess(exit)) {
        return assert.fail("Interrupted repair unexpectedly succeeded.");
      }
      assert.isTrue(Cause.hasInterrupts(exit.cause));
      assert.strictEqual(interruptedRepairRun.mock.calls.length, 2);
      assert.isTrue(interruptedRepairSignals[0]?.aborted);
    }),
  );
});

let multiRepairCalls = 0;
const multiRepairRun = vi.fn<CloudflareAiGateway["run"]>(async () => {
  multiRepairCalls += 1;
  if (multiRepairCalls === 1) {
    return jsonResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: '{"type":"flowchart"' }],
          },
          finishReason: "MAX_TOKENS",
        },
      ],
    });
  }
  return multiRepairCalls === 2
    ? geminiTextResponse(invalidDiagramText)
    : jsonResponse(geminiResponse);
});
const multiRepairClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: multiRepairRun }),
      }),
      configLayer,
      Layer.succeed(DiagramGenerationPolicy, {
        concurrency: 2,
        maxRepairAttempts: 2,
        maxRetries: 0,
        requestTimeoutMs: 1_000,
        retryDelayMs: 100,
      }),
    ),
  ),
);

layer(multiRepairClientLayer)("multi-attempt semantic repair", (it) => {
  it.effect("classifies truncation from only the latest response", () =>
    Effect.gen(function* () {
      multiRepairCalls = 0;
      multiRepairRun.mockClear();
      const client = yield* DiagramGenerationClient;
      const candidate = yield* client.generate({
        model: "google/gemini-3.1-flash-lite",
        prompt,
      });

      assert.strictEqual(candidate.diagram?.id, expectedDiagram.id);
      assert.strictEqual(multiRepairRun.mock.calls.length, 3);
      expect(
        JSON.stringify(multiRepairRun.mock.calls[1]?.[0].query),
      ).not.toContain("Invalid model output:");
      expect(JSON.stringify(multiRepairRun.mock.calls[2]?.[0].query)).toContain(
        "Invalid model output:",
      );
      expect(candidate.diagnostics).toEqual(
        expect.arrayContaining([
          "repair_failed: semantic repair attempt 1 failed.",
          "repair_succeeded: semantic repair attempt 2 succeeded.",
        ]),
      );
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

const truncatedRun = vi.fn<CloudflareAiGateway["run"]>(async () =>
  jsonResponse({
    candidates: [
      {
        content: { role: "model", parts: [{ text: '{"type":"flowchart"' }] },
        finishReason: "MAX_TOKENS",
      },
    ],
  }),
);
const truncatedClientLayer = CloudflareGoogleAiStudioClientLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(CloudflareAiGatewayBinding, {
        gateway: () => ({ getUrl: vi.fn(), run: truncatedRun }),
      }),
      configLayer,
      retryPolicyLayer,
    ),
  ),
);

layer(truncatedClientLayer)("token-budget exhaustion", (it) => {
  it.effect(
    "regenerates a truncated response without repairing partial JSON",
    () =>
      Effect.gen(function* () {
        truncatedRun.mockClear();
        const client = yield* DiagramGenerationClient;
        const candidate = yield* client.generate({
          model: "google/gemini-3.1-flash-lite",
          prompt,
        });

        assert.isUndefined(candidate.diagram);
        expect(candidate.diagnostics).toContain(
          "output_truncated: Gemini stopped at the maximum output-token budget; regenerate the complete diagram.",
        );
        expect(candidate.diagnostics).toEqual(
          expect.arrayContaining([
            "repair_attempted: regenerated a truncated response (attempt 1).",
            "repair_failed: semantic repair attempt 1 failed.",
          ]),
        );
        assert.strictEqual(truncatedRun.mock.calls.length, 2);
        expect(truncatedRun.mock.calls[1]?.[0]).toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({ "Cache-Control": "no-store" }),
          }),
        );
        expect(
          JSON.stringify(truncatedRun.mock.calls[1]?.[0].query),
        ).not.toContain("Invalid model output:");
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
