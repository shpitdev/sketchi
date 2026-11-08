import { Schema } from "effect";

import { DIAGRAM_NODE_SHAPES, DIAGRAM_ZONE_KINDS } from "./intermediate.js";
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
	unknownFlowchartIdHint,
	type FlowchartDocument,
	type FlowchartDocumentEdge,
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
});

const GroupChangeSchema = Schema.Struct({
	label: Schema.optionalKey(Label),
	kind: Schema.optionalKey(Schema.NullOr(Schema.Literals(DIAGRAM_ZONE_KINDS))),
	/** Replaces what the group lists. */
	contains: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});

const LaneChangeSchema = Schema.Struct({
	label: Schema.optionalKey(Label),
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
	lanes: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(LaneChangeSchema))),
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
	| { readonly ok: true; readonly document: FlowchartDocument }
	| { readonly ok: false; readonly issues: readonly FlowchartEditIssue[] };

type Edge = FlowchartDocumentEdge;
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

/** The edges as single pairs, each authored list end split, in the written order. */
function singlePairs(edges: readonly Edge[]): Edge[] {
	return edges.flatMap(([from, to, label]) =>
		flowchartEdgeEndIds(from).flatMap((source) =>
			flowchartEdgeEndIds(to).map((target): Edge =>
				label === undefined ? [source, target] : [source, target, label],
			),
		),
	);
}

const ends = (edge: Edge) => [edge[0] as string, edge[1] as string] as const;

/** Replace or add an entry in an ordered map, a new one after `after` when given. */
function upsert<V>(entries: [string, V][], id: string, value: V, after?: string): [string, V][] {
	const index = entries.findIndex(([key]) => key === id);
	if (index >= 0) return entries.map((entry, at) => (at === index ? [id, value] : entry));
	const position = after === undefined ? -1 : entries.findIndex(([key]) => key === after);
	if (position < 0) return [...entries, [id, value]];
	return [...entries.slice(0, position + 1), [id, value], ...entries.slice(position + 1)];
}

/**
 * Containers without the given ids. A container left empty goes too, and comes out of
 * the containers that listed it, up through every ancestor it empties in turn.
 */
function unlist<C extends { readonly contains: readonly string[] }>(
	entries: [string, C][],
	ids: readonly string[],
): [string, C][] {
	let result = entries;
	let removing = new Set(ids);
	while (removing.size > 0) {
		const emptied = new Set<string>();
		result = result.flatMap(([key, container]): [string, C][] => {
			const contains = container.contains.filter((member) => !removing.has(member));
			if (contains.length === container.contains.length) return [[key, container]];
			if (contains.length === 0) {
				emptied.add(key);
				return [];
			}
			return [[key, { ...container, contains }]];
		});
		removing = emptied;
	}
	return result;
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
function setContainers<C extends { readonly label: string; readonly contains: readonly string[] }>(
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
					if (!container.contains.includes(id)) return [key, container];
					const contains = [
						...new Set(
							container.contains.flatMap((member) => (member === id ? current.contains : [member])),
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
		if (typeof label !== "string" || !Array.isArray(contains) || contains.length === 0) {
			issues.push({
				code: "invalid_edit",
				path,
				message:
					current === undefined
						? `${at} adds ${collection} "${id}" without a label and what it contains.`
						: `${at} leaves ${collection} "${id}" containing nothing.`,
				hint:
					current === undefined
						? `Give the new ${collection} { label, contains: [ids] }.`
						: `Remove the ${collection} with null instead.`,
			});
			continue;
		}
		result = upsert(result, id, merged as unknown as C);
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
		edges: state.edges,
		...(groups ? { groups } : {}),
		...(lanes ? { lanes } : {}),
	};
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
		state.edges.findIndex((edge) => edge[0] === source && edge[1] === target);

	/** Drop a node, joining its one way in to its one way out. */
	const removeNode = (id: string) => {
		const into = state.edges.filter((edge) => edge[1] === id);
		const out = state.edges.filter((edge) => edge[0] === id);
		const [inEdge] = into;
		const [outEdge] = out;
		let joined: Edge | undefined;
		if (into.length === 1 && out.length === 1 && inEdge && outEdge && inEdge[0] !== outEdge[1]) {
			const label = inEdge[2] ?? outEdge[2];
			const [source] = ends(inEdge);
			const [, target] = ends(outEdge);
			if (edgeIndex(source, target) < 0)
				joined = label === undefined ? [source, target] : [source, target, label];
		}
		const at = state.edges.findIndex((edge) => edge === inEdge);
		state.edges = state.edges.filter((edge) => edge[0] !== id && edge[1] !== id);
		if (joined) state.edges.splice(Math.max(0, Math.min(at, state.edges.length)), 0, joined);
		state.nodes = state.nodes.filter(([key]) => key !== id);
		state.lanes = unlist(state.lanes, [id]);
		state.groups = unlist(state.groups, [id]);
	};

	edits.forEach((edit, index) => {
		const at = `edits[${index}]`;
		const before = issues.length;
		switch (edit.op) {
			case "insert": {
				const entries = Object.entries(edit.node);
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
				const [from, to] = edit.between;
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
				const label = old?.[2];
				state.edges.splice(position, 1, label === undefined ? [from, id] : [from, id, label], [
					id,
					to,
				]);
				state.nodes = upsert(state.nodes, id, node, from);
				// The new node joins the lane of the step before it, and the innermost
				// group holding both ends.
				const lane = state.lanes.find(([, container]) => container.contains.includes(from));
				if (lane) {
					state.lanes = upsert(state.lanes, lane[0], {
						...lane[1],
						contains: [...lane[1].contains, id],
					});
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
				if (holder) {
					state.groups = upsert(state.groups, holder[0], {
						...holder[1],
						contains: [...holder[1].contains, id],
					});
				}
				return;
			}
			case "set": {
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
				state.groups = setContainers(state.groups, edit.groups, "group", at, issues);
				state.lanes = setContainers(state.lanes, edit.lanes, "lane", at, issues);
				return;
			}
			case "connect": {
				edit.edges.forEach((authored, edgeIndexAt) => {
					for (const edge of singlePairs([authored])) {
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
				edit.edges.forEach(([from, to], edgeIndexAt) => {
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
											.filter((edge) => edge[0] === source)
											.map((edge) => `${source} → ${String(edge[1])}`)
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
	// Edges that the document wrote with list ends stay split once edited; the pairs
	// keep their written order.
	const seen = new Set<string>();
	state.edges = state.edges.filter((edge) => {
		const key = pairKey(...ends(edge));
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return { ok: true, document: toDocument(state) };
}

/** Decode unknown input as an edit list, every schema problem at once. */
export const decodeFlowchartEdits = Schema.decodeUnknownResult(FlowchartEditsSchema, {
	errors: "all",
});
