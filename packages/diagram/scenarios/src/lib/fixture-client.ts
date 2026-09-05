import {
  candidateFromText,
  DiagramGenerationClient,
  DiagramGenerationInputError,
  errorMessage,
} from "@sketchi/diagram-generation";
import { Clock, Effect, Layer } from "effect";

import { getScenario } from "./scenarios.js";

export const FixtureGenerationClientLayer = Layer.succeed(
  DiagramGenerationClient,
  {
    provider: "fixture",
    generate: Effect.fn("diagramGeneration.fixture.generate")(
      function* (request) {
        const startedAt = yield* Clock.currentTimeMillis;
        const scenario = yield* Effect.try({
          try: () => getScenario(request.prompt.id),
          catch: (cause) =>
            DiagramGenerationInputError.make({
              cause,
              message: errorMessage(cause, "Unknown generation scenario."),
              provider: "fixture",
              scenarioId: request.prompt.id,
            }),
        });
        const { title, type, ...diagram } = scenario.expectedDiagram;
        const candidate = candidateFromText({
          cacheMode: request.cacheMode ?? "default",
          model: "fixture",
          provider: "fixture",
          text: JSON.stringify(
            {
              title,
              intent: {
                requestedKind: type,
                nativeKind: type,
                requirements: [],
              },
              diagram: { ...diagram, type },
            },
            null,
            2,
          ),
        });
        const finishedAt = yield* Clock.currentTimeMillis;

        return {
          ...candidate,
          durationMs: Math.round(finishedAt - startedAt),
        };
      },
    ),
  },
);
