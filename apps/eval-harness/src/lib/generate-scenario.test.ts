import {
  buildGeminiGenerateContentBody,
  candidateFromText,
  DiagramGenerationClient,
  DiagramGenerationPolicy,
} from "@sketchi/diagram-generation";
import {
  getScenario,
  toDiagramGenerationPrompt,
} from "@sketchi/diagram-scenarios";
import { assert, describe, expect, it, layer, vi } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  generateScenarioCandidatesForInput,
  runGenerateScenarioCandidatesForInput,
} from "./generate-scenario";

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
    const result = await runGenerateScenarioCandidatesForInput(
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

  it("preserves the missing-provider response when the Worker binding is absent", async () => {
    const result = await runGenerateScenarioCandidatesForInput(
      {
        providers: ["cloudflare-google-ai-studio"],
        scenarioId: "sketchi-onboarding-decision-flow",
      },
      {},
    );

    expect(result).toEqual({
      candidates: [
        {
          cacheMode: "default",
          diagnostics: [
            'Provider "cloudflare-google-ai-studio" is not configured in this Worker environment.',
          ],
          diagramValid: false,
          error:
            'Provider "cloudflare-google-ai-studio" is not configured in this Worker environment.',
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: "",
        },
      ],
      model: "google/gemini-3.1-flash-lite",
      scenarioId: "sketchi-onboarding-decision-flow",
    });
  });

  it("preserves HTTP candidate diagnostics at the runtime boundary", async () => {
    const result = await runGenerateScenarioCandidatesForInput(
      {
        providers: ["cloudflare-google-ai-studio"],
        scenarioId: "sketchi-onboarding-decision-flow",
      },
      {
        AI: {
          gateway: () => ({
            getUrl: vi.fn(),
            run: vi.fn(
              async () =>
                new Response(
                  JSON.stringify({ error: { message: "invalid request" } }),
                  { status: 400 },
                ),
            ),
          }),
        },
      },
    );

    expect(result).toEqual({
      candidates: [
        {
          cacheMode: "default",
          diagnostics: [
            "Google AI Studio Gateway request failed with HTTP 400.",
            "invalid request",
          ],
          diagramValid: false,
          durationMs: expect.any(Number),
          error: "HTTP 400",
          model: "gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: "",
        },
      ],
      model: "google/gemini-3.1-flash-lite",
      scenarioId: "sketchi-onboarding-decision-flow",
    });
  });

  it("normalizes a throwing gateway factory into the prior candidate response", async () => {
    const result = await runGenerateScenarioCandidatesForInput(
      {
        providers: ["cloudflare-google-ai-studio"],
        scenarioId: "sketchi-onboarding-decision-flow",
      },
      {
        AI: {
          gateway: () => {
            throw new Error("gateway factory unavailable");
          },
        },
      },
    );

    expect(result).toEqual({
      candidates: [
        {
          cacheMode: "default",
          diagnostics: ["gateway factory unavailable"],
          diagramValid: false,
          error: "gateway factory unavailable",
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: "",
        },
      ],
      model: "google/gemini-3.1-flash-lite",
      scenarioId: "sketchi-onboarding-decision-flow",
    });
  });

  it("preserves the unknown-scenario candidate response", async () => {
    const gateway = vi.fn(() => ({
      getUrl: vi.fn(async () => ""),
      run: vi.fn(async () => new Response()),
    }));
    const result = await runGenerateScenarioCandidatesForInput(
      {
        providers: ["cloudflare-google-ai-studio"],
        scenarioId: "unknown-scenario",
      },
      { AI: { gateway } },
    );

    expect(result).toEqual({
      candidates: [
        {
          cacheMode: "default",
          diagnostics: ['Unknown scenario "unknown-scenario".'],
          diagramValid: false,
          error: 'Unknown scenario "unknown-scenario".',
          model: "google/gemini-3.1-flash-lite",
          provider: "cloudflare-google-ai-studio",
          text: "",
        },
      ],
      model: "google/gemini-3.1-flash-lite",
      scenarioId: "unknown-scenario",
    });
    expect(gateway).not.toHaveBeenCalled();
  });
});

let activeGenerationCount = 0;
let generationCallCount = 0;
let maxActiveGenerationCount = 0;
const concurrencyScenario = getScenario("sketchi-onboarding-decision-flow");
const concurrencyLayer = Layer.mergeAll(
  Layer.succeed(DiagramGenerationClient, {
    provider: "cloudflare-google-ai-studio",
    generate: Effect.fn("diagramGeneration.test.concurrency")(function* () {
      generationCallCount += 1;
      activeGenerationCount += 1;
      maxActiveGenerationCount = Math.max(
        maxActiveGenerationCount,
        activeGenerationCount,
      );
      yield* Effect.sleep("1 second");
      activeGenerationCount -= 1;

      return candidateFromText({
        model: "test-model",
        provider: "cloudflare-google-ai-studio",
        text: JSON.stringify(concurrencyScenario.expectedDiagram),
      });
    }),
  }),
  Layer.succeed(DiagramGenerationPolicy, {
    concurrency: 1,
    maxRetries: 0,
    requestTimeoutMs: 1_000,
    retryDelayMs: 0,
  }),
);

layer(concurrencyLayer)("eval generation policy", (it) => {
  it.effect("drives bounded forEach concurrency from the provided policy", () =>
    Effect.gen(function* () {
      activeGenerationCount = 0;
      generationCallCount = 0;
      maxActiveGenerationCount = 0;
      const fiber = yield* Effect.forkChild(
        generateScenarioCandidatesForInput({
          providers: [
            "cloudflare-google-ai-studio",
            "cloudflare-google-ai-studio",
            "cloudflare-google-ai-studio",
          ],
          scenarioId: concurrencyScenario.id,
        }),
      );
      yield* TestClock.adjust("5 seconds");
      const result = yield* Fiber.join(fiber);

      assert.strictEqual(result.candidates.length, 3);
      assert.strictEqual(generationCallCount, 3);
      assert.strictEqual(maxActiveGenerationCount, 1);
    }),
  );
});
