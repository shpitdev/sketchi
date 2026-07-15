import { getScenario } from "@sketchi/diagram-scenarios";
import { describe, expect, it, vi } from "vitest";

import { createCloudflareGoogleAiStudioClient } from "./cloudflare-google-ai-studio.js";
import { createFixtureGenerationClient } from "./fixture-client.js";
import {
  buildGeminiGenerateContentBody,
  stripCloudflareGoogleModelPrefix,
} from "./gemini.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { candidateFromText, responseErrorDiagnostic } from "./candidates.js";

const scenario = getScenario("sketchi-onboarding-decision-flow");
const expectedText = JSON.stringify(scenario.expectedDiagram, null, 2);
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
  it("keeps system and user instructions as separate messages", () => {
    const prompt = buildDiagramGenerationMessages(scenario);

    expect(prompt.messages).toHaveLength(2);
    expect(prompt.messages[0]).toMatchObject({ role: "system" });
    expect(prompt.messages[0].content).toContain("Flowchart IR rules");
    expect(prompt.messages[1]).toMatchObject({ role: "user" });
    expect(prompt.messages[1].content).toContain(scenario.prompt);
    expect(prompt.messages[1].content).not.toContain("Flowchart IR rules");
  });

  it("maps flowchart prompts into Gemini REST system instruction and contents", () => {
    const body = buildGeminiGenerateContentBody({
      maxOutputTokens: 512,
      model: "google/gemini-3.1-flash-lite",
      scenario,
      temperature: 0.2,
    });

    expect(body.system_instruction.parts[0]?.text).toContain(
      "Flowchart IR rules",
    );
    expect(body.contents[0]?.parts[0]?.text).toContain(scenario.prompt);
    expect(body.contents[0]?.parts[0]?.text).not.toContain(
      "Flowchart IR rules",
    );
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 512,
      response_mime_type: "application/json",
      temperature: 0.2,
    });
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

  it("returns parseable flowchart IR from the fixture client", async () => {
    const candidate = await createFixtureGenerationClient().generate({
      model: "fixture",
      scenario,
    });

    expect(candidate.error).toBeUndefined();
    expect(candidate.diagram?.id).toBe(scenario.expectedDiagram.id);
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
      model: "google/gemini-3.1-flash-lite",
      scenario,
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "v1beta/models/gemini-3.1-flash-lite:generateContent",
        headers: expect.not.objectContaining({
          "Cache-Control": "no-store",
        }),
        provider: "google-ai-studio",
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({
          collectLog: true,
          metadata: expect.objectContaining({
            scenarioId: scenario.id,
          }),
        }),
      }),
    );
    expect(candidate.diagram?.id).toBe(scenario.expectedDiagram.id);
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
      scenario,
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
