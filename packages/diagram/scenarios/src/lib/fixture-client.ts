import {
	candidateFromText,
	DiagramGenerationClient,
	DiagramGenerationInputError,
	enforceCandidateRequestRequirements,
	errorMessage,
} from "@sketchi/diagram-generation";
import { Clock, Effect, Layer } from "effect";

import { type DiagramScenario, getDiagramScenario } from "./diagram-scenarios.js";

/** The typed intent plan a well-behaved model would author for the scenario. */
function fixtureRequirements(scenario: DiagramScenario): readonly Record<string, unknown>[] {
	if (scenario.diagramType === "sequence") {
		return [
			{
				kind: "count",
				target: "participants",
				comparator: "minimum",
				value: scenario.assertions.minParticipantCount,
			},
			{
				kind: "count",
				target: "messages",
				comparator: "minimum",
				value: scenario.assertions.minMessageCount,
			},
			...scenario.expectedDiagram.participants.map((participant) => ({
				kind: "label",
				target: "participant",
				value: participant.label,
			})),
		];
	}
	return [
		{
			kind: "count",
			target: "nodes",
			comparator: "minimum",
			value: scenario.assertions.minNodeCount,
		},
		...scenario.assertions.requiredNodeLabels.map((value) => ({
			kind: "label",
			target: "node",
			value,
		})),
		...scenario.assertions.requiredBranchLabels.map((value) => ({
			kind: "label",
			target: "branch",
			value,
		})),
	];
}

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
						requirements: fixtureRequirements(scenario),
					},
					diagram: { ...diagram, type },
				},
				null,
				2,
			),
		});
		const finishedAt = yield* Clock.currentTimeMillis;

		return {
			...enforceCandidateRequestRequirements(candidate, request),
			durationMs: Math.round(finishedAt - startedAt),
		};
	}),
});
