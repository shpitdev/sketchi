import { assert, layer } from "@effect/vitest";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate";
import { FixtureGenerationClientLayer } from "./fixture-client";
import { scenarioFlowchartDocument } from "./flowchart-document";
import { toDiagramGenerationPrompt } from "./prompt";
import { getFlowchartScenario } from "./scenarios";

layer(FixtureGenerationClientLayer)("scenario fixture generation client", (it) => {
	it.effect("returns the maintained expected diagram for an adapted scenario", () =>
		Effect.gen(function* () {
			const scenario = getFlowchartScenario("sketchi-onboarding-decision-flow");
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "fixture",
				prompt: toDiagramGenerationPrompt(scenario),
			});

			assert.isUndefined(candidate.error);
			// The model answers with the expected diagram's document, which draws the same graph.
			assert.deepEqual(candidate.flowchart, scenarioFlowchartDocument(scenario.expectedDiagram));
			const drawn = candidate.diagram;
			if (drawn?.type !== "flowchart") throw new Error("Expected a flowchart.");
			assert.deepEqual(
				drawn.nodes.map((node) => [node.id, node.label, node.kind, node.icon?.slug]),
				scenario.expectedDiagram.nodes.map((node) => [
					node.id,
					node.label,
					node.kind,
					node.icon?.slug,
				]),
			);
			assert.deepEqual(
				drawn.edges.map((edge) => [edge.source, edge.target, edge.label]),
				scenario.expectedDiagram.edges.map((edge) => [edge.source, edge.target, edge.label]),
			);
		}),
	);

	it.effect("keeps a curved scenario curved through the document a model returns", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			for (const id of [
				"feedback-triage-curved",
				"ingest-pipeline-curved-lr",
				"checkout-services-curved-zones",
			]) {
				const scenario = getFlowchartScenario(id);
				const candidate = yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario),
				});
				assert.strictEqual(candidate.flowchart?.curved, true);
				const drawn = candidate.diagram;
				if (drawn?.type !== "flowchart") throw new Error("Expected a flowchart.");
				assert.strictEqual(drawn.layout.edgeRouting, "curved");
				assert.deepEqual(
					evaluateScenarioDiagram(scenario, drawn).checks.filter((check) => !check.passed),
					[],
				);
			}
		}),
	);

	it.effect("returns a typed input error for an unknown scenario", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			const maintainedPrompt = toDiagramGenerationPrompt(
				getFlowchartScenario("sketchi-onboarding-decision-flow"),
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
					...toDiagramGenerationPrompt(getFlowchartScenario("sketchi-onboarding-decision-flow")),
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
});
