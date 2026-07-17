import { buildGeminiGenerateContentBody } from "@sketchi/diagram-generation";
import {
  getScenario,
  toDiagramGenerationPrompt,
} from "@sketchi/diagram-scenarios";
import { describe, expect, it, vi } from "vitest";

import { generateScenarioCandidatesForInput } from "./generate-scenario";

describe("eval harness scenario generation composition", () => {
  it("adapts a maintained scenario before calling the generation client", async () => {
    const scenario = getScenario("sketchi-onboarding-decision-flow");
    const responseBody = {
      candidates: [
        {
          content: {
            parts: [
              { text: JSON.stringify(scenario.expectedDiagram, null, 2) },
            ],
            role: "model",
          },
        },
      ],
      usageMetadata: {
        candidatesTokenCount: 23,
        promptTokenCount: 11,
        totalTokenCount: 34,
      },
    };
    const run = vi.fn(
      async () =>
        new Response(JSON.stringify(responseBody), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const result = await generateScenarioCandidatesForInput(
      {
        cacheMode: "fresh",
        providers: ["cloudflare-google-ai-studio"],
        scenarioId: scenario.id,
      },
      {
        AI: {
          gateway: () => ({ getUrl: vi.fn(), run }),
        },
      },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: buildGeminiGenerateContentBody({
          cacheMode: "fresh",
          model: "google/gemini-3.1-flash-lite",
          prompt: toDiagramGenerationPrompt(scenario),
        }),
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({
          metadata: expect.objectContaining({ scenarioId: scenario.id }),
        }),
      }),
    );
    expect(result).toMatchObject({
      candidates: [
        {
          cacheMode: "fresh",
          diagramValid: true,
          model: "gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          usage: {
            inputTokens: 11,
            outputTokens: 23,
            totalTokens: 34,
          },
        },
      ],
      model: "google/gemini-3.1-flash-lite",
      scenarioId: scenario.id,
    });
  });
});
