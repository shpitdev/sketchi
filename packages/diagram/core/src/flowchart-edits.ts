import { Schema } from "effect";

import { DIAGRAM_NODE_SHAPES, DIAGRAM_ZONE_KINDS, DiagramNodeColorSchema } from "./intermediate.js";
import {
	FLOWCHART_DIRECTIONS,
	FlowchartDocumentEdgeSchema,
	FlowchartDocumentNodeSchema,
	FlowchartEdgeEndSchema,
	FlowchartLogosSchema,
	flowchartDocumentPairCount,
	flowchartEdgeEndIds,
	flowchartGroupTree,
	flowchartNodeDetails,
	resolveFlowchartReference,
	unknownFlowchartIdHint,
	type FlowchartDocument,
	type FlowchartDocumentEdge,
	type FlowchartEdgeEnd,
	type FlowchartDocumentGroup,
	type FlowchartDocumentLane,
	type FlowchartDocumentNode,
	type FlowchartDocumentNodeDetails,
} from "./flowchart-document.js";
import { FLOWCHART_MAX_EDGES } from "./types/flowchart.js";

/**
 * Edits to a flowchart document, each addressing nodes, groups and lanes by id
 * and edges by [from, to]. `set` takes the document's own shape, so a model that
 * can write a flowchart can change one.
 */

const Label = Schema.NonEmptyString;

/** Fields of a node to change; null clears an optional field. */
const NodeChangeSchema = Schema.Struct({
	label: Schema.optionalKey(Label),
	note: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
	shape: Schema.optionalKey(Schema.NullOr(Schema.Literals([...DIAGRAM_NODE_SHAPES, "diamond"]))),
	icon: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
	/** The node’s innermost group; null clears it. */
	group: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
	/** The lane of whoever does the step. */
	lane: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
	color: Schema.optionalKey(Schema.NullOr(DiagramNodeColorSchema)),
});

const GroupChangeSchema = Schema.Struct({
	label: Schema.optionalKey(Label),
	kind: Schema.optionalKey(Schema.NullOr(Schema.Literals(DIAGRAM_ZONE_KINDS))),
	/** Replaces what the group lists. */
	contains: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});

/** Adds a node into an existing edge: a → b becomes a → node → b. */
export const FlowchartInsertEditSchema = Schema.Struct({
	op: Schema.Literal("insert"),
	/** The new node, as { id: label } or { id: { label, … } }. */
	node: Schema.Record(Schema.String, FlowchartDocumentNodeSchema),
	between: Schema.Tuple([Schema.NonEmptyString, Schema.NonEmptyString]),
});

/** Merges a partial document: new ids add, existing ids merge, null removes. */
export const FlowchartSetEditSchema = Schema.Struct({
	op: Schema.Literal("set"),
	title: Schema.optionalKey(Schema.NonEmptyString),
	direction: Schema.optionalKey(Schema.Literals(FLOWCHART_DIRECTIONS)),
	logos: Schema.optionalKey(FlowchartLogosSchema),
	nodes: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.NullOr(Schema.Union([FlowchartDocumentNodeSchema, NodeChangeSchema])),
		),
	),
	groups: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(GroupChangeSchema))),
	/** A lane's label, or null to remove it; a node's lane says who does it. */
	lanes: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Label))),
});

/** Adds edges, or relabels an edge that exists. */
export const FlowchartConnectEditSchema = Schema.Struct({
	op: Schema.Literal("connect"),
	edges: Schema.Array(FlowchartDocumentEdgeSchema),
});

/** Removes edges. */
export const FlowchartDisconnectEditSchema = Schema.Struct({
	op: Schema.Literal("disconnect"),
	edges: Schema.Array(Schema.Tuple([FlowchartEdgeEndSchema, FlowchartEdgeEndSchema])),
});

export const FlowchartEditSchema = Schema.Union([
	FlowchartInsertEditSchema,
	FlowchartSetEditSchema,
	FlowchartConnectEditSchema,
	FlowchartDisconnectEditSchema,
]);
export type FlowchartEdit = typeof FlowchartEditSchema.Type;

export const FlowchartEditsSchema = Schema.Array(FlowchartEditSchema).check(
	Schema.isMinLength(1, { message: "Expected at least one edit" }),
);

/** A reason an edit list cannot apply, at the path of the op that names it. */
export interface FlowchartEditIssue {
	readonly code: "unknown_edit_target" | "invalid_edit";
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

export type FlowchartEditResult =
	| {
			readonly ok: true;
			readonly document: FlowchartDocument;
			/** Each reference resolved to a declared id it does not spell exactly, at its path. */
			readonly notes: readonly string[];
	  }
	| { readonly ok: false; readonly issues: readonly FlowchartEditIssue[] };

/** One editable pair, retaining the authored edge that gives a fan-out its branch identity. */
interface Edge {
	readonly source: string;
	readonly target: string;
	readonly label?: string;
	readonly branch: number;
}
type Mutable = {
	title: string;
	id?: string;
	direction?: FlowchartDocument["direction"];
	logos?: FlowchartDocument["logos"];
	nodes: [string, FlowchartDocumentNode][];
	edges: Edge[];
	groups: [string, FlowchartDocumentGroup][];
	lanes: [string, FlowchartDocumentLane][];
};

const pairKey = (source: string, target: string) => `${source}\u0000${target}`;

/** Split list ends for pair-addressed edits without losing their shared branch. */
function singlePairs(edges: readonly FlowchartDocumentEdge[], firstBranch = 0): Edge[] {
	return edges.flatMap(([from, to, label], index) =>
		flowchartEdgeEndIds(from).flatMap((source) =>
			flowchartEdgeEndIds(to).map((target) => ({
				source,
				target,
				...(label === undefined ? {} : { label }),
				branch: firstBranch + index,
			})),
		),
	);
}

const ends = (edge: Edge) => [edge.source, edge.target] as const;

/** Rejoin only pairs from the same authored branch, separately for each source. */
function documentEdges(edges: readonly Edge[]): FlowchartDocumentEdge[] {
	const branches = new Map<
		string,
		{ source: string; targets: [string, ...string[]]; label?: string }
	>();
	for (const edge of edges) {
		const key = `${edge.branch}:${edge.source}`;
		const branch = branches.get(key);
		if (branch) branch.targets.push(edge.target);
		else
			branches.set(key, {
				source: edge.source,
				targets: [edge.target],
				...(edge.label === undefined ? {} : { label: edge.label }),
			});
	}
	return [...branches.values()].map(({ source, targets, label }) => {
		const target = targets.length === 1 ? targets[0] : targets;
		return label === undefined ? [source, target] : [source, target, label];
	});
}

/** Replace or add an entry in an ordered map, a new one after `after` when given. */
function upsert<V>(entries: [string, V][], id: string, value: V, after?: string): [string, V][] {
	const index = entries.findIndex(([key]) => key === id);
	if (index >= 0) return entries.map((entry, at) => (at === index ? [id, value] : entry));
	const position = after === undefined ? -1 : entries.findIndex(([key]) => key === after);
	if (position < 0) return [...entries, [id, value]];
	return [...entries.slice(0, position + 1), [id, value], ...entries.slice(position + 1)];
}

/** Drop a node from member lists, pruning only the groups its removal empties. */
function removeNodeFromGroups(state: Mutable, id: string, affected: ReadonlySet<string>): void {
	state.groups = state.groups.map(([key, group]) => [
		key,
		group.contains === undefined
			? group
			: { ...group, contains: group.contains.filter((member) => member !== id) },
	]);
	const tree = flowchartGroupTree(toDocument(state));
	const used = new Set<string>();
	for (const group of tree.nodeGroup.values()) {
		for (
			let current: string | undefined = group;
			current !== undefined && !used.has(current);
			current = tree.groupParent.get(current)
		)
			used.add(current);
	}
	const emptied = new Set(
		state.groups.filter(([key]) => affected.has(key) && !used.has(key)).map(([key]) => key),
	);
	state.groups = state.groups
		.filter(([key]) => !emptied.has(key))
		.map(([key, group]) => [
			key,
			group.contains === undefined
				? group
				: { ...group, contains: group.contains.filter((member) => !emptied.has(member)) },
		]);
}

/** A node value with a change merged in; null clears a field. */
function mergeNode(
	current: FlowchartDocumentNode,
	change: FlowchartDocumentNode | typeof NodeChangeSchema.Type,
): FlowchartDocumentNode {
	if (typeof change === "string") {
		return typeof current === "string" ? change : { ...current, label: change };
	}
	const merged: Record<string, unknown> = { ...flowchartNodeDetails(current) };
	// A bare label merged with details keeps its label.
	for (const [key, value] of Object.entries(change)) {
		if (value === null && key !== "icon") delete merged[key];
		else merged[key] = value;
	}
	const details = merged as unknown as FlowchartDocumentNodeDetails;
	return Object.keys(details).length === 1 ? details.label : details;
}

/**
 * Containers with changes merged in: new ids add, fields merge, `contains`
 * replaces, and null removes a container while the containers that listed it list
 * what it held instead.
 */
function setContainers<C extends { readonly label: string; readonly contains?: readonly string[] }>(
	entries: [string, C][],
	changes: Readonly<Record<string, Record<string, unknown> | null>> | undefined,
	collection: "group" | "lane",
	at: string,
	issues: FlowchartEditIssue[],
): [string, C][] {
	let result = entries;
	for (const [id, change] of Object.entries(changes ?? {})) {
		const path = `${at}.${collection}s.${id}`;
		const current = result.find(([key]) => key === id)?.[1];
		if (change === null) {
			if (current === undefined) {
				issues.push({
					code: "unknown_edit_target",
					path,
					message: `${at} removes ${collection} "${id}", which does not exist.`,
					hint: unknownFlowchartIdHint(
						id,
						result.map(([key]) => key),
						collection,
					),
				});
				continue;
			}
			result = result
				.filter(([key]) => key !== id)
				.map(([key, container]): [string, C] => {
					if (!container.contains?.includes(id)) return [key, container];
					const contains = [
						...new Set(
							container.contains.flatMap((member) =>
								member === id ? (current.contains ?? []) : [member],
							),
						),
					];
					return [key, { ...container, contains }];
				});
			continue;
		}
		const merged: Record<string, unknown> = { ...current };
		for (const [field, value] of Object.entries(change)) {
			if (value === null) delete merged[field];
			else merged[field] = value;
		}
		const { label, contains } = merged;
		if (typeof label !== "string" || (contains !== undefined && !Array.isArray(contains))) {
			issues.push({
				code: "invalid_edit",
				path,
				message:
					current === undefined
						? `${at} adds ${collection} "${id}" without a label.`
						: `${at} leaves ${collection} "${id}" invalid.`,
				hint:
					current === undefined
						? `Give the new ${collection} a label and assign its nodes with group or contains.`
						: `Remove the ${collection} with null instead.`,
			});
			continue;
		}
		result = upsert(result, id, merged as unknown as C);
	}
	return result;
}

/** Lanes with changes merged in: a label adds or renames a lane, and null removes it. */
function setLanes(
	entries: [string, string][],
	changes: Readonly<Record<string, string | null>> | undefined,
	at: string,
	issues: FlowchartEditIssue[],
): [string, string][] {
	let result = entries;
	for (const [id, label] of Object.entries(changes ?? {})) {
		if (label !== null) {
			result = upsert(result, id, label);
			continue;
		}
		if (!result.some(([key]) => key === id)) {
			issues.push({
				code: "unknown_edit_target",
				path: `${at}.lanes.${id}`,
				message: `${at} removes lane "${id}", which does not exist.`,
				hint: unknownFlowchartIdHint(
					id,
					result.map(([key]) => key),
					"lane",
				),
			});
			continue;
		}
		result = result.filter(([key]) => key !== id);
	}
	return result;
}

function compact<V>(entries: readonly [string, V][]): Record<string, V> | undefined {
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toDocument(state: Mutable): FlowchartDocument {
	const groups = compact(state.groups);
	const lanes = compact(state.lanes);
	return {
		...(state.id === undefined ? {} : { id: state.id }),
		title: state.title,
		...(state.direction === undefined ? {} : { direction: state.direction }),
		...(state.logos === undefined ? {} : { logos: state.logos }),
		nodes: Object.fromEntries(state.nodes),
		edges: documentEdges(state.edges),
		...(groups ? { groups } : {}),
		...(lanes ? { lanes } : {}),
	};
}

/**
 * Two changes to one id as one, field by field: a string is a label, null removes. Undefined when
 * they disagree.
 */
function mergeChanges(left: unknown, right: unknown): unknown {
	if (left === null || right === null) return left === right ? null : undefined;
	const fields = (value: unknown): Record<string, unknown> | undefined =>
		typeof value === "string"
			? { label: value }
			: typeof value === "object" && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: undefined;
	const a = fields(left);
	const b = fields(right);
	if (a === undefined || b === undefined) return left === right ? left : undefined;
	for (const [field, value] of Object.entries(b)) {
		if (field in a && JSON.stringify(a[field]) !== JSON.stringify(value)) return undefined;
	}
	const merged = { ...a, ...b };
	return typeof left === "string" && typeof right === "string" ? left : merged;
}

/** The fields a node's details may hold, besides the id an inserted node may carry inline. */
const NODE_DETAIL_FIELDS = new Set(["label", "note", "shape", "icon", "color", "group", "lane"]);

/**
 * The node an insert adds, as { id: label } or { id: { label, … } }, or written flat as
 * { id, label, … }, which models often reach for.
 */
function insertedNodeEntries(
	node: Readonly<Record<string, FlowchartDocumentNode>>,
): [string, FlowchartDocumentNode][] {
	const { id, ...details } = node;
	const flat =
		typeof id === "string" &&
		typeof details["label"] === "string" &&
		Object.entries(details).every(
			([field, value]) => NODE_DETAIL_FIELDS.has(field) && typeof value === "string",
		);
	if (!flat) return Object.entries(node);
	return [
		[
			id,
			Object.keys(details).length === 1
				? (details["label"] as string)
				: (details as unknown as FlowchartDocumentNodeDetails),
		],
	];
}

/**
 * Apply edits in order to a document. The result is an unchecked document: build
 * it as any other to learn whether it holds together. An edit that names an id or
 * an edge the document lacks stops the whole list, at its path.
 */
export function applyFlowchartEdits(
	document: FlowchartDocument,
	edits: readonly FlowchartEdit[],
): FlowchartEditResult {
	// List ends multiply: count what the document and each edit's edges would draw before
	// expanding any of them.
	const oversized = [
		["document.edges", document.edges] as const,
		...edits.flatMap((edit, index) =>
			edit.op === "connect" || edit.op === "disconnect"
				? [[`edits[${index}].edges`, edit.edges] as const]
				: [],
		),
	].flatMap(([path, edges]) => {
		const count = flowchartDocumentPairCount(edges);
		return count > FLOWCHART_MAX_EDGES
			? [
					{
						code: "invalid_edit" as const,
						path,
						message: `${path} names ${count} edges; a flowchart draws at most ${FLOWCHART_MAX_EDGES}.`,
						hint: "Name fewer ids in each list end.",
					},
				]
			: [];
	});
	if (oversized.length > 0) return { ok: false, issues: oversized };
	const state: Mutable = {
		title: document.title,
		...(document.id === undefined ? {} : { id: document.id }),
		...(document.direction === undefined ? {} : { direction: document.direction }),
		...(document.logos === undefined ? {} : { logos: document.logos }),
		nodes: Object.entries(document.nodes),
		edges: singlePairs(document.edges),
		groups: Object.entries(document.groups ?? {}),
		lanes: Object.entries(document.lanes ?? {}),
	};
	let nextBranch = document.edges.length;
	const issues: FlowchartEditIssue[] = [];
	const nodeIds = () => state.nodes.map(([id]) => id);
	const hasNode = (id: string) => state.nodes.some(([key]) => key === id);
	const unknownNode = (id: string, path: string) =>
		issues.push({
			code: "unknown_edit_target",
			path,
			message: `${path} names "${id}", which is no node.`,
			hint: unknownFlowchartIdHint(id, nodeIds(), "node"),
		});
	const edgeIndex = (source: string, target: string) =>
		state.edges.findIndex((edge) => edge.source === source && edge.target === target);
	const notes: string[] = [];
	/** A reference as the id it resolves to, by id, spelling or label; unchanged when none. */
	const resolveIn = (
		reference: string,
		path: string,
		declared: Iterable<readonly [string, string?]>,
	): string => {
		const found = resolveFlowchartReference(reference, declared);
		if (found === undefined || found.by === "id") return reference;
		notes.push(
			`${path}: resolved ${JSON.stringify(reference)} to ${found.by === "label" ? "the node labeled it, " : "declared id "}${JSON.stringify(found.id)}.`,
		);
		return found.id;
	};
	const nodeRef = (reference: string, path: string) =>
		resolveIn(
			reference,
			path,
			state.nodes.map(([id, node]) => [id, flowchartNodeDetails(node).label] as const),
		);
	const endRef = (end: FlowchartEdgeEnd, path: string): FlowchartEdgeEnd =>
		typeof end === "string"
			? nodeRef(end, path)
			: end.map((id, at) => nodeRef(id, `${path}[${at}]`));
	const edgeRef = <E extends readonly [FlowchartEdgeEnd, FlowchartEdgeEnd, ...unknown[]]>(
		edge: E,
		path: string,
	): E => {
		const [from, to, ...rest] = edge;
		return [endRef(from, `${path}[0]`), endRef(to, `${path}[1]`), ...rest] as unknown as E;
	};
	/** A change map keyed by the ids its keys resolve to. */
	/**
	 * A change map keyed by the ids its keys resolve to. Two keys that name one id (its id and its
	 * label) merge their fields; changes that disagree, or a removal beside a change, are refused.
	 */
	const resolvedKeys = <V>(
		changes: Readonly<Record<string, V>> | undefined,
		path: string,
		declared: () => Iterable<readonly [string, string?]>,
	): Record<string, V> | undefined => {
		if (changes === undefined) return undefined;
		const resolved = new Map<string, { key: string; value: V }>();
		for (const [key, value] of Object.entries(changes)) {
			const id = resolveIn(key, `${path}.${key}`, declared());
			const earlier = resolved.get(id);
			if (earlier === undefined) {
				resolved.set(id, { key, value });
				continue;
			}
			const merged = mergeChanges(earlier.value, value);
			if (merged === undefined) {
				issues.push({
					code: "invalid_edit",
					path: `${path}.${key}`,
					message: `${path}.${key} and ${path}.${earlier.key} both name "${id}" and disagree.`,
					hint: `Write one change for "${id}".`,
				});
				continue;
			}
			resolved.set(id, { key: earlier.key, value: merged as V });
		}
		return Object.fromEntries([...resolved].map(([id, { value }]) => [id, value]));
	};

	/** Drop a node, joining its one way in to its one way out. */
	const removeNode = (id: string) => {
		const tree = flowchartGroupTree(toDocument(state));
		const affected = new Set<string>();
		for (
			let group = tree.nodeGroup.get(id);
			group !== undefined && !affected.has(group);
			group = tree.groupParent.get(group)
		)
			affected.add(group);
		const into = state.edges.filter((edge) => edge.target === id);
		const out = state.edges.filter((edge) => edge.source === id);
		const [inEdge] = into;
		const [outEdge] = out;
		let joined: Edge | undefined;
		if (
			into.length === 1 &&
			out.length === 1 &&
			inEdge &&
			outEdge &&
			inEdge.source !== outEdge.target
		) {
			const label = inEdge.label ?? outEdge.label;
			const [source] = ends(inEdge);
			const [, target] = ends(outEdge);
			if (edgeIndex(source, target) < 0)
				joined = {
					source,
					target,
					...(label === undefined ? {} : { label }),
					branch: inEdge.label === undefined ? outEdge.branch : inEdge.branch,
				};
		}
		const at = state.edges.findIndex((edge) => edge === inEdge);
		state.edges = state.edges.filter((edge) => edge.source !== id && edge.target !== id);
		if (joined) state.edges.splice(Math.max(0, Math.min(at, state.edges.length)), 0, joined);
		state.nodes = state.nodes.filter(([key]) => key !== id);
		removeNodeFromGroups(state, id, affected);
	};

	edits.forEach((authored, index) => {
		const at = `edits[${index}]`;
		const before = issues.length;
		switch (authored.op) {
			case "insert": {
				const edit = authored;
				const entries = insertedNodeEntries(edit.node);
				const [entry] = entries;
				if (!entry || entries.length !== 1) {
					issues.push({
						code: "invalid_edit",
						path: `${at}.node`,
						message: `${at}.node must hold exactly one node; it holds ${entries.length}.`,
						hint: 'Insert one node per edit, as { op: "insert", node: { id: "Label" }, between: [from, to] }.',
					});
					return;
				}
				const [id, node] = entry;
				const from = nodeRef(edit.between[0], `${at}.between[0]`);
				const to = nodeRef(edit.between[1], `${at}.between[1]`);
				if (hasNode(id)) {
					issues.push({
						code: "invalid_edit",
						path: `${at}.node.${id}`,
						message: `${at} inserts "${id}", which is already a node.`,
						hint: "Give the new node an id of its own.",
					});
				}
				if (!hasNode(from)) unknownNode(from, `${at}.between[0]`);
				if (!hasNode(to)) unknownNode(to, `${at}.between[1]`);
				if (issues.length > before) return;
				const position = edgeIndex(from, to);
				if (position < 0) {
					issues.push({
						code: "unknown_edit_target",
						path: `${at}.between`,
						message: `${at} inserts between ${from} → ${to}, but no edge runs from "${from}" to "${to}".`,
						hint: 'Insert into an edge that exists, or add the node with "set" and wire it with "connect".',
					});
					return;
				}
				const old = state.edges[position];
				const label = old?.label;
				state.edges.splice(
					position,
					1,
					{
						source: from,
						target: id,
						...(label === undefined ? {} : { label }),
						branch: old?.branch ?? nextBranch++,
					},
					{ source: id, target: to, branch: nextBranch++ },
				);
				state.nodes = upsert(state.nodes, id, node, from);
				// The new node joins the lane of the step before it unless it names its own,
				// and the innermost group holding both ends.
				const lane = flowchartNodeDetails(
					state.nodes.find(([key]) => key === from)?.[1] ?? from,
				).lane;
				if (lane !== undefined && flowchartNodeDetails(node).lane === undefined) {
					state.nodes = upsert(state.nodes, id, mergeNode(node, { lane }));
				}
				// The innermost group around both ends, read from the derived tree.
				const tree = flowchartGroupTree(toDocument(state));
				const chain = (node: string) => {
					const groups: string[] = [];
					for (
						let group = tree.nodeGroup.get(node);
						group !== undefined && !groups.includes(group);
						group = tree.groupParent.get(group)
					)
						groups.push(group);
					return groups;
				};
				const around = chain(to);
				const shared = chain(from).find((group) => around.includes(group));
				const holder =
					shared === undefined ? undefined : state.groups.find(([key]) => key === shared);
				if (holder && flowchartNodeDetails(node).group === undefined) {
					if (holder[1].contains === undefined) {
						const current = state.nodes.find(([key]) => key === id)?.[1] ?? node;
						state.nodes = upsert(state.nodes, id, mergeNode(current, { group: holder[0] }));
					} else
						state.groups = upsert(state.groups, holder[0], {
							...holder[1],
							contains: [...holder[1].contains, id],
						});
				}
				return;
			}
			case "set": {
				const groupEntries = () => state.groups.map(([id, group]) => [id, group.label] as const);
				const edit = {
					...authored,
					...(authored.nodes === undefined
						? {}
						: {
								nodes: resolvedKeys(authored.nodes, `${at}.nodes`, () =>
									state.nodes.map(([id, node]) => [id, flowchartNodeDetails(node).label] as const),
								),
							}),
					...(authored.groups === undefined
						? {}
						: { groups: resolvedKeys(authored.groups, `${at}.groups`, groupEntries) }),
					...(authored.lanes === undefined
						? {}
						: {
								lanes: resolvedKeys(authored.lanes, `${at}.lanes`, () =>
									state.lanes.map(([id, lane]) => [id, lane] as const),
								),
							}),
				};
				const originalGroups = new Set(state.groups.map(([id]) => id));
				const removedGroups = new Set(
					Object.entries(edit.groups ?? {})
						.filter(([, value]) => value === null)
						.map(([id]) => id),
				);
				const previousParents =
					removedGroups.size === 0
						? new Map<string, string>()
						: flowchartGroupTree(toDocument(state)).groupParent;
				if (edit.title !== undefined) state.title = edit.title;
				if (edit.direction !== undefined) state.direction = edit.direction;
				if (edit.logos !== undefined) state.logos = edit.logos;
				for (const [id, change] of Object.entries(edit.nodes ?? {})) {
					const current = state.nodes.find(([key]) => key === id)?.[1];
					if (change === null) {
						if (current === undefined) unknownNode(id, `${at}.nodes.${id}`);
						else removeNode(id);
						continue;
					}
					if (current !== undefined) {
						state.nodes = upsert(state.nodes, id, mergeNode(current, change));
						continue;
					}
					const label = typeof change === "string" ? change : change.label;
					if (label === undefined) {
						issues.push({
							code: "invalid_edit",
							path: `${at}.nodes.${id}`,
							message: `${at} adds node "${id}" without a label.`,
							hint: `Give the new node its label, as { "${id}": "Label" }, or name an existing node id.`,
						});
						continue;
					}
					state.nodes = upsert(state.nodes, id, mergeNode(label, change));
				}
				// A node removal can already have pruned a group removed by this same set.
				const groupChanges = Object.fromEntries(
					Object.entries(edit.groups ?? {}).filter(
						([id, change]) =>
							change !== null ||
							!originalGroups.has(id) ||
							state.groups.some(([key]) => key === id),
					),
				);
				state.groups = setContainers(state.groups, groupChanges, "group", at, issues);
				state.nodes = state.nodes.map(([id, node]) => {
					let group = flowchartNodeDetails(node).group;
					if (group === undefined || !removedGroups.has(group)) return [id, node];
					const seen = new Set<string>();
					while (group !== undefined && removedGroups.has(group) && !seen.has(group)) {
						seen.add(group);
						group = previousParents.get(group);
					}
					return [id, mergeNode(node, { group: group ?? null })];
				});
				state.lanes = setLanes(state.lanes, edit.lanes, at, issues);
				return;
			}
			case "connect": {
				authored.edges.forEach((written, edgeIndexAt) => {
					const pairs = singlePairs(
						[edgeRef(written, `${at}.edges[${edgeIndexAt}]`)],
						nextBranch++,
					);
					// A connect joins the source's existing branch with this label, whether
					// extending it or moving a target out of a differently labeled fan-out.
					const labelKey = (label: string | undefined) => label?.trim().toLowerCase() ?? "";
					const existingBranches = new Map<string, Edge>();
					for (const pair of pairs) {
						const branch = state.edges.find(
							(edge) =>
								edge.source === pair.source && labelKey(edge.label) === labelKey(pair.label),
						);
						if (branch) existingBranches.set(pair.source, branch);
					}
					for (const pair of pairs) {
						const branch = existingBranches.get(pair.source);
						const edge = branch
							? {
									...pair,
									branch: branch.branch,
									...(branch.label === undefined ? {} : { label: branch.label }),
								}
							: pair;
						const [source, target] = ends(edge);
						let ok = true;
						for (const [id, side] of [
							[source, 0],
							[target, 1],
						] as const) {
							if (hasNode(id)) continue;
							ok = false;
							unknownNode(id, `${at}.edges[${edgeIndexAt}][${side}]`);
						}
						if (!ok) continue;
						const existing = edgeIndex(source, target);
						if (existing >= 0) state.edges[existing] = edge;
						else state.edges.push(edge);
					}
				});
				return;
			}
			case "disconnect": {
				authored.edges.forEach((written, edgeIndexAt) => {
					const [from, to] = edgeRef(written, `${at}.edges[${edgeIndexAt}]`);
					for (const source of flowchartEdgeEndIds(from)) {
						for (const target of flowchartEdgeEndIds(to)) {
							const existing = edgeIndex(source, target);
							if (existing < 0) {
								issues.push({
									code: "unknown_edit_target",
									path: `${at}.edges[${edgeIndexAt}]`,
									message: `${at} removes ${source} → ${target}, but no such edge exists.`,
									hint: `Edges from "${source}": ${
										state.edges
											.filter((edge) => edge.source === source)
											.map((edge) => `${source} → ${edge.target}`)
											.join(", ") || "none"
									}.`,
								});
								continue;
							}
							state.edges.splice(existing, 1);
						}
					}
				});
				return;
			}
		}
	});
	if (issues.length > 0) return { ok: false, issues };
	// Deduplicate pairs, then serialize their retained branch identities as list ends.
	const seen = new Set<string>();
	state.edges = state.edges.filter((edge) => {
		const key = pairKey(...ends(edge));
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return { ok: true, document: toDocument(state), notes };
}

/** Decode unknown input as an edit list, every schema problem at once. */
export const decodeFlowchartEdits = Schema.decodeUnknownResult(FlowchartEditsSchema, {
	errors: "all",
});
