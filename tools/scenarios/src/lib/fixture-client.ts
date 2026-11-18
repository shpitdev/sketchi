import {
	candidateFromText,
	enforceCandidateRequestRequirements,
} from "@sketchi/diagrams/generate/candidates";
import { DiagramGenerationClient } from "@sketchi/diagrams/generate/client";
import { DiagramGenerationInputError, errorMessage } from "@sketchi/diagrams/generate/errors";
import { Clock, Effect, Layer } from "effect";

import { getDiagramScenario } from "./diagram-scenarios";
import { scenarioFlowchartDocument } from "./flowchart-document";

export const FixtureGenerationClientLayer = Layer.succeed(DiagramGenerationClient, {
	provider: "fixture",
	generate: Effect.fn("diagramGeneration.fixture.generate")(function* (request) {
		const startedAt = yield* Clock.currentTimeMillis;
		const scenario = yield* Effect.try({
			try: () => getDiagramScenario(request.prompt.id),
			catch: (cause) =>
				DiagramGenerationInputError.make({
					cause,
					message: errorMessage(cause, "Unknown generation scenario."),
					provider: "fixture",
					scenarioId: request.prompt.id,
				}),
		});
		const expected = scenario.expectedDiagram;
		// A model writes a flowchart as its document, and every other family as its diagram.
		const { title, ...diagram } =
			expected.type === "flowchart"
				? { ...scenarioFlowchartDocument(expected), type: "flowchart" }
				: expected;
		const candidate = candidateFromText({
			model: "fixture",
			provider: "fixture",
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The fixture client supplies the same authored JSON bytes as the generation harness.
			text: JSON.stringify({ title, diagram }, null, 2),
		});
		const finishedAt = yield* Clock.currentTimeMillis;

		return {
			...enforceCandidateRequestRequirements(candidate, request),
			durationMs: Math.round(finishedAt - startedAt),
		};
	}),
});
