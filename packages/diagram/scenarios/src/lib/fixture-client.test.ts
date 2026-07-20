import { assert, layer } from "@effect/vitest";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { FixtureGenerationClientLayer } from "./fixture-client";
import { toDiagramGenerationPrompt } from "./prompt";
import { getScenario } from "./scenarios";

layer(FixtureGenerationClientLayer)(
  "scenario fixture generation client",
  (it) => {
    it.effect(
      "returns the maintained expected diagram for an adapted scenario",
      () =>
        Effect.gen(function* () {
          const scenario = getScenario("sketchi-onboarding-decision-flow");
          const client = yield* DiagramGenerationClient;
          const candidate = yield* client.generate({
            model: "fixture",
            prompt: toDiagramGenerationPrompt(scenario),
          });

          assert.isUndefined(candidate.error);
          assert.deepEqual(candidate.diagram, scenario.expectedDiagram);
        }),
    );

    it.effect("returns a typed input error for an unknown scenario", () =>
      Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const maintainedPrompt = toDiagramGenerationPrompt(
          getScenario("sketchi-onboarding-decision-flow"),
        );
        const error = yield* Effect.flip(
          client.generate({
            model: "fixture",
            prompt: { ...maintainedPrompt, id: "unknown-scenario" },
          }),
        );

        assert.strictEqual(error._tag, "DiagramGenerationInputError");
        assert.strictEqual(
          error.message,
          'Unknown scenario "unknown-scenario".',
        );
      }),
    );
  },
);
