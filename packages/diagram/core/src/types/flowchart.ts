import { Schema } from "effect";

import {
	DiagramEdge,
	DiagramValidationError,
	GraphNode,
	IntermediateDiagram,
} from "../intermediate.js";

export const flowchartDiagramType = "flowchart" as const;

export const FLOWCHART_MAX_NODES = 24;
export const FLOWCHART_MAX_EDGES = 64;
export const FLOWCHART_MAX_GROUPS = 8;
/** Zones nest at most this deep: a cloud, a region, a VPC and a subnet. */
export const FLOWCHART_MAX_GROUP_DEPTH = 4;
export const FLOWCHART_MAX_LANES = 8;
export const FLOWCHART_MAX_ISSUES = 20;

export const FlowchartValidationIssueCodeSchema = Schema.Literals([
	"duplicate_node_id",
	"duplicate_edge_id",
	"missing_edge_source",
	"missing_edge_target",
	"self_loop",
	"missing_start",
	"multiple_starts",
	"missing_end",
	"start_has_incoming",
	"end_has_outgoing",
	"unreachable_node",
	"missing_outgoing_edge",
	"underbranched_decision",
	"unlabeled_decision_branch",
	"duplicate_decision_branch_label",
	"nonterminating_node",
	"flowchart_too_large",
	"duplicate_group_id",
	"unknown_node_group",
	"empty_group",
	"unknown_group_parent",
	"group_cycle",
	"shaped_decision",
	"duplicate_lane_id",
	"unknown_node_lane",
	"empty_lane",
	"lanes_with_groups",
]);

export class FlowchartValidationIssueRef extends Schema.Class<FlowchartValidationIssueRef>(
	"FlowchartValidationIssueRef",
)({
	kind: Schema.Literals(["diagram", "node", "edge", "group", "lane"]),
	id: Schema.optional(Schema.NonEmptyString),
	path: Schema.optional(Schema.NonEmptyString),
}) {}
export const FlowchartValidationIssueRefSchema = FlowchartValidationIssueRef;

export class FlowchartValidationIssue extends Schema.Class<FlowchartValidationIssue>(
	"FlowchartValidationIssue",
)({
	code: FlowchartValidationIssueCodeSchema,
	ref: Schema.optional(FlowchartValidationIssueRef),
	message: Schema.NonEmptyString,
	hint: Schema.NonEmptyString,
}) {}
export const FlowchartValidationIssueSchema = FlowchartValidationIssue;

export const FlowchartNodeKindSchema = Schema.Literals(["start", "process", "decision", "end"]);

export class FlowchartNode extends GraphNode.extend<FlowchartNode>("FlowchartNode")({
	kind: FlowchartNodeKindSchema,
}) {}
export const FlowchartNodeSchema = FlowchartNode;

export class FlowchartEdge extends DiagramEdge.extend<FlowchartEdge>("FlowchartEdge")({
	label: Schema.optional(Schema.NonEmptyString),
}) {}
export const FlowchartEdgeSchema = FlowchartEdge;

export class FlowchartDiagram extends IntermediateDiagram.extend<FlowchartDiagram>(
	"FlowchartDiagram",
)({
	type: Schema.Literal(flowchartDiagramType),
	nodes: Schema.Array(FlowchartNode).pipe(Schema.mutable).check(Schema.isMinLength(2)),
	edges: Schema.Array(FlowchartEdge).pipe(Schema.mutable).check(Schema.isMinLength(1)),
}) {}
export const FlowchartDiagramSchema = FlowchartDiagram;

export type FlowchartNodeKind = typeof FlowchartNodeKindSchema.Type;
export type FlowchartValidationIssueCode = typeof FlowchartValidationIssueCodeSchema.Type;

function edgeBuckets(edges: readonly FlowchartEdge[]) {
	const incoming = new Map<string, FlowchartEdge[]>();
	const outgoing = new Map<string, FlowchartEdge[]>();

	for (const edge of edges) {
		incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
		outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
	}

	return { incoming, outgoing };
}

function duplicateValues(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			duplicates.add(value);
		} else {
			seen.add(value);
		}
	}
	return [...duplicates];
}

function validateDecisionBranches(
	node: FlowchartNode,
	outgoingEdges: readonly FlowchartEdge[],
): FlowchartValidationIssue[] {
	const issues: FlowchartValidationIssue[] = [];
	if (outgoingEdges.length < 2) {
		issues.push({
			code: "underbranched_decision",
			ref: { kind: "node", id: node.id },
			message: `Decision node "${node.id}" must have at least two outgoing branches.`,
			hint: "Add at least two outgoing edges for the decision outcomes.",
		});
	}

	const labels = outgoingEdges.map((edge) => edge.label?.trim() ?? "");
	for (const edge of outgoingEdges.filter((edge) => !edge.label?.trim())) {
		issues.push({
			code: "unlabeled_decision_branch",
			ref: { kind: "edge", id: edge.id, path: "edges.label" },
			message: `Decision node "${node.id}" has an outgoing branch without a label.`,
			hint: 'Add a short branch label such as "yes", "no", "approved", or "rejected".',
		});
	}

	for (const label of duplicateValues(
		labels.filter((value) => value.length > 0).map((value) => value.toLowerCase()),
	)) {
		issues.push({
			code: "duplicate_decision_branch_label",
			ref: { kind: "node", id: node.id },
			message: `Decision node "${node.id}" repeats branch label "${label}".`,
			hint: "Make every outgoing branch label from the same decision unique.",
		});
	}

	return issues;
}

function reachableFrom(
	initialNodeIds: readonly string[],
	adjacency: ReadonlyMap<string, readonly FlowchartEdge[]>,
	nextNodeId: (edge: FlowchartEdge) => string,
): Set<string> {
	const reached = new Set<string>();
	const queue = [...initialNodeIds];
	for (let index = 0; index < queue.length; index += 1) {
		const current = queue[index];
		if (current === undefined || reached.has(current)) {
			continue;
		}
		reached.add(current);
		for (const edge of adjacency.get(current) ?? []) {
			queue.push(nextNodeId(edge));
		}
	}
	return reached;
}

/**
 * Nesting problems, each with its repair: a parent nobody declared, a group
 * inside itself, and zones nested deeper than FLOWCHART_MAX_GROUP_DEPTH.
 */
function groupNestingIssues(diagram: FlowchartDiagram): FlowchartValidationIssue[] {
	const groups = diagram.groups ?? [];
	const groupIds = new Set(groups.map((group) => group.id));
	const parentOf = new Map(
		groups.flatMap((group) =>
			group.parent !== undefined && groupIds.has(group.parent)
				? [[group.id, group.parent] as const]
				: [],
		),
	);
	const issues: FlowchartValidationIssue[] = [];
	let deepest = 0;
	for (const group of groups) {
		if (group.parent !== undefined && !groupIds.has(group.parent)) {
			issues.push({
				code: "unknown_group_parent",
				ref: { kind: "group", id: group.id, path: "groups.parent" },
				message: `Group "${group.id}" references undeclared parent group "${group.parent}".`,
				hint: `Set parent to the id of the declared group that encloses it (${[...groupIds].map((id) => `"${id}"`).join(", ")}), or remove parent.`,
			});
			continue;
		}
		const chain = [group.id];
		let looped = false;
		for (let ancestor = parentOf.get(group.id); ancestor !== undefined;) {
			if (chain.includes(ancestor)) {
				looped = true;
				// A group under a loop is not in it; only the groups in the loop are named.
				if (ancestor === group.id)
					issues.push({
						code: "group_cycle",
						ref: { kind: "group", id: group.id, path: "groups.parent" },
						message: `Group "${group.id}" is nested inside itself through ${[...chain, ancestor].map((id) => `"${id}"`).join(" in ")}.`,
						hint: "Set each group's parent to the group that encloses it; the outermost group has no parent.",
					});
				break;
			}
			chain.push(ancestor);
			ancestor = parentOf.get(ancestor);
		}
		if (!looped) deepest = Math.max(deepest, chain.length);
	}
	if (deepest > FLOWCHART_MAX_GROUP_DEPTH) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", id: diagram.id, path: "groups.parent" },
			message: `Groups nest ${deepest} deep; the supported maximum is ${FLOWCHART_MAX_GROUP_DEPTH}.`,
			hint: "Drop an intermediate zone, or merge a zone into its parent.",
		});
	}
	return issues;
}

/**
 * Lane problems, each with its repair: too many lanes, a repeated lane id, a
 * node in an undeclared lane or in none, a lane with no nodes, and lanes
 * declared together with groups.
 */
function laneIssues(diagram: FlowchartDiagram): FlowchartValidationIssue[] {
	const lanes = diagram.lanes ?? [];
	// Without lanes, a node that names one names a lane nobody declared.
	if (lanes.length === 0)
		return diagram.nodes.flatMap((node): FlowchartValidationIssue[] =>
			node.lane === undefined
				? []
				: [
						{
							code: "unknown_node_lane",
							ref: { kind: "node", id: node.id, path: "nodes.lane" },
							message: `Node "${node.id}" references undeclared lane "${node.lane}".`,
							hint: `Declare "${node.lane}" in lanes as { id, label }, or remove the node's lane.`,
						},
					],
		);
	const issues: FlowchartValidationIssue[] = [];
	if (lanes.length > FLOWCHART_MAX_LANES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", id: diagram.id, path: "lanes" },
			message: `Flowchart has ${lanes.length} lanes; the supported maximum is ${FLOWCHART_MAX_LANES}.`,
			hint: "Merge related actors into one lane.",
		});
	}
	if ((diagram.groups ?? []).length > 0) {
		issues.push({
			code: "lanes_with_groups",
			ref: { kind: "diagram", id: diagram.id, path: "groups" },
			message: "A flowchart with lanes cannot also declare groups.",
			hint: "Keep lanes for the actors and remove groups and every node's group.",
		});
	}
	for (const laneId of duplicateValues(lanes.map((lane) => lane.id))) {
		issues.push({
			code: "duplicate_lane_id",
			ref: { kind: "lane", id: laneId, path: "lanes" },
			message: `Lane id "${laneId}" is used more than once.`,
			hint: "Give every lane a stable unique id.",
		});
	}
	const laneIds = new Set(lanes.map((lane) => lane.id));
	const declared = [...laneIds].map((id) => `"${id}"`).join(", ");
	for (const node of diagram.nodes) {
		if (node.lane !== undefined && laneIds.has(node.lane)) continue;
		issues.push({
			code: "unknown_node_lane",
			ref: { kind: "node", id: node.id, path: "nodes.lane" },
			message:
				node.lane === undefined
					? `Node "${node.id}" has no lane.`
					: `Node "${node.id}" references undeclared lane "${node.lane}".`,
			hint:
				node.lane === undefined
					? `Set lane to the declared lane id (${declared}) of the actor that does this step.`
					: `Set lane to a declared lane id (${declared}) or declare "${node.lane}" in lanes.`,
		});
	}
	const used = new Set(diagram.nodes.map((node) => node.lane));
	for (const lane of lanes.filter((lane) => !used.has(lane.id))) {
		issues.push({
			code: "empty_lane",
			ref: { kind: "lane", id: lane.id, path: "lanes" },
			message: `Lane "${lane.id}" has no nodes.`,
			hint: "Set lane on the steps this actor does, or remove the lane.",
		});
	}
	return issues;
}

export function getFlowchartValidationIssues(
	diagram: FlowchartDiagram,
): FlowchartValidationIssue[] {
	const issues: FlowchartValidationIssue[] = [];
	const nodeIds = new Set(diagram.nodes.map((node) => node.id));
	const { incoming, outgoing } = edgeBuckets(diagram.edges);

	if (diagram.nodes.length > FLOWCHART_MAX_NODES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", id: diagram.id, path: "nodes" },
			message: `Flowchart has ${diagram.nodes.length} nodes; the supported maximum is ${FLOWCHART_MAX_NODES}.`,
			hint: "Split the workflow or combine lower-signal steps.",
		});
	}
	if (diagram.edges.length > FLOWCHART_MAX_EDGES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", id: diagram.id, path: "edges" },
			message: `Flowchart has ${diagram.edges.length} edges; the supported maximum is ${FLOWCHART_MAX_EDGES}.`,
			hint: "Split the workflow or remove lower-signal connections.",
		});
	}

	const groups = diagram.groups ?? [];
	if (groups.length > FLOWCHART_MAX_GROUPS) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", id: diagram.id, path: "groups" },
			message: `Flowchart has ${groups.length} groups; the supported maximum is ${FLOWCHART_MAX_GROUPS}.`,
			hint: "Merge related groups or leave minor steps ungrouped.",
		});
	}
	for (const groupId of duplicateValues(groups.map((group) => group.id))) {
		issues.push({
			code: "duplicate_group_id",
			ref: { kind: "group", id: groupId, path: "groups" },
			message: `Group id "${groupId}" is used more than once.`,
			hint: "Give every group a stable unique id.",
		});
	}
	const groupIds = new Set(groups.map((group) => group.id));
	for (const node of diagram.nodes) {
		if (node.group !== undefined && !groupIds.has(node.group)) {
			issues.push({
				code: "unknown_node_group",
				ref: { kind: "node", id: node.id, path: "nodes.group" },
				message: `Node "${node.id}" references undeclared group "${node.group}".`,
				hint:
					groupIds.size > 0
						? `Set group to a declared group id (${[...groupIds].map((id) => `"${id}"`).join(", ")}) or declare "${node.group}" in groups.`
						: `Declare "${node.group}" in groups as { id, label }, or remove the node's group.`,
			});
		}
	}
	issues.push(...groupNestingIssues(diagram));
	const memberGroups = new Set([
		...diagram.nodes.map((node) => node.group),
		...groups.map((group) => group.parent),
	]);
	for (const group of groups.filter((group) => !memberGroups.has(group.id))) {
		issues.push({
			code: "empty_group",
			ref: { kind: "group", id: group.id, path: "groups" },
			message: `Group "${group.id}" has no nodes.`,
			hint: "Set group on the nodes it holds, or remove the group.",
		});
	}
	for (const node of diagram.nodes) {
		if (node.kind === "decision" && node.shape !== undefined) {
			issues.push({
				code: "shaped_decision",
				ref: { kind: "node", id: node.id, path: "nodes.shape" },
				message: `Decision node "${node.id}" cannot draw as a ${node.shape}.`,
				hint: "Remove shape from the decision; a decision always draws as a diamond.",
			});
		}
	}

	issues.push(...laneIssues(diagram));

	for (const nodeId of duplicateValues(diagram.nodes.map((node) => node.id))) {
		issues.push({
			code: "duplicate_node_id",
			ref: { kind: "node", id: nodeId, path: "nodes" },
			message: `Node id "${nodeId}" is used more than once.`,
			hint: "Give every node a stable unique id.",
		});
	}
	for (const edgeId of duplicateValues(diagram.edges.map((edge) => edge.id))) {
		issues.push({
			code: "duplicate_edge_id",
			ref: { kind: "edge", id: edgeId, path: "edges" },
			message: `Edge id "${edgeId}" is used more than once.`,
			hint: "Give every edge a stable unique id.",
		});
	}

	for (const edge of diagram.edges) {
		if (!nodeIds.has(edge.source)) {
			issues.push({
				code: "missing_edge_source",
				ref: { kind: "edge", id: edge.id, path: "edges.source" },
				message: `Edge "${edge.id}" references missing source node "${edge.source}".`,
				hint: "Set edge.source to one of the diagram node ids.",
			});
		}
		if (!nodeIds.has(edge.target)) {
			issues.push({
				code: "missing_edge_target",
				ref: { kind: "edge", id: edge.id, path: "edges.target" },
				message: `Edge "${edge.id}" references missing target node "${edge.target}".`,
				hint: "Set edge.target to one of the diagram node ids.",
			});
		}
		if (edge.source === edge.target) {
			issues.push({
				code: "self_loop",
				ref: { kind: "edge", id: edge.id },
				message: `Edge "${edge.id}" connects node "${edge.source}" to itself.`,
				hint: "Connect the edge to a different target node.",
			});
		}
	}

	const startNodes = diagram.nodes.filter((node) => node.kind === "start");
	const endNodes = diagram.nodes.filter((node) => node.kind === "end");
	if (startNodes.length === 0) {
		issues.push({
			code: "missing_start",
			ref: { kind: "diagram", id: diagram.id, path: "nodes" },
			message: "Flowchart must contain exactly one start node.",
			hint: 'Mark the first node in the flow with kind: "start".',
		});
	} else if (startNodes.length > 1) {
		issues.push({
			code: "multiple_starts",
			ref: { kind: "diagram", id: diagram.id, path: "nodes" },
			message: `Flowchart has ${startNodes.length} start nodes.`,
			hint: "Keep one start node and change the others to process, decision, or end.",
		});
	}
	if (endNodes.length === 0) {
		issues.push({
			code: "missing_end",
			ref: { kind: "diagram", id: diagram.id, path: "nodes" },
			message: "Flowchart must contain at least one end node.",
			hint: 'Add an end node or mark terminal outcomes with kind: "end".',
		});
	}

	for (const node of diagram.nodes) {
		const incomingEdges = incoming.get(node.id) ?? [];
		const outgoingEdges = outgoing.get(node.id) ?? [];
		if (node.kind === "start" && incomingEdges.length > 0) {
			issues.push({
				code: "start_has_incoming",
				ref: { kind: "node", id: node.id },
				message: `Start node "${node.id}" cannot have incoming edges.`,
				hint: "Route the start node only to later nodes.",
			});
		}
		if (node.kind === "end" && outgoingEdges.length > 0) {
			issues.push({
				code: "end_has_outgoing",
				ref: { kind: "node", id: node.id },
				message: `End node "${node.id}" cannot have outgoing edges.`,
				hint: "End nodes must be terminal outcomes.",
			});
		}
		if (node.kind !== "end" && outgoingEdges.length === 0) {
			issues.push({
				code: "missing_outgoing_edge",
				ref: { kind: "node", id: node.id },
				message: `Node "${node.id}" must have at least one outgoing edge.`,
				hint: 'Connect it to the next step, or mark it as kind: "end".',
			});
		}
		if (node.kind === "decision") {
			issues.push(...validateDecisionBranches(node, outgoingEdges));
		}
	}

	const start = startNodes.length === 1 ? startNodes[0] : undefined;
	if (start) {
		const reachable = reachableFrom([start.id], outgoing, (edge) => edge.target);
		for (const node of diagram.nodes) {
			if (!reachable.has(node.id)) {
				issues.push({
					code: "unreachable_node",
					ref: { kind: "node", id: node.id },
					message: `Node "${node.id}" is not reachable from the start node.`,
					hint: "Connect every node to the flow that begins at the single start node.",
				});
			}
		}

		if (endNodes.length > 0) {
			const reachesEnd = reachableFrom(
				endNodes.map((node) => node.id),
				incoming,
				(edge) => edge.source,
			);
			for (const node of diagram.nodes) {
				if (
					reachable.has(node.id) &&
					!reachesEnd.has(node.id) &&
					(outgoing.get(node.id)?.length ?? 0) > 0
				) {
					issues.push({
						code: "nonterminating_node",
						ref: { kind: "node", id: node.id },
						message: `Node "${node.id}" cannot reach an end node.`,
						hint: "Add an eventual exit from this path to an end node; retry loops are valid when they retain an exit.",
					});
				}
			}
		}
	}

	return issues.slice(0, FLOWCHART_MAX_ISSUES);
}

export class FlowchartValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly FlowchartValidationIssue[]) {
		super(issues[0]?.message ?? "Flowchart failed semantic validation.");
		this.name = "FlowchartValidationError";
	}
}

export function validateFlowchartDiagram(diagram: FlowchartDiagram): FlowchartDiagram {
	const issues = getFlowchartValidationIssues(diagram);
	if (issues.length > 0) {
		throw new FlowchartValidationError(issues);
	}

	return diagram;
}

export function parseFlowchartDiagram(input: unknown): FlowchartDiagram {
	return validateFlowchartDiagram(
		Schema.decodeUnknownSync(FlowchartDiagram, { errors: "all" })(input),
	);
}

export const flowchartFixture = parseFlowchartDiagram({
	id: "onboarding-flow",
	title: "Sketchi onboarding decision flow",
	type: flowchartDiagramType,
	nodes: [
		{ id: "prompt", label: "Prompt received", kind: "start" },
		{ id: "requirements", label: "Extract requirements", kind: "process" },
		{ id: "clear", label: "Scope clear?", kind: "decision" },
		{ id: "draft", label: "Draft typed IR", kind: "process" },
		{ id: "review", label: "Review diagram", kind: "end" },
	],
	edges: [
		{ id: "prompt-requirements", source: "prompt", target: "requirements" },
		{ id: "requirements-clear", source: "requirements", target: "clear" },
		{ id: "clear-draft", source: "clear", target: "draft", label: "yes" },
		{
			id: "clear-review",
			source: "clear",
			target: "review",
			label: "no",
		},
		{ id: "draft-review", source: "draft", target: "review" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
});

export const pharmaBatchDispositionFlowchart = parseFlowchartDiagram({
	id: "pharma-batch-disposition",
	title: "Pharma batch disposition flow",
	type: flowchartDiagramType,
	nodes: [
		{ id: "batch-received", label: "Batch received", kind: "start" },
		{
			id: "qa-review",
			label: "QA reviews Certificate of Analysis",
			kind: "process",
		},
		{ id: "passes-specs", label: "Passes specs?", kind: "decision" },
		{ id: "final-review", label: "QA Manager final review", kind: "process" },
		{ id: "packaging", label: "Send to packaging", kind: "end" },
		{ id: "investigate", label: "Investigate retesting", kind: "process" },
		{ id: "reject", label: "Reject batch", kind: "end" },
	],
	edges: [
		{ id: "batch-qa", source: "batch-received", target: "qa-review" },
		{ id: "qa-specs", source: "qa-review", target: "passes-specs" },
		{
			id: "specs-pass",
			source: "passes-specs",
			target: "final-review",
			label: "yes",
		},
		{
			id: "specs-investigate",
			source: "passes-specs",
			target: "investigate",
			label: "retest",
		},
		{
			id: "specs-reject",
			source: "passes-specs",
			target: "reject",
			label: "reject",
		},
		{ id: "review-packaging", source: "final-review", target: "packaging" },
		{ id: "investigate-review", source: "investigate", target: "final-review" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
});

/** A deploy flow whose nodes carry catalog logos, like the marketing hero. */
export const deployPipelineLogoFlowchart = parseFlowchartDiagram({
	id: "deploy-pipeline-logos",
	title: "Deploy pipeline",
	type: flowchartDiagramType,
	nodes: [
		{
			id: "push",
			label: "Push to GitHub",
			kind: "start",
			icon: { slug: "github" },
		},
		{
			id: "build",
			label: "Build the Docker image",
			kind: "process",
			icon: { slug: "docker" },
		},
		{
			id: "tests",
			label: "Tests pass?",
			kind: "decision",
			icon: { slug: "vitest" },
		},
		{ id: "fix", label: "Fix the failing tests", kind: "process" },
		{
			id: "ship",
			label: "Ship to Cloudflare Workers",
			kind: "end",
			icon: { slug: "cloudflare" },
		},
	],
	edges: [
		{ id: "push-build", source: "push", target: "build" },
		{ id: "build-tests", source: "build", target: "tests" },
		{ id: "tests-ship", source: "tests", target: "ship", label: "yes" },
		{ id: "tests-fix", source: "tests", target: "fix", label: "no" },
		{ id: "fix-build", source: "fix", target: "build" },
	],
	layout: {
		direction: "TB",
		edgeRouting: "orthogonal",
	},
});

export const flowchartEvaluationFixtures = [flowchartFixture, pharmaBatchDispositionFlowchart];
