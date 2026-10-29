import { stateLabel } from "@sketchi/diagram-core";
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
	if (scenario.diagramType === "chart")
		return [
			{
				kind: "count",
				target: "categories",
				comparator: "exact",
				value: scenario.expectedDiagram.categories.length,
			},
			...scenario.expectedDiagram.categories.map((category) => ({
				kind: "label",
				target: "category",
				value: category,
			})),
		];
	if (scenario.diagramType === "gantt")
		return [
			{
				kind: "count",
				target: "tasks",
				comparator: "exact",
				value: scenario.expectedDiagram.tasks.length,
			},
			...scenario.expectedDiagram.tasks.map((task) => ({
				kind: "label",
				target: "task",
				value: task.label,
			})),
		];
	if (scenario.diagramType === "timeline")
		return [
			{
				kind: "count",
				target: "events",
				comparator: "exact",
				value: scenario.expectedDiagram.events.length,
			},
			...scenario.expectedDiagram.events.map((event) => ({
				kind: "label",
				target: "event",
				value: event.label,
			})),
		];
	if (scenario.diagramType === "mindmap")
		return [
			{
				kind: "count",
				target: "topics",
				comparator: "exact",
				value: scenario.expectedDiagram.nodes.length,
			},
			...scenario.expectedDiagram.nodes.map((node) => ({
				kind: "label",
				target: "topic",
				value: node.label,
			})),
		];
	if (scenario.diagramType === "state-machine")
		return [
			{
				kind: "count",
				target: "states",
				comparator: "minimum",
				value: scenario.expectedDiagram.states.length,
			},
			...scenario.expectedDiagram.states.flatMap((state) => {
				const label = stateLabel(state);
				return label === undefined
					? []
					: [{ kind: "label", target: "state", value: label } as const];
			}),
		];
	if (scenario.diagramType === "er")
		return [
			{
				kind: "count",
				target: "entities",
				comparator: "exact",
				value: scenario.expectedDiagram.entities.length,
			},
			...scenario.expectedDiagram.entities.map((entity) => ({
				kind: "label",
				target: "entity",
				value: entity.name ?? entity.id,
			})),
		];
	if (scenario.diagramType === "class")
		return [
			{
				kind: "count",
				target: "classes",
				comparator: "exact",
				value: scenario.expectedDiagram.classes.length,
			},
			...scenario.expectedDiagram.classes.map((node) => ({
				kind: "label",
				target: "class",
				value: node.name ?? node.id,
			})),
		];
	if (scenario.diagramType === "journey")
		return [
			{
				kind: "count",
				target: "tasks",
				comparator: "exact",
				value: scenario.expectedDiagram.stages.reduce(
					(total, stage) => total + stage.steps.length,
					0,
				),
			},
			...scenario.expectedDiagram.stages.map((stage) => ({
				kind: "label",
				target: "phase",
				value: stage.name,
			})),
		];
	if (scenario.diagramType === "sankey")
		return [
			{
				kind: "count",
				target: "links",
				comparator: "exact",
				value: scenario.expectedDiagram.links.length,
			},
			...scenario.expectedDiagram.nodes.map((node) => ({
				kind: "label",
				target: "node",
				value: node.label,
			})),
		];
	if (scenario.diagramType === "org-chart")
		return [
			{
				kind: "count",
				target: "people",
				comparator: "exact",
				value: scenario.expectedDiagram.people.length,
			},
			...scenario.expectedDiagram.people.map((person) => ({
				kind: "label",
				target: "person",
				value: person.name,
			})),
		];
	if (scenario.diagramType === "venn")
		return [
			{
				kind: "count",
				target: "items",
				comparator: "exact",
				value: scenario.expectedDiagram.regions.reduce(
					(sum, region) => sum + (region.items?.length ?? 0),
					0,
				),
			},
			...scenario.expectedDiagram.sets.map((set) => ({
				kind: "label",
				target: "set",
				value: set.label,
			})),
		];
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
