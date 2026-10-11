import {
	type CanonicalDiagram,
	type FlowchartDiagram,
	type SequenceDiagram,
	parseFlowchartDiagram,
	parseSequenceDiagram,
	sequenceActivations,
} from "@sketchi/diagram-core";
import {
	convertSceneToExcalidraw,
	validateExcalidrawScene,
	type ExcalidrawScene,
	type ExcalidrawSceneValidationResult,
} from "@sketchi/diagram-excalidraw";
import { renderDiagram, type RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { termTokens } from "@sketchi/icon-catalog";

import type { DiagramScenario } from "./diagram-scenarios.js";
import type { FlowchartScenario, DiagramScenarioLogo } from "./scenarios.js";
import type { SequenceScenario, SequenceScenarioMessage } from "./sequence-scenarios.js";

export interface ScenarioCheck {
	id: string;
	message: string;
	passed: boolean;
}

export interface ScenarioEvaluation {
	checks: ScenarioCheck[];
	diagram: CanonicalDiagram;
	excalidrawScene: ExcalidrawScene;
	excalidrawValidation: ExcalidrawSceneValidationResult;
	ok: boolean;
	scenarioId: string;
	scene: RenderedDiagramScene;
}

function normalizeLabel(label: string): string {
	return label.trim().toLowerCase();
}

function hasLabel(labels: readonly string[], expected: string): boolean {
	const normalized = normalizeLabel(expected);
	return labels.some((label) => normalizeLabel(label).includes(normalized));
}

function edgeMatchesExpected(
	diagram: FlowchartDiagram,
	expected: FlowchartScenario["assertions"]["requiredEdges"][number],
): boolean {
	const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]));
	const expectedSourceLabel = normalizeLabel(expected.sourceLabel);
	const expectedTargetLabel = normalizeLabel(expected.targetLabel);
	const expectedBranchLabel = expected.label ? normalizeLabel(expected.label) : null;

	return diagram.edges.some((edge) => {
		const source = nodesById.get(edge.source);
		const target = nodesById.get(edge.target);

		if (!source || !target) {
			return false;
		}

		const sourceMatches = normalizeLabel(source.label).includes(expectedSourceLabel);
		const targetMatches = normalizeLabel(target.label).includes(expectedTargetLabel);
		const branchMatches =
			expectedBranchLabel === null
				? true
				: normalizeLabel(edge.label ?? "").includes(expectedBranchLabel);

		return sourceMatches && targetMatches && branchMatches;
	});
}

/** What logo checks need from a scenario. */
export interface ScenarioLogoExpectations {
	readonly logos: readonly DiagramScenarioLogo[];
	readonly requiredIconSlugs: readonly string[];
}

/** The label contains one of the logo's names as whole words. */
function labelNamesLogo(label: string, logo: DiagramScenarioLogo): boolean {
	const words = ` ${termTokens(label).join(" ")} `;
	return [logo.slug.replaceAll("-", " "), logo.name, ...(logo.aliases ?? [])]
		.map((term) => termTokens(term).join(" "))
		.some((phrase) => phrase !== "" && words.includes(` ${phrase} `));
}

/**
 * Logo checks on the model's own diagram, before generation places, drops, or
 * grounds its logos, so they measure the model rather than the repair:
 * recall for each named technology, precision against the prompt, and
 * whether each logo sits on the flowchart step or sequence participant that
 * names it. A logo on a generic or unnamed one ("Sync order", "Run the test
 * suite", "Developer") fails the last check.
 */
export function scenarioLogoChecks(
	expected: ScenarioLogoExpectations,
	modelDiagram: FlowchartDiagram | SequenceDiagram,
): ScenarioCheck[] {
	const offered = new Map(expected.logos.map((logo) => [logo.slug, logo]));
	// Flowcharts draw logos on nodes; sequence diagrams on participants.
	const owner = modelDiagram.type === "flowchart" ? "step" : "participant";
	const elements: readonly {
		readonly icon?: { readonly slug: string } | undefined;
		readonly label: string;
	}[] = modelDiagram.type === "flowchart" ? modelDiagram.nodes : modelDiagram.participants;
	const icons = elements.flatMap((element) =>
		element.icon ? [{ label: element.label, slug: element.icon.slug }] : [],
	);
	const ungrounded = icons.filter((icon) => !offered.has(icon.slug));
	const misplaced = icons.filter((icon) => {
		const logo = offered.get(icon.slug);
		return !logo || !labelNamesLogo(icon.label, logo);
	});
	return [
		...expected.requiredIconSlugs.map((slug) => ({
			id: `icon:${slug}`,
			passed: icons.some((icon) => icon.slug === slug),
			message: `Expected the model to draw the "${slug}" logo.`,
		})),
		{
			id: "icons-grounded",
			passed: ungrounded.length === 0,
			message:
				ungrounded.length === 0
					? "Every logo is a technology the prompt names."
					: `Logos the prompt does not name: ${ungrounded.map((icon) => icon.slug).join(", ")}.`,
		},
		{
			id: "icons-on-named-steps",
			passed: misplaced.length === 0,
			message:
				misplaced.length === 0
					? `Every logo sits on a ${owner} that names its technology.`
					: `Logos on ${owner}s that do not name them: ${misplaced
							.map((icon) => `"${icon.label}" (${icon.slug})`)
							.join(", ")}.`,
		},
	];
}

function flowchartChecks(scenario: FlowchartScenario, diagram: FlowchartDiagram): ScenarioCheck[] {
	const nodeLabels = diagram.nodes.map((node) => node.label);
	const branchLabels = diagram.edges
		.map((edge) => edge.label)
		.filter((label): label is string => Boolean(label));
	const nodeKinds = new Set(diagram.nodes.map((node) => node.kind));

	return [
		{
			id: "min-node-count",
			passed: diagram.nodes.length >= scenario.assertions.minNodeCount,
			message: `Expected at least ${scenario.assertions.minNodeCount} nodes.`,
		},
		{
			id: "min-edge-count",
			passed: diagram.edges.length >= scenario.assertions.minEdgeCount,
			message: `Expected at least ${scenario.assertions.minEdgeCount} edges.`,
		},
		...scenario.assertions.requiredNodeKinds.map((kind) => ({
			id: `node-kind:${kind}`,
			passed: nodeKinds.has(kind),
			message: `Expected at least one ${kind} node.`,
		})),
		...scenario.assertions.requiredNodeLabels.map((label) => ({
			id: `node-label:${label}`,
			passed: hasLabel(nodeLabels, label),
			message: `Expected a node label like "${label}".`,
		})),
		...scenario.assertions.requiredBranchLabels.map((label) => ({
			id: `branch-label:${label}`,
			passed: hasLabel(branchLabels, label),
			message: `Expected a decision branch label like "${label}".`,
		})),
		...scenario.assertions.requiredEdges.map((edge) => ({
			id: `edge:${edge.sourceLabel}->${edge.targetLabel}${edge.label ? `:${edge.label}` : ""}`,
			passed: edgeMatchesExpected(diagram, edge),
			message: `Expected an edge from "${edge.sourceLabel}" to "${
				edge.targetLabel
			}"${edge.label ? ` labeled like "${edge.label}"` : ""}.`,
		})),
	];
}

export function extractJsonCandidate(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch {
		const firstBrace = output.indexOf("{");
		const lastBrace = output.lastIndexOf("}");

		if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
			throw new Error("Model output did not contain a JSON object.");
		}

		return JSON.parse(output.slice(firstBrace, lastBrace + 1));
	}
}

function excalidrawCheck(scene: RenderedDiagramScene) {
	const excalidrawScene = convertSceneToExcalidraw(scene);
	const excalidrawValidation = validateExcalidrawScene(excalidrawScene);
	return {
		excalidrawScene,
		excalidrawValidation,
		check: {
			id: "excalidraw-scene",
			passed: excalidrawValidation.ok,
			message:
				excalidrawValidation.issues.length === 0
					? "Excalidraw scene has bound arrows, non-overlapping routes, and fitting text."
					: `${excalidrawValidation.issues.length} Excalidraw validation issue(s).`,
		},
	};
}

function evaluation(
	scenarioId: string,
	diagram: CanonicalDiagram,
	familyChecks: readonly ScenarioCheck[],
): ScenarioEvaluation {
	const scene = renderDiagram(diagram);
	const { check, excalidrawScene, excalidrawValidation } = excalidrawCheck(scene);
	const checks = [...familyChecks, check];
	return {
		checks,
		diagram,
		excalidrawScene,
		excalidrawValidation,
		ok: checks.every((entry) => entry.passed),
		scenarioId,
		scene,
	};
}

/**
 * The text contains one alternative. Short alternatives ("ok", "ack", "200")
 * must be whole words, so "ok" never matches "Card token"; longer ones are
 * stems ("approv", "verif") and match inside words.
 */
function matchesAny(text: string, alternatives: readonly string[] | undefined): boolean {
	if (!alternatives) return true;
	const normalized = normalizeLabel(text);
	const words = new Set(normalized.split(/[^\p{L}\p{N}]+/u));
	return alternatives.some((alternative) => {
		const expected = normalizeLabel(alternative);
		return expected.length <= 3 ? words.has(expected) : normalized.includes(expected);
	});
}

function sequenceMessageMatches(
	diagram: SequenceDiagram,
	index: number,
	expected: SequenceScenarioMessage,
): boolean {
	const message = diagram.messages[index];
	if (!message) return false;
	const labels = new Map(
		diagram.participants.map((participant) => [participant.id, participant.label]),
	);
	return (
		matchesAny(labels.get(message.source) ?? "", expected.source) &&
		matchesAny(labels.get(message.target) ?? "", expected.target) &&
		matchesAny(message.label, expected.label) &&
		(expected.type === undefined || (message.type ?? "message") === expected.type)
	);
}

function describeSequenceMessage(expected: SequenceScenarioMessage): string {
	const label = expected.label ? ` "${expected.label.join("|")}"` : "";
	const type = expected.type === "return" ? " return" : "";
	return `${expected.source.join("|")} -> ${expected.target.join("|")}${type}${label}`;
}

/**
 * Sequence checks score structure the model must get right: who takes part,
 * which messages flow between them, their chronological order, and whether
 * every return answers a call (the pairs Sketchi draws as activation bars).
 */
export function sequenceScenarioChecks(
	scenario: SequenceScenario,
	diagram: SequenceDiagram,
): ScenarioCheck[] {
	const { assertions } = scenario;
	const participantLabels = diagram.participants.map((participant) => participant.label);
	const spans = sequenceActivations(diagram);
	const answered = spans.length;
	const returns = diagram.messages.filter((message) => message.type === "return").length;
	let cursor = 0;
	const unordered: string[] = [];
	for (const expected of assertions.orderedMessages) {
		let found = -1;
		for (let index = cursor; index < diagram.messages.length; index += 1) {
			if (sequenceMessageMatches(diagram, index, expected)) {
				found = index;
				break;
			}
		}
		if (found === -1) {
			unordered.push(describeSequenceMessage(expected));
		} else {
			cursor = found + 1;
		}
	}

	const unanswered = (assertions.unansweredCalls ?? []).map((expected, index) => {
		const calls = diagram.messages.flatMap((message, messageIndex) =>
			(message.type ?? "message") === "message" &&
			sequenceMessageMatches(diagram, messageIndex, expected)
				? [message.id]
				: [],
		);
		const answeredCalls = calls.filter((id) => spans.some((span) => span.callMessageId === id));
		return {
			id: `unanswered:${index + 1}`,
			passed: calls.length > 0 && answeredCalls.length === 0,
			message:
				calls.length === 0
					? `Expected a fire-and-forget call ${describeSequenceMessage(expected)}.`
					: answeredCalls.length === 0
						? `The call ${describeSequenceMessage(expected)} is fire-and-forget.`
						: `The fire-and-forget call ${describeSequenceMessage(expected)} was answered by a return.`,
		};
	});

	return [
		{
			id: "min-participant-count",
			passed: diagram.participants.length >= assertions.minParticipantCount,
			message: `Expected at least ${assertions.minParticipantCount} participants.`,
		},
		{
			id: "min-message-count",
			passed: diagram.messages.length >= assertions.minMessageCount,
			message: `Expected at least ${assertions.minMessageCount} messages.`,
		},
		...assertions.requiredParticipants.map((alternatives) => ({
			id: `participant:${alternatives[0] ?? ""}`,
			passed: participantLabels.some((label) => matchesAny(label, alternatives)),
			message: `Expected a participant like "${alternatives.join("|")}".`,
		})),
		...assertions.orderedMessages.map((expected, index) => ({
			id: `message:${index + 1}`,
			passed: diagram.messages.some((_, messageIndex) =>
				sequenceMessageMatches(diagram, messageIndex, expected),
			),
			message: `Expected a message ${describeSequenceMessage(expected)}.`,
		})),
		{
			id: "message-order",
			passed: unordered.length === 0,
			message:
				unordered.length === 0
					? "Required messages appear in chronological order."
					: `Out of order or missing: ${unordered.join("; ")}.`,
		},
		...unanswered,
		{
			id: "answered-calls",
			passed: answered >= assertions.minAnsweredCalls,
			message: `Expected at least ${assertions.minAnsweredCalls} calls answered by a return; found ${answered}.`,
		},
		{
			id: "returns-answer-calls",
			passed: answered === returns,
			message:
				answered === returns
					? "Every return answers an earlier call between the same participants."
					: `${returns - answered} return(s) answer no open call.`,
		},
	];
}

/**
 * Evaluate the diagram generation returns. Pass the model's own diagram from
 * before candidate enforcement as `modelCandidate` so model-quality checks
 * (logos, sequence structure) score the model; it defaults to the returned
 * diagram for unrepaired output.
 */
export function evaluateScenarioDiagram(
	scenario: DiagramScenario,
	candidate: unknown,
	modelCandidate: unknown = candidate,
): ScenarioEvaluation {
	if (scenario.diagramType === "sequence") {
		const diagram = parseSequenceDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseSequenceDiagram(modelCandidate);
		return evaluation(scenario.id, diagram, [
			...sequenceScenarioChecks(scenario, modelDiagram),
			...scenarioLogoChecks(
				{ logos: scenario.logos, requiredIconSlugs: scenario.assertions.requiredIconSlugs },
				modelDiagram,
			),
		]);
	}
	const diagram = parseFlowchartDiagram(candidate);
	const modelDiagram =
		modelCandidate === candidate ? diagram : parseFlowchartDiagram(modelCandidate);
	return evaluation(scenario.id, diagram, [
		...flowchartChecks(scenario, diagram),
		...scenarioLogoChecks(
			{
				logos: scenario.logos,
				requiredIconSlugs: scenario.assertions.requiredIconSlugs,
			},
			modelDiagram,
		),
	]);
}

export function evaluateScenarioOutput(
	scenario: DiagramScenario,
	output: string,
): ScenarioEvaluation {
	return evaluateScenarioDiagram(scenario, extractJsonCandidate(output));
}

export function evaluateScenarioFixture(scenario: DiagramScenario): ScenarioEvaluation {
	return evaluateScenarioDiagram(scenario, scenario.expectedDiagram);
}
