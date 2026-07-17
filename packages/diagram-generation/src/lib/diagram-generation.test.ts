import { describe, expect, it, vi } from "vitest";

import { candidateFromText, responseErrorDiagnostic } from "./candidates.js";
import { createCloudflareGoogleAiStudioClient } from "./cloudflare-google-ai-studio.js";
import {
  buildGeminiGenerateContentBody,
  stripCloudflareGoogleModelPrefix,
} from "./gemini.js";
import {
  buildDiagramGenerationMessages,
  type DiagramGenerationPrompt,
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
  contents: [
    {
      role: "user",
      parts: [{ text: expectedUser }],
    },
  ],
  generationConfig: {
    maxOutputTokens: 512,
    response_mime_type: "application/json",
    temperature: 0.2,
  },
  system_instruction: {
    parts: [{ text: expectedSystem }],
  },
};
const geminiResponse = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [{ text: expectedText }],
      },
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

describe("diagram generation prompt mapping", () => {
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

describe("diagram generation clients", () => {
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

  it("uses the Cloudflare AI Gateway provider-native Google route", async () => {
    const run = vi.fn(async () => jsonResponse(geminiResponse));
    const client = createCloudflareGoogleAiStudioClient({
      ai: {
        gateway: () => ({
          getUrl: vi.fn(),
          run,
        }),
      },
      gatewayId: "sketchi",
    });

    const candidate = await client.generate({
      maxOutputTokens: 512,
      model: "google/gemini-3.1-flash-lite",
      prompt,
      temperature: 0.2,
    });

    expect(run).toHaveBeenCalledWith(
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
          metadata: expect.objectContaining({
            scenarioId: prompt.id,
          }),
        }),
      }),
    );
    expect(candidate.diagram?.id).toBe(expectedDiagram.id);
    expect(candidate.usage?.totalTokens).toBe(34);
  });

  it("sends no-store headers and metadata for fresh gateway runs", async () => {
    const run = vi.fn(async () => jsonResponse(geminiResponse));
    const client = createCloudflareGoogleAiStudioClient({
      ai: {
        gateway: () => ({
          getUrl: vi.fn(),
          run,
        }),
      },
      gatewayId: "sketchi",
    });

    const candidate = await client.generate({
      cacheMode: "fresh",
      model: "google/gemini-3.1-flash-lite",
      prompt,
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        }),
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({
          metadata: expect.objectContaining({
            cacheMode: "fresh",
          }),
        }),
      }),
    );
    expect(candidate.cacheMode).toBe("fresh");
  });
});
