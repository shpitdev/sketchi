import type { FlowchartNodeKind } from "@sketchi/diagram-core";

import { cleanToolString } from "../clean-tool-string.js";

export const FLOWCHART_NODE_KIND_HINT =
	'Set kind to "start" (the single entry), "process" (a step), "decision" (a node whose outgoing edges carry branch labels) or "end" (an outcome).';

const KIND_SYNONYMS: Readonly<Record<string, FlowchartNodeKind>> = {
	start: "start",
	begin: "start",
	entry: "start",
	process: "process",
	task: "process",
	action: "process",
	step: "process",
	activity: "process",
	operation: "process",
	decision: "decision",
	condition: "decision",
	question: "decision",
	choice: "decision",
	gateway: "decision",
	end: "end",
	stop: "end",
	finish: "end",
	exit: "end",
	final: "end",
};
/** Kinds that name a start or an end without saying which: the node's position decides. */
const TERMINAL_KINDS = new Set(["terminal", "terminator", "terminus"]);

interface Degree {
	incoming: number;
	outgoing: number;
	labeledOutgoing: number;
}

/** The parts of a not-yet-decoded request that kind resolution reads. */
interface LooseNode {
	readonly id?: unknown;
	readonly label?: unknown;
	readonly kind?: unknown;
	readonly type?: unknown;
}
interface LooseEdge {
	readonly source?: unknown;
	readonly target?: unknown;
	readonly from?: unknown;
	readonly to?: unknown;
	readonly label?: unknown;
}
interface LooseRequest {
	readonly spec?: { readonly nodes?: unknown; readonly edges?: unknown };
}

const isRecord = (value: unknown): value is Record<string, unknown> & LooseNode & LooseEdge =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const looseKey = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "");

/**
 * Resolves the node kinds models commonly misspell before the request is decoded, so a recoverable
 * spec builds first try. Synonyms map to their kind ("task" → process, "condition" → decision), a
 * `type` key stands in for a missing `kind`, and "terminal" becomes start or end by position. An
 * omitted kind is filled only where the graph decides it: the only node without incoming edges is
 * the start, a node without outgoing edges is an end, and a node with one unlabeled outgoing edge
 * whose label is not a question is a process. Anything else, such as a node with labeled or
 * several outgoing edges, keeps its value so validation asks the caller instead of turning a
 * would-be decision into a step. With another connected end, a non-question process leaf reached
 * by a labeled decision branch is also an end. Ordinary process chains still need their next edge.
 * Edges written { from, to } read as { source, target }.
 */
export function resolveFlowchartNodeKinds(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const { spec } = input as LooseRequest;
	if (!isRecord(spec) || !Array.isArray(spec.nodes)) return input;
	const nodes: unknown[] = spec.nodes;
	let changed = false;
	const authoredEdges: unknown[] | undefined = Array.isArray(spec.edges) ? spec.edges : undefined;
	const resolvedEdges = authoredEdges?.map((edge) => {
		if (!isRecord(edge) || (edge.source !== undefined && edge.target !== undefined)) return edge;
		if (edge.from === undefined && edge.to === undefined) return edge;
		changed = true;
		const { from, to, ...rest } = edge;
		return { ...rest, source: edge.source ?? from, target: edge.target ?? to };
	});
	const edges = (resolvedEdges ?? []).filter(isRecord);
	const degree = new Map<unknown, Degree>();
	const of = (id: unknown) => {
		let entry = degree.get(id);
		if (!entry) degree.set(id, (entry = { incoming: 0, outgoing: 0, labeledOutgoing: 0 }));
		return entry;
	};
	for (const edge of edges) {
		const source = of(edge.source);
		source.outgoing += 1;
		if (typeof edge.label === "string" && edge.label.trim() !== "") source.labeledOutgoing += 1;
		of(edge.target).incoming += 1;
	}
	const entries = nodes.filter(isRecord).filter((node) => of(node.id).incoming === 0);
	const resolve = (node: LooseNode): unknown => {
		const authored = node.kind ?? node.type;
		const { incoming, outgoing, labeledOutgoing } = of(node.id);
		// Judge the label the build will draw, so a trailing tool-output fragment cannot hide a "?".
		const question = typeof node.label === "string" && cleanToolString(node.label).endsWith("?");
		if (typeof authored === "string") {
			const key = looseKey(authored);
			const kind = KIND_SYNONYMS[key];
			if (kind) return kind;
			if (TERMINAL_KINDS.has(key)) {
				if (incoming === 0 && outgoing > 0) return "start";
				if (outgoing === 0 && incoming > 0) return "end";
			}
			return node.kind;
		}
		if (authored !== undefined) return node.kind;
		if (outgoing === 0 && incoming > 0) return "end";
		if (incoming === 0 && entries.length === 1 && labeledOutgoing === 0) return "start";
		if (incoming > 0 && outgoing === 1 && labeledOutgoing === 0 && !question) return "process";
		return undefined;
	};

	// Resolve existing ends first, including synonyms, type keys and terminals by position. A leaf
	// converted below cannot establish termination for another leaf, nor can an unconnected end.
	const kinds = nodes.map((node) => (isRecord(node) ? resolve(node) : undefined));
	const hasConnectedEnd = nodes.some(
		(node, index) =>
			isRecord(node) &&
			kinds[index] === "end" &&
			of(node.id).incoming > 0 &&
			of(node.id).outgoing === 0,
	);
	const decisions = new Set(
		nodes.flatMap((node, index) =>
			isRecord(node) && kinds[index] === "decision" ? [node.id] : [],
		),
	);
	const branchOutcomes = new Set(
		edges
			.filter(
				(edge) =>
					decisions.has(edge.source) && typeof edge.label === "string" && edge.label.trim() !== "",
			)
			.map((edge) => edge.target),
	);

	const resolved = nodes.map((node, index) => {
		if (!isRecord(node)) return node;
		let kind = kinds[index];
		const question = typeof node.label === "string" && cleanToolString(node.label).endsWith("?");
		if (
			kind === "process" &&
			hasConnectedEnd &&
			branchOutcomes.has(node.id) &&
			of(node.id).outgoing === 0 &&
			!question
		) {
			kind = "end";
		}
		if (kind === node.kind) return node;
		changed = true;
		const { type: _type, ...rest } = node;
		return { ...rest, kind };
	});
	return changed
		? {
				...input,
				spec: { ...spec, nodes: resolved, ...(resolvedEdges ? { edges: resolvedEdges } : {}) },
			}
		: input;
}
