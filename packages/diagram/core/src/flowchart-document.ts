import { Schema } from "effect";

import {
	DIAGRAM_NODE_SHAPES,
	DrawnIconSchema,
	DIAGRAM_ZONE_KINDS,
	DiagramNodeColorSchema,
	SKETCHI_DIAGRAM_STYLE,
	type DiagramNodeShape,
} from "./intermediate.js";
import {
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_GROUP_DEPTH,
	FLOWCHART_MAX_GROUPS,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_LANES,
	FLOWCHART_MAX_NODES,
	FlowchartDiagramSchema,
	type FlowchartDiagram,
	type FlowchartNodeKind,
	type FlowchartValidationIssue,
} from "./types/flowchart.js";

/**
 * The flowchart document: the one shape every surface reads and writes. MCP's
 * buildFlowchart, the CLI, Studio and the hosted generate model all author it, and
 * edits change it by id. Nodes are an id → label map, edges are [from, to, label?]
 * pairs, and containers list what they hold. A node's role (entry, step,
 * decision, end) is read from its edges; nobody declares it.
 */

/** Node, group and lane ids: a letter, then letters, digits, `_` or `-`, so no key reads as an integer. */
export const FLOWCHART_ID_PATTERN = /^[A-Za-z][\w-]*$/u;
export const FLOWCHART_DIRECTIONS = ["TB", "LR"] as const;
export type FlowchartDirection = (typeof FLOWCHART_DIRECTIONS)[number];

const Label = Schema.NonEmptyString.annotate({ message: "Expected a non-empty label" });
const Id = Schema.NonEmptyString;

/**
 * One end of an edge: a node id, or several, which draws one edge per id
 * ("web + api → RDS" is [["web", "api"], "rds"]).
 */
export const FlowchartEdgeEndSchema = Schema.Union([
	Id,
	Schema.Array(Id).check(Schema.isMinLength(1, { message: "Expected at least one node id" })),
]);
export type FlowchartEdgeEnd = typeof FlowchartEdgeEndSchema.Type;

/** [from, to] or [from, to, label]. The pair is the edge's identity. */
export const FlowchartDocumentEdgeSchema = Schema.Tuple([
	FlowchartEdgeEndSchema,
	FlowchartEdgeEndSchema,
	Schema.optionalKey(Schema.String),
]);
export type FlowchartDocumentEdge = typeof FlowchartDocumentEdgeSchema.Type;

/** A node's logo: a product name or slug, a drawn icon, or null for none. */
export const FlowchartNodeIconSchema = Schema.NullOr(
	Schema.Union([Schema.NonEmptyString, DrawnIconSchema]),
);

/** A node's details beyond its label. */
export const FlowchartDocumentNodeDetailsSchema = Schema.Struct({
	label: Label,
	/** A smaller subtitle drawn under the label. */
	note: Schema.optionalKey(Schema.NonEmptyString),
	/**
	 * Draw an infrastructure node as a database, queue, document or storage bucket, or
	 * any step as a decision diamond.
	 */
	shape: Schema.optionalKey(Schema.Literals([...DIAGRAM_NODE_SHAPES, "diamond"])),
	/** A product name or slug whose logo the node draws, or a drawn icon; null draws none. */
	icon: Schema.optionalKey(FlowchartNodeIconSchema),
	/** The innermost group containing this node; unioned with groups’ member lists. */
	group: Schema.optionalKey(Schema.NonEmptyString),
	/** The id of the lane of whoever does the step, in a flowchart with lanes. */
	lane: Schema.optionalKey(Schema.NonEmptyString),
	/** A palette color the node draws in: red, orange, yellow, green, blue, purple or gray. */
	color: Schema.optionalKey(DiagramNodeColorSchema),
});
export interface FlowchartDocumentNodeDetails extends Schema.Schema.Type<
	typeof FlowchartDocumentNodeDetailsSchema
> {}

/** A node: its label, or its details. */
export const FlowchartDocumentNodeSchema = Schema.Union([
	Label,
	FlowchartDocumentNodeDetailsSchema,
]);
export type FlowchartDocumentNode = typeof FlowchartDocumentNodeSchema.Type;

/** A labeled region that holds nodes and other groups; kind says what an architecture zone stands for. */
export const FlowchartDocumentGroupSchema = Schema.Struct({
	label: Label,
	kind: Schema.optionalKey(Schema.Literals(DIAGRAM_ZONE_KINDS)),
	/** The node and group ids inside it, at any depth. */
	contains: Schema.optionalKey(Schema.Array(Id)),
});
export interface FlowchartDocumentGroup extends Schema.Schema.Type<
	typeof FlowchartDocumentGroupSchema
> {}

/**
 * A swimlane's label: a full-length band for one actor, drawn in declared order. Each node
 * names its own lane, so a step sits with whoever does it.
 */
export const FlowchartDocumentLaneSchema = Label;
export type FlowchartDocumentLane = typeof FlowchartDocumentLaneSchema.Type;

/**
 * Logos for the products node labels name: true draws Sketchi's hand-drawn marks,
 * "exact" the original marks, false or absent none.
 */
export const FlowchartLogosSchema = Schema.Union([Schema.Boolean, Schema.Literal("exact")]);
export type FlowchartLogos = typeof FlowchartLogosSchema.Type;

export const FlowchartDocumentSchema = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	direction: Schema.optionalKey(Schema.Literals(FLOWCHART_DIRECTIONS)),
	logos: Schema.optionalKey(FlowchartLogosSchema),
	nodes: Schema.Record(Schema.String, FlowchartDocumentNodeSchema),
	edges: Schema.Array(FlowchartDocumentEdgeSchema),
	groups: Schema.optionalKey(Schema.Record(Schema.String, FlowchartDocumentGroupSchema)),
	lanes: Schema.optionalKey(Schema.Record(Schema.String, FlowchartDocumentLaneSchema)),
});
export interface FlowchartDocument extends Schema.Schema.Type<typeof FlowchartDocumentSchema> {}

/** The label of a node value. */
export function flowchartNodeLabel(node: FlowchartDocumentNode): string {
	return typeof node === "string" ? node : node.label;
}

/** A node value's details, a bare label read as { label }. */
export function flowchartNodeDetails(node: FlowchartDocumentNode): FlowchartDocumentNodeDetails {
	return typeof node === "string" ? { label: node } : node;
}

/** The ids one edge end names. */
export function flowchartEdgeEndIds(end: FlowchartEdgeEnd): readonly string[] {
	return typeof end === "string" ? [end] : end;
}

/** One drawn edge: an end expanded to a single id on each side. */
export interface FlowchartDocumentPair {
	readonly source: string;
	readonly target: string;
	readonly label?: string;
	/** Index of the authored edge it came from. */
	readonly index: number;
}

/** How many pairs the edges draw once each list end is expanded, counted without expanding them. */
export function flowchartDocumentPairCount(edges: readonly FlowchartDocumentEdge[]): number {
	let count = 0;
	for (const [from, to] of edges)
		count += flowchartEdgeEndIds(from).length * flowchartEdgeEndIds(to).length;
	return count;
}

/** Each authored edge expanded into one pair per id on each side, blank labels dropped. */
export function flowchartDocumentPairs(
	edges: readonly FlowchartDocumentEdge[],
): FlowchartDocumentPair[] {
	return edges.flatMap(([from, to, label], index) => {
		const trimmed = label?.trim();
		return flowchartEdgeEndIds(from).flatMap((source) =>
			flowchartEdgeEndIds(to).map((target) => ({
				source,
				target,
				...(trimmed ? { label: trimmed } : {}),
				index,
			})),
		);
	});
}

/** The internal edge id of a pair: its two ends. */
export function flowchartEdgeId(source: string, target: string): string {
	return `${source}->${target}`;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

/** The diagram id a document builds as: its own, or one made from its title. */
export function flowchartDocumentId(document: Pick<FlowchartDocument, "id" | "title">): string {
	return document.id ?? (slugify(document.title) || "flowchart");
}

const quoted = (ids: Iterable<string>) => [...ids].map((id) => `"${id}"`).join(", ");

/** Up to three declared ids that look like an unknown one, else every id when there are few. */
export function nearestFlowchartIds(id: string, known: Iterable<string>): string[] {
	const ids = [...known];
	const lower = id.toLowerCase();
	const distance = (left: string, right: string) => {
		const row = Array.from({ length: right.length + 1 }, (_, index) => index);
		for (let i = 1; i <= left.length; i += 1) {
			let previous = row[0] ?? 0;
			row[0] = i;
			for (let j = 1; j <= right.length; j += 1) {
				const current = row[j] ?? 0;
				row[j] = Math.min(
					current + 1,
					(row[j - 1] ?? 0) + 1,
					previous + (left[i - 1] === right[j - 1] ? 0 : 1),
				);
				previous = current;
			}
		}
		return row[right.length] ?? 0;
	};
	const close = ids
		.map((candidate) => ({ candidate, score: distance(lower, candidate.toLowerCase()) }))
		.filter(
			({ candidate, score }) =>
				score <= Math.max(2, Math.floor(id.length / 3)) ||
				candidate.toLowerCase().includes(lower) ||
				lower.includes(candidate.toLowerCase()),
		)
		.sort((left, right) => left.score - right.score)
		.map(({ candidate }) => candidate);
	if (close.length > 0) return close.slice(0, 3);
	return ids.length <= 12 ? ids : [];
}

/** "Use one of …" for an id nobody declared. */
export function unknownFlowchartIdHint(id: string, known: Iterable<string>, noun: string): string {
	const nearest = nearestFlowchartIds(id, known);
	return nearest.length > 0
		? `Use a declared ${noun} id (${quoted(nearest)}), or declare "${id}".`
		: `Declare "${id}", or use a declared ${noun} id.`;
}

/** Whether a label asks a question: a decision whatever its edges. */
function asksQuestion(label: string): boolean {
	return label.trim().endsWith("?");
}

interface Degrees {
	incoming: number;
	outgoing: number;
}

/**
 * Roles read from the edges. A decision is a node whose label asks a question, or
 * that is drawn as a diamond, and that something leaves; labeled edges out of any other node (an architecture's
 * "write orders", "publish jobs") stay plain labeled edges. Any other node nothing
 * enters is an entry (start) and one nothing leaves an end.
 * When every node is entered, as when a loop returns to the first step, the first
 * node written is the entry.
 */
export function deriveFlowchartKinds(
	nodes: readonly { readonly id: string; readonly label: string; readonly diamond?: boolean }[],
	pairs: readonly Pick<FlowchartDocumentPair, "source" | "target" | "label">[],
): Map<string, FlowchartNodeKind> {
	const degrees = new Map<string, Degrees>(
		nodes.map((node) => [node.id, { incoming: 0, outgoing: 0 }]),
	);
	for (const pair of pairs) {
		const source = degrees.get(pair.source);
		const target = degrees.get(pair.target);
		if (source) {
			source.outgoing += 1;
		}
		if (target) target.incoming += 1;
	}
	const kinds = new Map<string, FlowchartNodeKind>();
	for (const node of nodes) {
		const { incoming, outgoing } = degrees.get(node.id) ?? { incoming: 0, outgoing: 0 };
		const decision = outgoing >= 1 && (node.diamond === true || asksQuestion(node.label));
		kinds.set(
			node.id,
			decision ? "decision" : incoming === 0 ? "start" : outgoing === 0 ? "end" : "process",
		);
	}
	const first = nodes[0];
	if (
		first &&
		![...kinds.values()].includes("start") &&
		kinds.get(first.id) !== "decision" &&
		kinds.get(first.id) !== "end"
	) {
		kinds.set(first.id, "start");
	}
	return kinds;
}

/** A container tree read from what each container lists. */
interface Containment {
	/** Node id → innermost group id. */
	readonly nodeGroup: ReadonlyMap<string, string>;
	/** Group id → the group it sits in. */
	readonly groupParent: ReadonlyMap<string, string>;
	/** Node id → lane id. */
	readonly nodeLane: ReadonlyMap<string, string>;
	readonly issues: FlowchartValidationIssue[];
}

function groupContainment(
	document: FlowchartDocument,
	nodeIds: ReadonlySet<string>,
	issues: FlowchartValidationIssue[],
): { nodeGroup: Map<string, string>; groupParent: Map<string, string> } {
	const groups = Object.entries(document.groups ?? {});
	const groupIds = new Set(groups.map(([id]) => id));
	const order = new Map(groups.map(([id], index) => [id, index]));
	const nodeGroup = new Map<string, string>();
	const groupParent = new Map<string, string>();
	const namedGroups = Object.entries(document.nodes).flatMap(([id, node]) => {
		const group = flowchartNodeDetails(node).group;
		return group === undefined ? [] : [[id, group] as const];
	});
	for (const [id, group] of namedGroups) {
		if (groupIds.has(group)) continue;
		issues.push({
			code: "unknown_node_group",
			ref: { kind: "node", id, path: `nodes.${id}.group` },
			message: `Node "${id}" names undeclared group "${group}".`,
			hint: unknownFlowchartIdHint(group, groupIds, "group"),
		});
	}
	if (groups.length === 0) return { nodeGroup, groupParent };

	// Who lists whom, directly.
	const listedGroups = new Map<string, string[]>();
	const nodeListers = new Map<string, string[]>();
	const groupListers = new Map<string, string[]>();
	for (const [id, group] of groups) {
		const listed: string[] = [];
		(group.contains ?? []).forEach((member, index) => {
			const path = `groups.${id}.contains[${index}]`;
			if (member === id) {
				issues.push({
					code: "group_cycle",
					ref: { kind: "group", id, path },
					message: `Group "${id}" lists itself.`,
					hint: "List only the nodes and groups inside it.",
				});
			} else if (groupIds.has(member)) {
				listed.push(member);
				groupListers.set(member, [...(groupListers.get(member) ?? []), id]);
			} else if (nodeIds.has(member)) {
				nodeListers.set(member, [...(nodeListers.get(member) ?? []), id]);
			} else {
				issues.push({
					code: "unknown_member",
					ref: { kind: "group", id, path },
					message: `Group "${id}" lists "${member}", which is no node or group.`,
					hint: unknownFlowchartIdHint(member, [...nodeIds, ...groupIds], "node or group"),
				});
			}
		});
		listedGroups.set(id, listed);
	}

	// Node pointers contribute membership before any parent is inferred, exactly
	// as another member in the group's contains list would.
	for (const [id, group] of namedGroups) {
		if (groupIds.has(group))
			nodeListers.set(id, [...new Set([...(nodeListers.get(id) ?? []), group])]);
	}

	// A group listed, at any depth, inside itself.
	const visiting = new Set<string>();
	const done = new Set<string>();
	const cyclic = new Set<string>();
	const visit = (id: string, path: string[]) => {
		if (done.has(id)) return;
		if (visiting.has(id)) {
			const loop = path.slice(path.indexOf(id));
			for (const member of loop) cyclic.add(member);
			return;
		}
		visiting.add(id);
		for (const child of listedGroups.get(id) ?? []) visit(child, [...path, child]);
		visiting.delete(id);
		done.add(id);
	};
	for (const [id] of groups) visit(id, [id]);
	for (const id of cyclic) {
		issues.push({
			code: "group_cycle",
			ref: { kind: "group", id, path: `groups.${id}.contains` },
			message: `Group "${id}" ends up inside itself through what the groups list.`,
			hint: "A group lists the groups inside it; never one that holds it.",
		});
	}
	if (cyclic.size > 0) return { nodeGroup, groupParent };

	// Every group and node a group holds, through the groups it lists.
	const insideGroups = new Map<string, Set<string>>();
	const insideNodes = new Map<string, Set<string>>();
	const collect = (id: string): void => {
		if (insideGroups.has(id)) return;
		const groupsInside = new Set<string>();
		const nodesInside = new Set<string>();
		for (const child of listedGroups.get(id) ?? []) {
			collect(child);
			groupsInside.add(child);
			for (const nested of insideGroups.get(child) ?? []) groupsInside.add(nested);
			for (const node of insideNodes.get(child) ?? []) nodesInside.add(node);
		}
		for (const [node, listers] of nodeListers) if (listers.includes(id)) nodesInside.add(node);
		insideGroups.set(id, groupsInside);
		insideNodes.set(id, nodesInside);
	};
	for (const [id] of groups) collect(id);
	const holds = (outer: string, inner: string) => insideGroups.get(outer)?.has(inner) === true;

	// The innermost of several containers, if they nest; else undefined.
	const innermost = (candidates: readonly string[]) =>
		candidates.find((candidate) =>
			candidates.every((other) => other === candidate || holds(other, candidate)),
		);

	// A group listed by several: the innermost of them. A group nobody lists sits
	// inside the smallest group holding every node it holds, which reads "corp:
	// [staff, erp]" inside "dc: [staff, erp, oracle]"; equal groups nest in the
	// order written.
	for (const [id] of groups) {
		const listers = groupListers.get(id) ?? [];
		if (listers.length > 0) {
			const parent = innermost(listers);
			if (parent === undefined) {
				issues.push({
					code: "overlapping_containers",
					ref: { kind: "group", id, path: `groups.${id}` },
					message: `Group "${id}" is listed by ${quoted(listers)}, which do not nest.`,
					hint: "List the group in the one group that holds it, or list one of those groups inside the other.",
				});
			} else {
				groupParent.set(id, parent);
			}
		}
	}
	// Ancestors through the parents derived so far.
	const ancestors = (id: string) => {
		const chain: string[] = [];
		let parent = groupParent.get(id);
		while (parent !== undefined && !chain.includes(parent)) {
			chain.push(parent);
			parent = groupParent.get(parent);
		}
		return chain;
	};
	for (const [id] of groups) {
		if (groupParent.has(id) || (groupListers.get(id)?.length ?? 0) > 0) continue;
		const nodes = insideNodes.get(id) ?? new Set<string>();
		if (nodes.size === 0) continue;
		const candidates = groups
			.map(([other]) => other)
			.filter((other) => {
				// Never under a group already inside this one, listed or inferred.
				if (other === id || holds(id, other) || ancestors(other).includes(id)) return false;
				const outer = insideNodes.get(other) ?? new Set<string>();
				if (![...nodes].every((node) => outer.has(node))) return false;
				return outer.size > nodes.size || (order.get(other) ?? 0) < (order.get(id) ?? 0);
			});
		const smallest = candidates.sort(
			(left, right) =>
				(insideNodes.get(left)?.size ?? 0) - (insideNodes.get(right)?.size ?? 0) ||
				(order.get(right) ?? 0) - (order.get(left) ?? 0),
		)[0];
		if (smallest !== undefined) groupParent.set(id, smallest);
	}
	// Whatever was listed or inferred, the parents form a tree: walks up a group's
	// ancestors always end.
	for (const [id] of groups) {
		const seen = new Set([id]);
		for (let parent = groupParent.get(id); parent !== undefined; parent = groupParent.get(parent)) {
			if (!seen.has(parent)) {
				seen.add(parent);
				continue;
			}
			issues.push({
				code: "group_cycle",
				ref: { kind: "group", id, path: `groups.${id}` },
				message: `Group "${id}" ends up inside itself.`,
				hint: "A group lists the groups inside it; never one that holds it.",
			});
			return { nodeGroup, groupParent: new Map() };
		}
	}
	for (const [node, listers] of nodeListers) {
		const inner = listers.find((candidate) =>
			listers.every((other) => other === candidate || ancestors(candidate).includes(other)),
		);
		if (inner === undefined) {
			issues.push({
				code: "overlapping_containers",
				ref: {
					kind: "node",
					id: node,
					path: namedGroups.some(([id]) => id === node) ? `nodes.${node}.group` : "groups",
				},
				message: `Node "${node}" is listed by groups ${quoted(listers)}, which do not nest.`,
				hint: "List the node in the one group that holds it, or list one of those groups inside the other.",
			});
		} else {
			nodeGroup.set(node, inner);
		}
	}

	let deepest = 0;
	for (const [id] of groups) deepest = Math.max(deepest, ancestors(id).length + 1);
	if (deepest > FLOWCHART_MAX_GROUP_DEPTH) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", path: "groups" },
			message: `Groups nest ${deepest} deep; the supported maximum is ${FLOWCHART_MAX_GROUP_DEPTH}.`,
			hint: "Drop an intermediate zone, or merge a zone into the one around it.",
		});
	}
	if (groups.length > FLOWCHART_MAX_GROUPS) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", path: "groups" },
			message: `Flowchart has ${groups.length} groups; the supported maximum is ${FLOWCHART_MAX_GROUPS}.`,
			hint: "Merge related groups or leave minor steps ungrouped.",
		});
	}
	// A node names its innermost group. A contains list may also name it in that
	// group or an ancestor, but must not assign it to a different direct owner.
	for (const [id, group] of namedGroups) {
		if (!groupIds.has(group)) continue;
		const listed = nodeGroup.get(id);
		if (listed !== undefined && listed !== group && !ancestors(group).includes(listed)) {
			issues.push({
				code: "overlapping_containers",
				ref: { kind: "node", id, path: `nodes.${id}.group` },
				message: `Node "${id}" names group "${group}", but contains places it in "${listed}".`,
				hint: `Use the same innermost group in both forms, or remove the conflicting contains membership.`,
			});
		} else nodeGroup.set(id, group);
	}

	const used = new Set<string>();
	for (const group of nodeGroup.values()) {
		used.add(group);
		for (const parent of ancestors(group)) used.add(parent);
	}
	for (const [id, group] of groups) {
		if (!group.contains?.length && !used.has(id))
			issues.push({
				code: "empty_group",
				ref: { kind: "group", id, path: `groups.${id}` },
				message: `Group "${id}" contains no nodes.`,
				hint: "Assign its nodes with group or contains, or remove the group.",
			});
	}

	return { nodeGroup, groupParent };
}

/** The group each node sits in and the group each group sits in, as a build derives them. */
export function flowchartGroupTree(document: FlowchartDocument): {
	readonly nodeGroup: ReadonlyMap<string, string>;
	readonly groupParent: ReadonlyMap<string, string>;
} {
	return groupContainment(document, new Set(Object.keys(document.nodes)), []);
}

function laneContainment(
	document: FlowchartDocument,
	nodeIds: readonly string[],
	issues: FlowchartValidationIssue[],
): Map<string, string> {
	const lanes = Object.entries(document.lanes ?? {});
	const nodeLane = new Map<string, string>();
	if (lanes.length === 0) {
		for (const node of nodeIds) {
			const lane = flowchartNodeDetails(document.nodes[node] ?? node).lane;
			if (lane === undefined) continue;
			issues.push({
				code: "unknown_node_lane",
				ref: { kind: "node", id: node, path: `nodes.${node}.lane` },
				message: `Node "${node}" names lane "${lane}", but the flowchart declares no lanes.`,
				hint: `Declare lanes: { "${lane}": "Label" }, or remove the node's lane.`,
			});
		}
		return nodeLane;
	}
	if (lanes.length > FLOWCHART_MAX_LANES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", path: "lanes" },
			message: `Flowchart has ${lanes.length} lanes; the supported maximum is ${FLOWCHART_MAX_LANES}.`,
			hint: "Merge related actors into one lane.",
		});
	}
	if (Object.keys(document.groups ?? {}).length > 0) {
		issues.push({
			code: "lanes_with_groups",
			ref: { kind: "diagram", path: "groups" },
			message: "A flowchart with lanes cannot also declare groups.",
			hint: "Keep the lanes for the actors and remove groups.",
		});
	}
	const laneIds = lanes.map(([id]) => id);
	const declared = new Set(laneIds);
	for (const node of nodeIds) {
		const lane = flowchartNodeDetails(document.nodes[node] ?? node).lane;
		const path = `nodes.${node}.lane`;
		if (lane === undefined) {
			issues.push({
				code: "node_without_lane",
				ref: { kind: "node", id: node, path },
				message: `Node "${node}" names no lane.`,
				hint: `Set its lane to whoever does it (${quoted(laneIds)}).`,
			});
		} else if (!declared.has(lane)) {
			issues.push({
				code: "unknown_node_lane",
				ref: { kind: "node", id: node, path },
				message: `Node "${node}" names lane "${lane}", which is not declared.`,
				hint: unknownFlowchartIdHint(lane, laneIds, "lane"),
			});
		} else {
			nodeLane.set(node, lane);
		}
	}
	return nodeLane;
}

function containment(document: FlowchartDocument, nodeIds: readonly string[]): Containment {
	const issues: FlowchartValidationIssue[] = [];
	const { nodeGroup, groupParent } = groupContainment(document, new Set(nodeIds), issues);
	const nodeLane = laneContainment(document, nodeIds, issues);
	return { nodeGroup, groupParent, nodeLane, issues };
}

function graphIssues(
	nodes: readonly { readonly id: string; readonly label: string }[],
	pairs: readonly FlowchartDocumentPair[],
	kinds: ReadonlyMap<string, FlowchartNodeKind>,
): FlowchartValidationIssue[] {
	const issues: FlowchartValidationIssue[] = [];
	const outgoing = new Map<string, FlowchartDocumentPair[]>();
	const incoming = new Map<string, FlowchartDocumentPair[]>();
	for (const pair of pairs) {
		outgoing.set(pair.source, [...(outgoing.get(pair.source) ?? []), pair]);
		incoming.set(pair.target, [...(incoming.get(pair.target) ?? []), pair]);
	}
	if (nodes.length > 1) {
		for (const node of nodes) {
			if (!outgoing.has(node.id) && !incoming.has(node.id)) {
				issues.push({
					code: "isolated_node",
					ref: { kind: "node", id: node.id, path: `nodes.${node.id}` },
					message: `Node "${node.id}" has no edges.`,
					hint: "Connect it where the flow reaches it, or remove it.",
				});
			}
		}
	}
	for (const node of nodes) {
		if (kinds.get(node.id) !== "decision") continue;
		const exits = outgoing.get(node.id) ?? [];
		if (exits.length < 2) continue;
		for (const exit of exits.filter((pair) => !pair.label)) {
			issues.push({
				code: "unlabeled_decision_branch",
				ref: {
					kind: "edge",
					id: flowchartEdgeId(exit.source, exit.target),
					path: `edges[${exit.index}]`,
				},
				message: `Decision "${node.id}" has an unlabeled branch to "${exit.target}".`,
				hint: 'Label every branch of a question, such as "yes" and "no".',
			});
		}
		// One edge whose end lists several steps is one branch: its label fans out.
		const seen = new Map<string, number>();
		for (const exit of exits) {
			const label = exit.label?.toLowerCase();
			if (label === undefined) continue;
			const first = seen.get(label);
			if (first !== undefined && first !== exit.index) {
				issues.push({
					code: "duplicate_decision_branch_label",
					ref: { kind: "node", id: node.id, path: `edges[${exit.index}][2]` },
					message: `Decision "${node.id}" repeats the branch label "${exit.label}".`,
					hint: `Give each branch of the same question its own label; a branch that leads to several steps lists them in one edge: ["${node.id}", ["${exit.target}", "…"], "${exit.label}"].`,
				});
			}
			if (first === undefined) seen.set(label, exit.index);
		}
	}

	const reach = (from: readonly string[], next: (id: string) => readonly string[]) => {
		const seen = new Set<string>();
		const queue = [...from];
		while (queue.length > 0) {
			const id = queue.pop();
			if (id === undefined || seen.has(id)) continue;
			seen.add(id);
			queue.push(...next(id));
		}
		return seen;
	};
	// Entries by the edges alone: what nothing enters, else the first node written. A
	// question can be an entry too.
	const unentered = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
	const first = nodes[0]?.id;
	const entries = unentered.length > 0 ? unentered : first === undefined ? [] : [first];
	const reached = reach(entries, (id) => (outgoing.get(id) ?? []).map((pair) => pair.target));
	for (const node of nodes) {
		if (reached.has(node.id) || !incoming.has(node.id)) continue;
		issues.push({
			code: "unreachable_node",
			ref: { kind: "node", id: node.id, path: `nodes.${node.id}` },
			message: `Node "${node.id}" is only reached from a loop nothing enters.`,
			hint: "Connect the loop to the flow that reaches it.",
		});
	}
	const ends = nodes.filter((node) => !outgoing.has(node.id)).map((node) => node.id);
	const reachesEnd = reach(ends, (id) => (incoming.get(id) ?? []).map((pair) => pair.source));
	for (const node of nodes) {
		if (reachesEnd.has(node.id) || !outgoing.has(node.id)) continue;
		issues.push({
			code: "nonterminating_node",
			ref: { kind: "node", id: node.id, path: `nodes.${node.id}` },
			message: `Node "${node.id}" is in a loop with no way out.`,
			hint: "Give the loop an exit to a step that ends the flow.",
		});
	}
	return issues;
}

/**
 * The spelling of a reference that case, separators and trailing punctuation do not change.
 * Letters and digits of any script count, so a non-Latin label keeps its key.
 */
export function flowchartReferenceKey(reference: string): string {
	return reference
		.trim()
		.replace(/[^\p{L}\p{N}_-]+$/gu, "")
		.toLowerCase()
		.replace(/[-_\s]+/gu, "-");
}

/**
 * Resolve a reference to one declared id, trying in turn the id itself, the one label it spells
 * exactly, the one id it spells differently, then the one label it spells differently. An
 * ambiguous or unknown reference resolves to nothing.
 */
export function resolveFlowchartReference(
	reference: string,
	declared: Iterable<readonly [id: string, label?: string]>,
): { readonly id: string; readonly by: "id" | "spelling" | "label" } | undefined {
	const entries = [...declared];
	if (entries.some(([id]) => id === reference)) return { id: reference, by: "id" };
	const unique = (matches: readonly (readonly [string, string?])[]) =>
		matches.length === 1 ? matches[0]?.[0] : undefined;
	const labeled = unique(entries.filter(([, label]) => label === reference));
	if (labeled !== undefined) return { id: labeled, by: "label" };
	const key = flowchartReferenceKey(reference);
	if (key === "") return undefined;
	const spelled = unique(entries.filter(([id]) => flowchartReferenceKey(id) === key));
	if (spelled !== undefined) return { id: spelled, by: "spelling" };
	const spelledLabel = unique(
		entries.filter(([, label]) => label !== undefined && flowchartReferenceKey(label) === key),
	);
	return spelledLabel === undefined ? undefined : { id: spelledLabel, by: "label" };
}

/** Resolve only unique spelling variants of declared ids; exact ids always win. */
export function resolveFlowchartReferences(document: FlowchartDocument): {
	readonly document: FlowchartDocument;
	readonly notes: readonly string[];
} {
	const key = flowchartReferenceKey;
	const notes: string[] = [];
	const resolver = (ids: readonly string[]) => {
		const exact = new Set(ids);
		const matches = new Map<string, string[]>();
		for (const id of ids) matches.set(key(id), [...(matches.get(key(id)) ?? []), id]);
		return (id: string, path: string): string => {
			if (exact.has(id)) return id;
			const candidates = matches.get(key(id));
			const found = candidates?.length === 1 ? candidates[0] : undefined;
			if (found === undefined) return id;
			notes.push(
				`${path}: resolved ${JSON.stringify(id)} to declared id ${JSON.stringify(found)}.`,
			);
			return found;
		};
	};
	const groupIds = Object.keys(document.groups ?? {});
	const resolve = resolver([...Object.keys(document.nodes), ...groupIds]);
	const groupRef = resolver(groupIds);
	const laneRef = resolver(Object.keys(document.lanes ?? {}));
	const end = (value: FlowchartEdgeEnd, path: string): FlowchartEdgeEnd =>
		typeof value === "string"
			? resolve(value, path)
			: value.map((id, i) => resolve(id, `${path}[${i}]`));

	return {
		document: {
			...document,
			edges: document.edges.map(([from, to, label], i) => {
				const pair = [end(from, `edges[${i}][0]`), end(to, `edges[${i}][1]`)] as const;
				return label === undefined ? pair : [...pair, label];
			}),
			nodes: Object.fromEntries(
				Object.entries(document.nodes).map(([id, node]) => [
					id,
					typeof node === "string"
						? node
						: {
								...node,
								...(node.group ? { group: groupRef(node.group, `nodes.${id}.group`) } : {}),
								...(node.lane ? { lane: laneRef(node.lane, `nodes.${id}.lane`) } : {}),
							},
				]),
			),
			...(document.groups
				? {
						groups: Object.fromEntries(
							Object.entries(document.groups).map(([id, group]) => [
								id,
								{
									...group,
									...(group.contains
										? {
												contains: group.contains.map((member, i) =>
													resolve(member, `groups.${id}.contains[${i}]`),
												),
											}
										: {}),
								},
							]),
						),
					}
				: {}),
		},
		notes,
	};
}

/** A label that names a database: "Oracle database", "Orders DB", "Postgres replica". */
const DATABASE_LABEL =
	/\b(?:database|db)s?\s*$|\b(?:postgres(?:ql)?|mysql|mariadb|mongodb|dynamodb|cosmos\s?db|sql\s+server|mssql|sqlite|cassandra|couchdb|cockroachdb|firestore|spanner|aurora|cloud\s+sql|neo4j|supabase)\b/iu;
/** A step that acts on a database rather than being one: "Write to database", "Query Postgres". */
const ACTS_ON_DATA =
	/^\s*(?:add|archive|back|backup|call|check|close|connect|copy|create|delete|export|fetch|get|import|insert|load|log|look|lookup|migrate|open|persist|purge|put|query|read|record|remove|replicate|restore|run|save|scan|search|seed|select|send|set|store|sync|update|write)s?\b/iu;

/**
 * The shape a node draws as when its document gives none: a database cylinder for a node that
 * names a database, whatever product it is, as every database draws.
 */
export function impliedFlowchartNodeShape(label: string): DiagramNodeShape | undefined {
	return DATABASE_LABEL.test(label) && !ACTS_ON_DATA.test(label) && !label.trim().endsWith("?")
		? "database"
		: undefined;
}

/** A document built into the internal flowchart, or the problems that stop it. */
export type FlowchartDocumentBuild =
	| { readonly ok: true; readonly diagram: FlowchartDiagram; readonly notes: readonly string[] }
	| { readonly ok: false; readonly issues: readonly FlowchartValidationIssue[] };

export interface FlowchartDocumentBuildOptions {
	/** Node id → the catalog slug of the logo it draws, as the host resolved it. */
	readonly nodeIcons?: ReadonlyMap<string, string>;
	/** Group id → the catalog slug of the logo before its label. */
	readonly groupIcons?: ReadonlyMap<string, string>;
}

/**
 * Check a document and build the internal flowchart the renderer draws: roles
 * read from the edges, list ends expanded, the container tree read from what each
 * container lists. Every problem comes back at once, each with its repair.
 */
export function flowchartDiagramFromDocument(
	input: FlowchartDocument,
	options: FlowchartDocumentBuildOptions = {},
): FlowchartDocumentBuild {
	const { document, notes } = resolveFlowchartReferences(input);
	const issues: FlowchartValidationIssue[] = [];
	const nodeEntries = Object.entries(document.nodes);
	const nodeIds = nodeEntries.map(([id]) => id);
	const known = new Set(nodeIds);
	const groupIds = new Set(Object.keys(document.groups ?? {}));
	const laneIds = new Set(Object.keys(document.lanes ?? {}));

	for (const [kind, ids] of [
		["node", nodeIds],
		["group", [...groupIds]],
		["lane", [...laneIds]],
	] as const) {
		for (const id of ids) {
			if (FLOWCHART_ID_PATTERN.test(id)) continue;
			issues.push({
				code: "invalid_id",
				ref: { kind, id, path: `${kind === "node" ? "nodes" : `${kind}s`}.${id}` },
				message: `The ${kind} id "${id}" must start with a letter and use only letters, digits, "_" or "-".`,
				hint: `Rename "${id}", for example to "${kind}-${id.replace(/[^\w-]+/gu, "-")}".`,
			});
		}
	}
	for (const id of nodeIds) {
		if (groupIds.has(id) || laneIds.has(id)) {
			issues.push({
				code: "duplicate_node_id",
				ref: { kind: "node", id, path: `nodes.${id}` },
				message: `"${id}" names both a node and a ${groupIds.has(id) ? "group" : "lane"}.`,
				hint: "Give every node, group and lane its own id.",
			});
		}
	}
	if (nodeEntries.length < 2) {
		issues.push({
			code: "flowchart_too_small",
			ref: { kind: "diagram", path: "nodes" },
			message: `A flowchart needs at least two nodes; this one has ${nodeEntries.length}.`,
			hint: "Add the steps the flow passes through.",
		});
	}
	if (nodeEntries.length > FLOWCHART_MAX_NODES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", path: "nodes" },
			message: `Flowchart has ${nodeEntries.length} nodes; the supported maximum is ${FLOWCHART_MAX_NODES}.`,
			hint: "Split the workflow or combine lower-signal steps.",
		});
	}

	// List ends multiply, so a short request can name a vast number of edges: count them
	// before expanding any.
	const pairCount = flowchartDocumentPairCount(document.edges);
	if (pairCount > FLOWCHART_MAX_EDGES) {
		issues.push({
			code: "flowchart_too_large",
			ref: { kind: "diagram", path: "edges" },
			message: `Flowchart draws ${pairCount} edges; the supported maximum is ${FLOWCHART_MAX_EDGES}.`,
			hint: "Split the workflow or remove lower-signal connections.",
		});
		return { ok: false, issues: issues.slice(0, FLOWCHART_MAX_ISSUES) };
	}
	const pairs = flowchartDocumentPairs(document.edges);
	const valid: FlowchartDocumentPair[] = [];
	const seen = new Map<string, number>();
	for (const pair of pairs) {
		const id = flowchartEdgeId(pair.source, pair.target);
		const ends = [
			[pair.source, 0, "missing_edge_source"],
			[pair.target, 1, "missing_edge_target"],
		] as const;
		let ok = true;
		for (const [end, side, code] of ends) {
			if (known.has(end)) continue;
			ok = false;
			issues.push({
				code,
				ref: { kind: "edge", id, path: `edges[${pair.index}][${side}]` },
				message: `edges[${pair.index}] names "${end}", which is no node.`,
				hint: unknownFlowchartIdHint(end, nodeIds, "node"),
			});
		}
		if (pair.source === pair.target) {
			ok = false;
			issues.push({
				code: "self_loop",
				ref: { kind: "edge", id, path: `edges[${pair.index}]` },
				message: `edges[${pair.index}] connects "${pair.source}" to itself.`,
				hint: "A repeated step returns to an earlier step instead.",
			});
		}
		const first = seen.get(id);
		if (first !== undefined) {
			ok = false;
			issues.push({
				code: "duplicate_edge",
				ref: { kind: "edge", id, path: `edges[${pair.index}]` },
				message: `edges[${pair.index}] repeats ${pair.source} → ${pair.target} from edges[${first}].`,
				hint: "Keep one edge between two nodes; put both words in its label if needed.",
			});
		}
		if (ok) {
			seen.set(id, pair.index);
			valid.push(pair);
		}
	}
	if (valid.length === 0 && issues.length === 0) {
		issues.push({
			code: "flowchart_too_small",
			ref: { kind: "diagram", path: "edges" },
			message: "A flowchart needs at least one edge.",
			hint: "Connect the nodes in the order the flow takes.",
		});
	}
	const contained = containment(document, nodeIds);
	issues.push(...contained.issues);

	const labeled = nodeEntries.map(([id, node]) => ({
		id,
		label: flowchartNodeLabel(node),
		diamond: flowchartNodeDetails(node).shape === "diamond",
	}));
	const kinds = deriveFlowchartKinds(labeled, valid);
	issues.push(...graphIssues(labeled, valid, kinds));

	if (issues.length > 0) return { ok: false, issues: issues.slice(0, FLOWCHART_MAX_ISSUES) };

	const diagram = Schema.decodeUnknownSync(FlowchartDiagramSchema)({
		id: flowchartDocumentId(document),
		title: document.title,
		type: "flowchart",
		nodes: nodeEntries.map(([id, value]) => {
			const node = flowchartNodeDetails(value);
			const group = contained.nodeGroup.get(id);
			const lane = contained.nodeLane.get(id);
			const icon = options.nodeIcons?.get(id);
			const kind = kinds.get(id) ?? "process";
			const shape =
				node.shape === undefined && kind !== "decision"
					? impliedFlowchartNodeShape(node.label)
					: node.shape;
			return {
				id,
				label: node.label,
				kind,
				...(node.note ? { description: node.note } : {}),
				...(shape && shape !== "diamond" ? { shape } : {}),
				...(icon ? { icon: { slug: icon } } : {}),
				...(node.color ? { color: node.color } : {}),
				...(group ? { group } : {}),
				...(lane ? { lane } : {}),
				metadata: {},
			};
		}),
		edges: valid.map((pair) => ({
			id: flowchartEdgeId(pair.source, pair.target),
			source: pair.source,
			target: pair.target,
			...(pair.label ? { label: pair.label } : {}),
			metadata: {},
		})),
		...(groupIds.size > 0
			? {
					groups: Object.entries(document.groups ?? {}).map(([id, group]) => {
						const parent = contained.groupParent.get(id);
						const icon = options.groupIcons?.get(id);
						return {
							id,
							label: group.label,
							...(parent ? { parent } : {}),
							...(group.kind ? { kind: group.kind } : {}),
							...(icon ? { icon: { slug: icon } } : {}),
						};
					}),
				}
			: {}),
		...(laneIds.size > 0
			? {
					lanes: Object.entries(document.lanes ?? {}).map(([id, label]) => ({ id, label })),
				}
			: {}),
		layout: { direction: document.direction ?? "TB", edgeRouting: "orthogonal" },
		style: { ...SKETCHI_DIAGRAM_STYLE },
		metadata: document.logos ? { logos: document.logos === "exact" ? "exact" : "native" } : {},
	});
	return { ok: true, diagram, notes };
}

/** Decode unknown input as a flowchart document, every schema problem at once. */
export const decodeFlowchartDocument = Schema.decodeUnknownResult(FlowchartDocumentSchema, {
	errors: "all",
});
