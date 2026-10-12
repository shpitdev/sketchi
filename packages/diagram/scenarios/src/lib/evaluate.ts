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
import { flowchartLabelMatches } from "./flowchart-labels.js";

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

function edgeMatchesExpected(
	diagram: FlowchartDiagram,
	expected: FlowchartScenario["assertions"]["requiredEdges"][number],
	matchedNodes: ReadonlyMap<string, ReadonlySet<string>>,
	paths?: { fromStart: ReadonlySet<string>; toEnd: ReadonlySet<string> },
): boolean {
	return diagram.edges.some(
		(edge) =>
			matchedNodes.get(expected.sourceId)?.has(edge.source) &&
			matchedNodes.get(expected.targetId)?.has(edge.target) &&
			(!paths || (paths.fromStart.has(edge.source) && paths.toEnd.has(edge.target))) &&
			(!expected.labels || flowchartLabelMatches(edge.label ?? "", expected.labels)),
	);
}

/** Keep split-step witnesses on a continuous scenario-valid start-to-end path. */
function scenarioPathFinder(scenario: FlowchartScenario, diagram: FlowchartDiagram) {
	const kinds = new Map(scenario.assertions.requiredNodes.map((node) => [node.id, node.kind]));
	// Branch matching does not depend on ownership; do it once, not per search state.
	const connections = diagram.edges.map((edge) => ({
		edge,
		expected: scenario.assertions.requiredEdges.filter(
			(expected) => !expected.labels || flowchartLabelMatches(edge.label ?? "", expected.labels),
		),
	}));
	return (
		owners: ReadonlyMap<string, string>,
		domains?: ReadonlyMap<string, readonly string[]>,
	) => {
		const steps = (node: string): readonly string[] => {
			const owner = owners.get(node);
			return owner === undefined ? (domains?.get(node) ?? []) : [owner];
		};
		const allowed = connections
			.filter(({ edge, expected }) =>
				steps(edge.source).some((source) =>
					steps(edge.target).some(
						(target) =>
							source === target ||
							expected.some((pair) => pair.sourceId === source && pair.targetId === target),
					),
				),
			)
			.map(({ edge }) => edge);
		function reachable(kind: "start" | "end", reverse: boolean): Set<string> {
			const queue = diagram.nodes
				.filter((node) => steps(node.id).some((step) => kinds.get(step) === kind))
				.map((node) => node.id);
			const visited = new Set(queue);
			for (let index = 0; index < queue.length; index += 1) {
				for (const edge of allowed) {
					if ((reverse ? edge.target : edge.source) !== queue[index]) continue;
					const next = reverse ? edge.source : edge.target;
					if (!visited.has(next)) {
						visited.add(next);
						queue.push(next);
					}
				}
			}
			return visited;
		}
		return { fromStart: reachable("start", false), toEnd: reachable("end", true) };
	};
}

const MAX_OWNERSHIP_STATES = 10_000;

/** Find edge witnesses whose model nodes have one consistent step ownership. */
function connectedStepOwners(
	scenario: FlowchartScenario,
	diagram: FlowchartDiagram,
	matchedNodes: ReadonlyMap<string, ReadonlySet<string>>,
	findPaths: ReturnType<typeof scenarioPathFinder>,
): { owners: Map<string, string> | undefined; exhausted: boolean } {
	const choices = scenario.assertions.requiredEdges.map((expected) => ({
		expected,
		candidates: diagram.edges.filter(
			(edge) =>
				matchedNodes.get(expected.sourceId)?.has(edge.source) &&
				matchedNodes.get(expected.targetId)?.has(edge.target) &&
				(!expected.labels || flowchartLabelMatches(edge.label ?? "", expected.labels)),
		),
	}));
	const domains = new Map<string, string[]>();
	for (const [step, nodes] of matchedNodes) {
		for (const node of nodes) domains.set(node, [...(domains.get(node) ?? []), step]);
	}
	const uniqueOwners = new Map(
		[...domains]
			.filter(([, steps]) => steps.length === 1)
			.map(([node, steps]) => [node, steps[0]!]),
	);
	let visitedStates = 0;
	let exhausted = false;
	function enterState(): boolean {
		if (visitedStates >= MAX_OWNERSHIP_STATES) {
			exhausted = true;
			return false;
		}
		visitedStates += 1;
		return true;
	}
	function viableCandidates(
		choice: (typeof choices)[number],
		owners: ReadonlyMap<string, string>,
		paths: ReturnType<ReturnType<typeof scenarioPathFinder>>,
	) {
		return choice.candidates.filter((edge) => {
			const sourceOwner = owners.get(edge.source);
			const targetOwner = owners.get(edge.target);
			return (
				(sourceOwner === undefined || sourceOwner === choice.expected.sourceId) &&
				(targetOwner === undefined || targetOwner === choice.expected.targetId) &&
				paths.fromStart.has(edge.source) &&
				paths.toEnd.has(edge.target)
			);
		});
	}
	function completePaths(owners: ReadonlyMap<string, string>): Map<string, string> | undefined {
		if (!enterState()) return undefined;
		// Relax unowned nodes to all their roles. Impossible paths can be pruned
		// without enumerating irrelevant ambiguity or rejecting a valid assignment.
		const possiblePaths = findPaths(owners, domains);
		if (choices.some((choice) => viableCandidates(choice, owners, possiblePaths).length === 0))
			return undefined;
		const paths = findPaths(owners);
		if (
			choices.every(({ expected, candidates }) =>
				candidates.some(
					(edge) =>
						owners.get(edge.source) === expected.sourceId &&
						owners.get(edge.target) === expected.targetId &&
						paths.fromStart.has(edge.source) &&
						paths.toEnd.has(edge.target),
				),
			)
		)
			return new Map(owners);
		const unowned = [...domains].find(
			([node]) =>
				!owners.has(node) && possiblePaths.fromStart.has(node) && possiblePaths.toEnd.has(node),
		);
		if (!unowned) return undefined;
		for (const step of unowned[1]) {
			const next = new Map(owners);
			next.set(unowned[0], step);
			const result = completePaths(next);
			if (result) return result;
			if (exhausted) return undefined;
		}
		return undefined;
	}
	const failed = new Set<string>();
	function search(
		pending: readonly number[],
		owners: ReadonlyMap<string, string>,
	): Map<string, string> | undefined {
		if (pending.length === 0) return completePaths(owners);
		if (!enterState()) return undefined;
		const key = JSON.stringify([pending, [...owners].sort(([a], [b]) => a.localeCompare(b))]);
		if (failed.has(key)) return undefined;
		let selected = pending[0]!;
		let candidates: FlowchartDiagram["edges"] | undefined;
		const possiblePaths = findPaths(owners, domains);
		for (const index of pending) {
			const choice = choices[index]!;
			const viable = viableCandidates(choice, owners, possiblePaths);
			if (viable.length === 0) {
				failed.add(key);
				return undefined;
			}
			if (candidates === undefined || viable.length < candidates.length) {
				selected = index;
				candidates = viable;
			}
		}
		const choice = choices[selected]!;
		for (const edge of candidates ?? []) {
			const next = new Map(owners);
			next.set(edge.source, choice.expected.sourceId);
			next.set(edge.target, choice.expected.targetId);
			const result = search(
				pending.filter((index) => index !== selected),
				next,
			);
			if (result) return result;
			if (exhausted) return undefined;
		}
		failed.add(key);
		return undefined;
	}
	const owners = search(
		choices.map((_, index) => index),
		uniqueOwners,
	);
	return { owners, exhausted };
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
	const matchedNodes = new Map(
		scenario.assertions.requiredNodes.map((expected) => [
			expected.id,
			new Set(
				diagram.nodes
					.filter(
						(node) =>
							node.kind === expected.kind && flowchartLabelMatches(node.label, expected.labels),
					)
					.map((node) => node.id),
			),
		]),
	);
	// A node-only maximum matching supplies useful failure diagnostics if no
	// consistent connected assignment exists; successful checks use edge witnesses.
	const owners = new Map<string, string>();
	function assignStep(stepId: string, visited: Set<string>): boolean {
		for (const nodeId of matchedNodes.get(stepId) ?? []) {
			if (visited.has(nodeId)) continue;
			visited.add(nodeId);
			const owner = owners.get(nodeId);
			if (owner === undefined || assignStep(owner, visited)) {
				owners.set(nodeId, stepId);
				return true;
			}
		}
		return false;
	}
	for (const step of scenario.assertions.requiredNodes) assignStep(step.id, new Set());
	const findPaths = scenarioPathFinder(scenario, diagram);
	const connectedSearch =
		owners.size === scenario.assertions.requiredNodes.length
			? connectedStepOwners(scenario, diagram, matchedNodes, findPaths)
			: undefined;
	const selectedOwners = connectedSearch?.owners ?? owners;
	for (const [stepId, nodes] of matchedNodes) {
		for (const nodeId of nodes) {
			if (
				!selectedOwners.has(nodeId) &&
				[...matchedNodes.values()].filter((set) => set.has(nodeId)).length === 1
			) {
				selectedOwners.set(nodeId, stepId);
			}
		}
	}
	const ownedNodes = new Map(
		scenario.assertions.requiredNodes.map((node) => [
			node.id,
			new Set(
				[...selectedOwners].filter(([, stepId]) => stepId === node.id).map(([nodeId]) => nodeId),
			),
		]),
	);
	const distinctSteps = new Set(selectedOwners.values());
	const paths = findPaths(selectedOwners);
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
		...scenario.assertions.requiredNodes.map((node) => ({
			id: `node-label:${node.label}`,
			passed: distinctSteps.has(node.id),
			message: `Expected a distinct ${node.kind} node matching any of: ${node.labels.join(" | ")}.`,
		})),
		...scenario.assertions.requiredBranchLabels.map((label) => ({
			id: `branch-label:${label}`,
			passed: branchLabels.some((branch) =>
				flowchartLabelMatches(
					branch,
					scenario.assertions.requiredEdges
						.filter((edge) => edge.label === label)
						.flatMap((edge) => edge.labels ?? []),
				),
			),
			message: `Expected a decision branch label like "${label}" or its alternatives.`,
		})),
		...scenario.assertions.requiredEdges.map((edge) => {
			const passed = edgeMatchesExpected(diagram, edge, ownedNodes, paths);
			return {
				id: `edge:${edge.sourceLabel}->${edge.targetLabel}${edge.label ? `:${edge.label}` : ""}`,
				passed,
				message:
					`Expected an edge from "${edge.sourceLabel}" to "${edge.targetLabel}"${edge.label ? ` labeled like "${edge.label}"` : ""}.` +
					(connectedSearch?.exhausted && !passed
						? ` Ownership search reached its ${MAX_OWNERSHIP_STATES}-state limit; this connection was not verified.`
						: ""),
			};
		}),
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
