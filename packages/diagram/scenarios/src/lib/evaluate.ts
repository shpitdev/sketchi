import {
	chartClearRulesCheck,
	chartDrawnDataCheck,
	chartGeometryCheck,
	chartPieLabelCheck,
	chartScenarioChecks,
} from "./chart-scenarios.js";
import {
	timelineGapOrderCheck,
	timelineScenarioChecks,
	timelineSpacingCheck,
} from "./timeline-scenarios.js";
import { stateMachineScenarioChecks } from "./state-machine-scenarios.js";
import { mindmapLayoutCheck, mindmapScenarioChecks } from "./mindmap-scenarios.js";
import { erDrawnCheck, erScenarioChecks } from "./er-scenarios.js";
import { classClearanceCheck, classDrawnCheck, classScenarioChecks } from "./class-scenarios.js";
import {
	orgChartDrawnCheck,
	orgChartLayoutCheck,
	orgChartScenarioChecks,
} from "./org-chart-scenarios.js";
import {
	ganttClearanceCheck,
	ganttDrawnDataCheck,
	ganttGeometryCheck,
	ganttScenarioChecks,
} from "./gantt-scenarios.js";
import {
	type CanonicalDiagram,
	type FlowchartDiagram,
	type SequenceDiagram,
	parseFlowchartDiagram,
	parseMindmapDiagram,
	parseSequenceDiagram,
	parseStateMachineDiagram,
	parseErDiagram,
	parseClassDiagram,
	parseOrgChartDiagram,
	parseTimelineDiagram,
	parseChartDiagram,
	parseGanttDiagram,
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
import { flowchartLabelMatches } from "./flowchart-labels.js";
import type { FlowchartScenario, DiagramScenarioLogo } from "./scenarios.js";
import type { SequenceScenario, SequenceScenarioMessage } from "./sequence-scenarios.js";
import {
	type BranchMatcher,
	type ExpectedEdge,
	type FlowchartConnection,
	matchFlowchartSteps,
} from "./flowchart-matching.js";

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

const MAX_INTERMEDIATE_NODES = 2;

/** Collapse only unmatched stages; retain the decision's first-hop caption. */
function scenarioConnections(
	diagram: FlowchartDiagram,
	matchedNodes: ReadonlyMap<string, ReadonlySet<string>>,
): FlowchartConnection[] {
	// Use every typed match, not just the ownership chosen by the search.
	const namedSteps = new Set([...matchedNodes.values()].flatMap((nodes) => [...nodes]));
	const outgoing = new Map<string, FlowchartDiagram["edges"]>();
	for (const edge of diagram.edges) {
		outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
	}
	const connections = new Map<string, FlowchartConnection>();
	for (const first of diagram.edges) {
		function visit(target: string, visited: ReadonlySet<string>) {
			const connection = { source: first.source, target, label: first.label };
			connections.set(JSON.stringify([connection.source, target, first.label]), connection);
			if (namedSteps.has(target) || visited.size > MAX_INTERMEDIATE_NODES) return;
			const nextVisited = new Set([...visited, target]);
			for (const edge of outgoing.get(target) ?? []) {
				if (!nextVisited.has(edge.target)) visit(edge.target, nextVisited);
			}
		}
		visit(first.target, new Set([first.source]));
	}
	return [...connections.values()];
}

function edgeMatchesExpected(
	connections: readonly FlowchartConnection[],
	expected: ExpectedEdge,
	matchedNodes: ReadonlyMap<string, ReadonlySet<string>>,
	branchMatches: BranchMatcher,
	paths?: { fromStart: ReadonlySet<string>; toEnd: ReadonlySet<string> },
): boolean {
	return connections.some(
		(edge) =>
			matchedNodes.get(expected.sourceId)?.has(edge.source) &&
			matchedNodes.get(expected.targetId)?.has(edge.target) &&
			(!paths || (paths.fromStart.has(edge.source) && paths.toEnd.has(edge.target))) &&
			branchMatches(edge, expected),
	);
}

/** Keep split-step witnesses on a continuous scenario-valid start-to-end path. */
function scenarioPathFinder(
	scenario: FlowchartScenario,
	diagram: FlowchartDiagram,
	paths: readonly FlowchartConnection[],
	branchMatches: BranchMatcher,
) {
	const kinds = new Map(scenario.assertions.requiredNodes.map((node) => [node.id, node.kind]));
	// Branch matching does not depend on ownership; do it once, not per search state.
	const connections = paths.map((edge) => ({
		edge,
		expected: scenario.assertions.requiredEdges.filter((expected) => branchMatches(edge, expected)),
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
	connections: readonly FlowchartConnection[],
	matchedNodes: ReadonlyMap<string, ReadonlySet<string>>,
	findPaths: ReturnType<typeof scenarioPathFinder>,
	branchMatches: BranchMatcher,
): { owners: Map<string, string> | undefined; exhausted: boolean } {
	const choices = scenario.assertions.requiredEdges.map((expected) => ({
		expected,
		candidates: connections.filter(
			(edge) =>
				matchedNodes.get(expected.sourceId)?.has(edge.source) &&
				matchedNodes.get(expected.targetId)?.has(edge.target) &&
				branchMatches(edge, expected),
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
		let candidates: readonly FlowchartConnection[] | undefined;
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
	/** The prompt, whose product abbreviations also ground their products' logos. */
	readonly prompt?: string;
	readonly requiredIconSlugs: readonly string[];
}

/**
 * Products a prompt may name only by an abbreviation the catalog does not
 * list, by full name: the product's own logo is grounded wherever the
 * abbreviation is, and sits well on a step named by either.
 */
const PRODUCT_ABBREVIATIONS: Readonly<Record<string, string>> = {
	aks: "azure kubernetes service",
	eks: "elastic kubernetes service",
	gcs: "google cloud storage",
	gke: "google kubernetes engine",
	rds: "relational database service",
};

/** The logo a prompt's product abbreviation grounds for a slug, if any. */
function abbreviatedLogo(
	slug: string,
	prompt: string | undefined,
): DiagramScenarioLogo | undefined {
	if (prompt === undefined) return undefined;
	const named = new Set(termTokens(prompt));
	const words = ` ${termTokens(slug.replaceAll("-", " ")).join(" ")} `;
	for (const [abbreviation, name] of Object.entries(PRODUCT_ABBREVIATIONS))
		if (
			named.has(abbreviation) &&
			(words.includes(` ${abbreviation} `) || words.includes(` ${termTokens(name).join(" ")} `))
		)
			return { aliases: [abbreviation], name, slug };
	return undefined;
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
	const logoFor = (slug: string) => offered.get(slug) ?? abbreviatedLogo(slug, expected.prompt);
	// Flowcharts draw logos on nodes; sequence diagrams on participants.
	const owner = modelDiagram.type === "flowchart" ? "step" : "participant";
	const elements: readonly {
		readonly icon?: { readonly slug: string } | undefined;
		readonly label: string;
	}[] = modelDiagram.type === "flowchart" ? modelDiagram.nodes : modelDiagram.participants;
	const icons = elements.flatMap((element) =>
		element.icon ? [{ label: element.label, slug: element.icon.slug }] : [],
	);
	const ungrounded = icons.filter((icon) => !logoFor(icon.slug));
	const misplaced = icons.filter((icon) => {
		const logo = logoFor(icon.slug);
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

/**
 * Group checks on the model's own groups: each group the prompt states exists
 * under one of its prompt-grounded labels and holds every node of every step
 * the prompt puts in it (directly or in a group nested in it), stated groups
 * stay distinct, and steps the prompt keeps outside every group belong to
 * none. A stated zone also sits inside the zone the prompt puts it in and is
 * of a kind that reads as what the prompt calls it, and a step the prompt
 * makes a database, queue or document draws as one.
 */
function flowchartGroupChecks(
	scenario: FlowchartScenario,
	graph: FlowchartDiagram,
	ownedNodes: ReadonlyMap<string, ReadonlySet<string>>,
): ScenarioCheck[] {
	const { requiredGroups, requiredNodes, ungroupedSteps } = scenario.assertions;
	const shaped = requiredNodes.filter((step) => step.shape !== undefined);
	if (requiredGroups.length === 0 && ungroupedSteps.length === 0 && shaped.length === 0) return [];
	// The canonical schema makes groups and lanes mutually exclusive.
	const groups = [
		...(graph.groups ?? []).map((group) => ({
			...group,
			lane: false,
		})),
		...(graph.lanes ?? []).map((lane) => ({
			id: lane.id,
			label: lane.label,
			parent: undefined,
			kind: undefined,
			lane: true,
		})),
	];
	const groupOf = new Map(graph.nodes.map((node) => [node.id, node.group]));
	const laneOf = new Map(graph.nodes.map((node) => [node.id, node.lane]));
	const groupsById = new Map(groups.map((group) => [group.id, group]));
	// A group and every group around it, innermost first; a loop stops the walk.
	const chain = (groupId: string | undefined) => {
		const ids: string[] = [];
		for (let id = groupId; id !== undefined && !ids.includes(id); id = groupsById.get(id)?.parent)
			ids.push(id);
		return ids;
	};
	const stepLabel = (id: string) => requiredNodes.find((step) => step.id === id)?.label ?? id;
	const owned = (stepId: string) => [...(ownedNodes.get(stepId) ?? [])];
	const matched = requiredGroups.map((expected) => {
		const named = groups.filter(
			(group) =>
				(!group.lane || expected.allowLane) && flowchartLabelMatches(group.label, expected.labels),
		);
		const group = named.find((candidate) =>
			expected.members.every(
				(member) =>
					owned(member).length > 0 &&
					owned(member).every((node) =>
						candidate.lane
							? laneOf.get(node) === candidate.id
							: chain(groupOf.get(node)).includes(candidate.id),
					),
			),
		);
		return { expected, group, named };
	});
	const found = matched.flatMap(({ group }) => (group ? [group.id] : []));
	// Where a zone sits and what it is read off the group that holds its steps,
	// else the first group under its label, so a misplaced step fails only its
	// zone's members.
	const zoneOf = (entry: (typeof matched)[number] | undefined) => entry?.group ?? entry?.named[0];
	const matchedId = (stated: string) =>
		zoneOf(matched.find(({ expected }) => expected.id === stated))?.id;
	return [
		...matched.flatMap((entry) => {
			const { expected, group, named } = entry;
			const zone = zoneOf(entry);
			return [
				{
					id: `group:${expected.label}`,
					passed: named.length > 0,
					message: `Expected a group labeled like ${expected.labels.join(" | ")}.`,
				},
				{
					id: `group-members:${expected.label}`,
					passed: group !== undefined,
					message: `Expected the "${expected.label}" group to hold ${expected.members
						.map((member) => `"${stepLabel(member)}"`)
						.join(", ")}.`,
				},
				...(expected.parent === undefined
					? []
					: [
							{
								id: `zone-parent:${expected.label}`,
								passed:
									zone !== undefined &&
									matchedId(expected.parent) !== undefined &&
									chain(zone.parent).includes(matchedId(expected.parent)!),
								message: `Expected the "${expected.label}" zone inside the "${
									requiredGroups.find((candidate) => candidate.id === expected.parent)?.label ??
									expected.parent
								}" zone.`,
							},
						]),
				...(expected.kinds === undefined
					? []
					: [
							{
								id: `zone-kind:${expected.label}`,
								passed:
									zone?.kind !== undefined &&
									(expected.kinds as readonly string[]).includes(zone.kind),
								message: `Expected the "${expected.label}" zone to be of kind ${expected.kinds.join(" | ")}.`,
							},
						]),
			];
		}),
		...(requiredGroups.length > 1
			? [
					{
						id: "groups-distinct",
						passed: new Set(found).size === found.length,
						message: "Expected each stated group to be a group of its own.",
					},
				]
			: []),
		...ungroupedSteps.map((step) => ({
			id: `ungrouped:${stepLabel(step)}`,
			passed:
				owned(step).length > 0 &&
				owned(step).every(
					(node) => groupOf.get(node) === undefined && laneOf.get(node) === undefined,
				),
			message: `Expected "${stepLabel(step)}" outside every group.`,
		})),
		...shaped.map((step) => {
			const shapes = step.shapes ?? [step.shape!];
			return {
				id: `shape:${step.label}`,
				passed: graph.nodes.some(
					(node) =>
						owned(step.id).includes(node.id) &&
						node.shape !== undefined &&
						shapes.includes(node.shape),
				),
				message: `Expected "${step.label}" to draw as a ${shapes.join(" or ")}.`,
			};
		}),
	];
}

/**
 * Lane checks on the model's own lanes: each lane the prompt states exists
 * under one of its prompt-grounded labels and holds every node of every step
 * the prompt puts in it, stated lanes stay distinct and keep the prompt's
 * order, and every stated handoff between two lanes leaves the one for the
 * other, directly or through unmatched steps in either of those two lanes.
 */
function flowchartLaneChecks(
	scenario: FlowchartScenario,
	graph: FlowchartDiagram,
	ownedNodes: ReadonlyMap<string, ReadonlySet<string>>,
): ScenarioCheck[] {
	const { requiredEdges, requiredLanes, requiredNodes } = scenario.assertions;
	if (requiredLanes.length === 0) return [];
	const lanes = graph.lanes ?? [];
	const laneOf = new Map(graph.nodes.map((node) => [node.id, node.lane]));
	const stepLabel = (id: string) => requiredNodes.find((step) => step.id === id)?.label ?? id;
	const owned = (stepId: string) => [...(ownedNodes.get(stepId) ?? [])];
	const matched = requiredLanes.map((expected) => {
		const named = lanes.filter((lane) => flowchartLabelMatches(lane.label, expected.labels));
		const lane = named.find((candidate) =>
			expected.members.every(
				(member) =>
					owned(member).length > 0 &&
					owned(member).every((node) => laneOf.get(node) === candidate.id),
			),
		);
		return { expected, lane, named };
	});
	const found = matched.flatMap(({ lane }) => (lane ? [lane.id] : []));
	const positions = found.map((id) => lanes.findIndex((lane) => lane.id === id));
	// Each stated step's drawn lane, by the stated lane it belongs to.
	const drawnLane = new Map(
		matched.flatMap(({ expected, lane }) =>
			lane ? expected.members.map((member) => [member, lane.id] as const) : [],
		),
	);
	const statedLane = new Map(
		requiredLanes.flatMap((expected) =>
			expected.members.map((member) => [member, expected.id] as const),
		),
	);
	const claimed = new Set([...ownedNodes.values()].flatMap((nodes) => [...nodes]));
	const outgoing = new Map<string, string[]>();
	for (const edge of graph.edges)
		outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
	const handoffs = requiredEdges.filter(
		(edge) =>
			statedLane.has(edge.sourceId) &&
			statedLane.has(edge.targetId) &&
			statedLane.get(edge.sourceId) !== statedLane.get(edge.targetId),
	);
	const handsOff = (sourceId: string, targetId: string) => {
		const ends = [drawnLane.get(sourceId), drawnLane.get(targetId)];
		if (ends.includes(undefined)) return false;
		const targets = new Set(owned(targetId));
		let frontier = owned(sourceId);
		const seen = new Set(frontier);
		for (let hop = 0; hop <= MAX_INTERMEDIATE_NODES && frontier.length > 0; hop += 1) {
			const next: string[] = [];
			for (const node of frontier)
				for (const target of outgoing.get(node) ?? []) {
					if (targets.has(target)) return true;
					if (seen.has(target) || claimed.has(target) || !ends.includes(laneOf.get(target)))
						continue;
					seen.add(target);
					next.push(target);
				}
			frontier = next;
		}
		return false;
	};
	return [
		...matched.flatMap(({ expected, lane, named }) => [
			{
				id: `lane:${expected.label}`,
				passed: named.length > 0,
				message: `Expected a lane labeled like ${expected.labels.join(" | ")}.`,
			},
			{
				id: `lane-members:${expected.label}`,
				passed: lane !== undefined,
				message: `Expected the "${expected.label}" lane to hold ${expected.members
					.map((member) => `"${stepLabel(member)}"`)
					.join(", ")}.`,
			},
		]),
		...(requiredLanes.length > 1
			? [
					{
						id: "lanes-distinct",
						passed: new Set(found).size === found.length,
						message: "Expected each stated lane to be a lane of its own.",
					},
					{
						id: "lanes-ordered",
						passed:
							found.length === requiredLanes.length &&
							positions.every((position, index) => index === 0 || position > positions[index - 1]!),
						message: `Expected the lanes in the stated order: ${requiredLanes
							.map((lane) => lane.label)
							.join(", ")}.`,
					},
				]
			: []),
		...handoffs.map((edge) => ({
			id: `handoff:${edge.sourceLabel}->${edge.targetLabel}`,
			passed: handsOff(edge.sourceId, edge.targetId),
			message: `Expected "${edge.sourceLabel}" to hand off to "${edge.targetLabel}" from its lane into the other.`,
		})),
	];
}

function flowchartChecks(scenario: FlowchartScenario, diagram: FlowchartDiagram): ScenarioCheck[] {
	// Counts, wiring, and ownership use the graph with merged checks split.
	const { matchedNodes, graph, branchMatches } = matchFlowchartSteps(scenario, diagram);
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
	const connections = scenarioConnections(graph, matchedNodes);
	const findPaths = scenarioPathFinder(scenario, graph, connections, branchMatches);
	const connectedSearch =
		owners.size === scenario.assertions.requiredNodes.length
			? connectedStepOwners(scenario, connections, matchedNodes, findPaths, branchMatches)
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
	const nodeKinds = new Set(diagram.nodes.map((node) => node.kind));

	return [
		{
			id: "min-node-count",
			passed: graph.nodes.length >= scenario.assertions.minNodeCount,
			message: `Expected at least ${scenario.assertions.minNodeCount} nodes.`,
		},
		{
			id: "min-edge-count",
			passed: graph.edges.length >= scenario.assertions.minEdgeCount,
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
			passed: graph.edges.some(
				(edge) =>
					Boolean(edge.label) &&
					scenario.assertions.requiredEdges.some(
						(expected) => expected.label === label && branchMatches(edge, expected),
					),
			),
			message: `Expected a decision branch label like "${label}" or its alternatives.`,
		})),
		...scenario.assertions.requiredEdges.map((edge) => {
			const passed = edgeMatchesExpected(connections, edge, ownedNodes, branchMatches, paths);
			return {
				id: `edge:${edge.sourceLabel}->${edge.targetLabel}${edge.label ? `:${edge.label}` : ""}`,
				passed,
				message:
					`Expected a directed path from "${edge.sourceLabel}" to "${edge.targetLabel}" through at most ${MAX_INTERMEDIATE_NODES} unmatched stages${edge.label ? ` with its first hop labeled like "${edge.label}"` : ""}.` +
					(connectedSearch?.exhausted && !passed
						? ` Ownership search reached its ${MAX_OWNERSHIP_STATES}-state limit; this connection was not verified.`
						: ""),
			};
		}),
		...flowchartGroupChecks(scenario, graph, ownedNodes),
		...flowchartLaneChecks(scenario, graph, ownedNodes),
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
	sceneChecks: (scene: RenderedDiagramScene) => readonly ScenarioCheck[] = () => [],
): ScenarioEvaluation {
	const scene = renderDiagram(diagram);
	const { check, excalidrawScene, excalidrawValidation } = excalidrawCheck(scene);
	const checks = [...familyChecks, ...sceneChecks(scene), check];
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
		(expected.type === undefined || (message.type ?? "message") === expected.type) &&
		(expected.self !== true || message.source === message.target)
	);
}

function describeSequenceMessage(expected: SequenceScenarioMessage): string {
	const label = expected.label ? ` "${expected.label.join("|")}"` : "";
	const type = expected.type === "return" ? " return" : "";
	const self = expected.self ? " self-message" : "";
	return `${expected.source.join("|")} -> ${expected.target.join("|")}${self}${type}${label}`;
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
	if (scenario.diagramType === "chart") {
		const diagram = parseChartDiagram(candidate);
		const modelDiagram = modelCandidate === candidate ? diagram : parseChartDiagram(modelCandidate);
		// Geometry reads the drawn scene, so it scores the returned diagram.
		return evaluation(
			scenario.id,
			diagram,
			chartScenarioChecks(scenario, modelDiagram),
			(scene) => [
				chartGeometryCheck(diagram, scene),
				chartDrawnDataCheck(scenario, diagram, scene),
				chartClearRulesCheck(scene),
				...(diagram.kind === "pie" ? [chartPieLabelCheck(diagram, scene)] : []),
			],
		);
	}
	if (scenario.diagramType === "gantt") {
		const diagram = parseGanttDiagram(candidate);
		const modelDiagram = modelCandidate === candidate ? diagram : parseGanttDiagram(modelCandidate);
		// Geometry, drawn data and clearance read the drawn scene, so they score the returned diagram.
		return evaluation(
			scenario.id,
			diagram,
			ganttScenarioChecks(scenario, modelDiagram),
			(scene) => [
				ganttGeometryCheck(diagram, scene),
				ganttDrawnDataCheck(scenario, diagram, scene),
				ganttClearanceCheck(scene),
			],
		);
	}
	if (scenario.diagramType === "timeline") {
		const diagram = parseTimelineDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseTimelineDiagram(modelCandidate);
		// Spacing reads the drawn scene, so it scores the returned diagram.
		const dated = scenario.assertions.events.some((event) => event.date !== undefined);
		return evaluation(
			scenario.id,
			diagram,
			timelineScenarioChecks(scenario, modelDiagram),
			(scene) =>
				dated
					? [
							timelineSpacingCheck(scenario, diagram, scene),
							timelineGapOrderCheck(scenario, diagram, scene),
						]
					: [],
		);
	}
	if (scenario.diagramType === "mindmap") {
		const diagram = parseMindmapDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseMindmapDiagram(modelCandidate);
		// The layout check reads the drawn scene, so it scores the returned diagram.
		return evaluation(
			scenario.id,
			diagram,
			mindmapScenarioChecks(scenario, modelDiagram),
			(scene) => [mindmapLayoutCheck(scene)],
		);
	}
	if (scenario.diagramType === "state-machine") {
		const diagram = parseStateMachineDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseStateMachineDiagram(modelCandidate);
		return evaluation(scenario.id, diagram, stateMachineScenarioChecks(scenario, modelDiagram));
	}
	if (scenario.diagramType === "er") {
		const diagram = parseErDiagram(candidate);
		const modelDiagram = modelCandidate === candidate ? diagram : parseErDiagram(modelCandidate);
		// The drawing reads the scene, so it scores the returned diagram.
		return evaluation(scenario.id, diagram, erScenarioChecks(scenario, modelDiagram), (scene) => [
			erDrawnCheck(diagram, scene),
		]);
	}
	if (scenario.diagramType === "class") {
		const diagram = parseClassDiagram(candidate);
		const modelDiagram = modelCandidate === candidate ? diagram : parseClassDiagram(modelCandidate);
		// The drawing and its clearance read the scene, so they score the returned diagram.
		return evaluation(
			scenario.id,
			diagram,
			classScenarioChecks(scenario, modelDiagram),
			(scene) => [classDrawnCheck(diagram, scene), classClearanceCheck(scene)],
		);
	}
	if (scenario.diagramType === "org-chart") {
		const diagram = parseOrgChartDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseOrgChartDiagram(modelCandidate);
		// The drawing and its layout read the scene, so they score the returned diagram.
		return evaluation(
			scenario.id,
			diagram,
			orgChartScenarioChecks(scenario, modelDiagram),
			(scene) => [orgChartDrawnCheck(diagram, scene), orgChartLayoutCheck(scene)],
		);
	}
	if (scenario.diagramType === "sequence") {
		const diagram = parseSequenceDiagram(candidate);
		const modelDiagram =
			modelCandidate === candidate ? diagram : parseSequenceDiagram(modelCandidate);
		return evaluation(scenario.id, diagram, [
			...sequenceScenarioChecks(scenario, modelDiagram),
			...scenarioLogoChecks(
				{
					logos: scenario.logos,
					prompt: scenario.prompt,
					requiredIconSlugs: scenario.assertions.requiredIconSlugs,
				},
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
				prompt: scenario.prompt,
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
