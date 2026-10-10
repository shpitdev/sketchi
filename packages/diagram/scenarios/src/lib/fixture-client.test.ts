import { assert, layer } from "@effect/vitest";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";
import { vi } from "vitest";

import { FixtureGenerationClientLayer } from "./fixture-client";
import { toDiagramGenerationPrompt } from "./prompt";
import { getScenario } from "./scenarios";
import * as scenarios from "./scenarios";

layer(FixtureGenerationClientLayer)("scenario fixture generation client", (it) => {
	it.effect("returns the maintained expected diagram for an adapted scenario", () =>
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
			assert.strictEqual(error.message, 'Unknown scenario "unknown-scenario".');
		}),
	);

	it.effect("enforces a conflicting explicit diagram type like the live layer", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "fixture",
				prompt: {
					...toDiagramGenerationPrompt(getScenario("sketchi-onboarding-decision-flow")),
					requestedType: "mindmap",
				},
			});
			assert.isUndefined(candidate.diagram);
			assert.isDefined(candidate.error);
			assert.isTrue(
				candidate.diagnostics.some((message) => message.includes("explicit_type_not_met")),
			);
		}),
	);

	it.effect("checks the maintained typed count plan against fixture IR", () =>
		Effect.gen(function* () {
			const scenario = getScenario("sketchi-onboarding-decision-flow");
			const getter = vi.spyOn(scenarios, "getScenario").mockReturnValue({
				...scenario,
				assertions: {
					...scenario.assertions,
					minNodeCount: scenario.expectedDiagram.nodes.length + 1,
				},
			});
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client
				.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario),
				})
				.pipe(Effect.ensuring(Effect.sync(() => getter.mockRestore())));
			assert.isUndefined(candidate.diagram);
			assert.isTrue(
				candidate.diagnostics.some((message) => message.includes("requirement_count_not_met")),
			);
		}),
	);
});
