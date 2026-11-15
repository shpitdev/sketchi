/** Owns native graph adjacency, feedback and selected rank orders, including nested group levels. */
import { measureEdges } from "./measure.js";
import { type LayoutEdge } from "./layout-types.js";
import { Graph, Option } from "effect";
import type {
	DiagramEdge,
	DiagramGroup,
	DiagramNode,
	IntermediateDiagram,
} from "./intermediate.js";

/** Native adjacency plus the declared nodes whose labels and kinds are measured.
 * Composite group endpoints may be graph vertices without being placed nodes. */
export interface FlowGraph {
	readonly nodes: readonly DiagramNode[];
	readonly graph: Graph.DirectedGraph<string, LayoutEdge>;
	readonly indices: ReadonlyMap<string, Graph.NodeIndex>;
}
export function flowGraph(nodes: readonly DiagramNode[], edges: readonly LayoutEdge[]): FlowGraph {
	const indices = new Map<string, Graph.NodeIndex>();
	const graph = Graph.directed<string, LayoutEdge>((mutable) => {
		const index = (id: string) => {
			const existing = indices.get(id);
			if (existing !== undefined) return existing;
			const added = Graph.addNode(mutable, id);
			indices.set(id, added);
			return added;
		};
		for (const node of nodes) index(node.id);
		for (const edge of edges) Graph.addEdge(mutable, index(edge.source), index(edge.target), edge);
	});
	return { nodes, graph, indices };
}
export const flowEdges = (flow: FlowGraph): LayoutEdge[] =>
	[...Graph.values(Graph.edges(flow.graph))].map((edge) => edge.data);
export function incomingEdges(flow: FlowGraph, id: string): LayoutEdge[] {
	const index = flow.indices.get(id);
	return index === undefined
		? []
		: Graph.incomingEdges(flow.graph, index).map(
				(edge) => Option.getOrThrow(Graph.getEdge(flow.graph, edge)).data,
			);
}
export function outgoingEdges(flow: FlowGraph, id: string): LayoutEdge[] {
	const index = flow.indices.get(id);
	return index === undefined
		? []
		: Graph.outgoingEdges(flow.graph, index).map(
				(edge) => Option.getOrThrow(Graph.getEdge(flow.graph, edge)).data,
			);
}

/** DFS needs enter/exit states to classify back edges. Graph.dfs exposes only
 * visited vertices, so the narrow walk uses native ordered adjacency directly. */
function feedbackEdgeIds(flow: FlowGraph): Set<string> {
	const states = new Map<string, "visiting" | "visited">();
	const feedback = new Set<string>();
	const visit = (id: string): void => {
		states.set(id, "visiting");
		for (const edge of outgoingEdges(flow, id)) {
			const state = states.get(edge.target);
			if (state === "visiting") feedback.add(edge.id);
			else if (state === undefined) visit(edge.target);
		}
		states.set(id, "visited");
	};
	const start =
		flow.nodes.find((node) => incomingEdges(flow, node.id).length === 0) ?? flow.nodes[0];
	if (start) visit(start.id);
	for (const node of flow.nodes) if (!states.has(node.id)) visit(node.id);
	return feedback;
}

/** Longest-path ranks do not depend on the order among ready vertices. Keep
 * declaration order separately for barycentric ties; use native topo here. */
function rankNodes(flow: FlowGraph, feedback: ReadonlySet<string>): Map<string, number> {
	const forward = Graph.mutate(flow.graph, (mutable) => {
		Graph.removeEdges(
			mutable,
			[...Graph.entries(Graph.edges(mutable))]
				.filter(([, edge]) => feedback.has(edge.data.id))
				.map(([index]) => index),
		);
	});
	const ranks = new Map(flow.nodes.map((node) => [node.id, 0]));
	for (const [index, id] of Graph.entries(Graph.topo(forward))) {
		for (const edgeIndex of Graph.outgoingEdges(forward, index)) {
			const edge = Option.getOrThrow(Graph.getEdge(forward, edgeIndex)).data;
			ranks.set(edge.target, Math.max(ranks.get(edge.target) ?? 0, (ranks.get(id) ?? 0) + 1));
		}
	}
	return ranks;
}

export function nodeOrderMap(nodes: readonly DiagramNode[]): Map<string, number> {
	return new Map(nodes.map((node, index) => [node.id, index]));
}
export const RANK_SWEEP_COUNT = 4;
const CROSSING_SWEEPS = 8;
const SIFT_PASSES = 4;
const SIFT_MAX_PLACEHOLDERS = 80;

/** Ranks lifted so each level pair's later member ranks no earlier than the first. */
function liftRanks(
	flow: FlowGraph,
	ranks: Map<string, number>,
	feedback: ReadonlySet<string>,
	pairs: readonly (readonly [string, string])[],
	after: readonly (readonly [string, string])[],
): Map<string, number> {
	if (pairs.length === 0 && after.length === 0) return ranks;
	for (let changed = true, round = 0; changed && round <= flow.nodes.length; round += 1) {
		changed = false;
		for (const [before, after] of pairs)
			if (ranks.get(after)! < ranks.get(before)!) {
				ranks.set(after, ranks.get(before)!);
				changed = true;
			}
		for (const [before, later] of after)
			if (ranks.get(later)! < ranks.get(before)! + 1) {
				ranks.set(later, ranks.get(before)! + 1);
				changed = true;
			}
		for (const edge of flowEdges(flow))
			if (
				!feedback.has(edge.id) &&
				edge.source !== edge.target &&
				ranks.get(edge.target)! < ranks.get(edge.source)! + 1
			) {
				ranks.set(edge.target, ranks.get(edge.source)! + 1);
				changed = true;
			}
	}
	return ranks;
}

function orderedRanks(
	flow: FlowGraph,
	rankByNodeId: ReadonlyMap<string, number>,
	feedbackEdges: ReadonlySet<string>,
): Map<number, string[]> {
	const nodeOrder = nodeOrderMap(flow.nodes);
	const rankedNodes = new Map<number, string[]>();

	for (const node of flow.nodes) {
		const rank = rankByNodeId.get(node.id) ?? 0;
		rankedNodes.set(rank, [...(rankedNodes.get(rank) ?? []), node.id]);
	}

	for (let sweep = 0; sweep < RANK_SWEEP_COUNT; sweep += 1) {
		const ranks = Array.from(rankedNodes.keys()).sort((left, right) => left - right);

		for (const rank of ranks) {
			const ids = rankedNodes.get(rank);
			if (!ids || ids.length < 2) {
				continue;
			}

			const previousOrder = new Map<string, number>();
			const previousRankNodes = rankedNodes.get(rank - 1) ?? [];
			previousRankNodes.forEach((id, index) => {
				previousOrder.set(id, index);
			});

			const nextOrder = new Map<string, number>();
			const nextRankNodes = rankedNodes.get(rank + 1) ?? [];
			nextRankNodes.forEach((id, index) => {
				nextOrder.set(id, index);
			});

			const scoreForNode = (id: string): number => {
				const neighborScores = [
					...incomingEdges(flow, id)
						.filter((edge) => !feedbackEdges.has(edge.id))
						.map((edge) => previousOrder.get(edge.source))
						.filter((score): score is number => score !== undefined),
					...outgoingEdges(flow, id)
						.filter((edge) => !feedbackEdges.has(edge.id))
						.map((edge) => nextOrder.get(edge.target))
						.filter((score): score is number => score !== undefined),
				];

				if (neighborScores.length === 0) {
					return nodeOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
				}

				return neighborScores.reduce((sum, score) => sum + score, 0) / neighborScores.length;
			};

			rankedNodes.set(
				rank,
				[...ids].sort((left, right) => {
					const scoreDelta = scoreForNode(left) - scoreForNode(right);

					if (Math.abs(scoreDelta) > 0.001) {
						return scoreDelta;
					}

					return (
						(nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
						(nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
					);
				}),
			);
		}
	}

	return rankedNodes;
}

/**
 * A layered order: each rank's nodes in order, and, with them, a placeholder
 * for each line that passes the rank on its way to a later one (`full`), with
 * the links between consecutive ranks that carry each line, keyed by the
 * upper rank.
 */
export interface LayeredOrder {
	/** Crossings between consecutive ranks, a skipping line's at every rank it passes. */
	readonly crossings: number;
	readonly real: ReadonlyMap<number, readonly string[]>;
	readonly full: ReadonlyMap<number, readonly string[]>;
	readonly links: ReadonlyMap<number, readonly (readonly [string, string])[]>;
	readonly virtual: ReadonlySet<string>;
}

function reducedRankOrder(
	order: Map<number, string[]>,
	flow: FlowGraph,
	rankByNodeId: ReadonlyMap<string, number>,
	feedbackEdges: ReadonlySet<string>,
	thorough = false,
): LayeredOrder {
	// Links between consecutive ranks, keyed by the upper rank. Virtual nodes carry
	// skipping edges through the ranks between their ends.
	const links = new Map<number, (readonly [string, string])[]>();
	const virtual = new Set<string>();
	const link = (upper: string, lower: string, rank: number) =>
		links.set(rank, [...(links.get(rank) ?? []), [upper, lower]]);
	for (const edge of flowEdges(flow)) {
		const [from, to] = feedbackEdges.has(edge.id)
			? [edge.target, edge.source]
			: [edge.source, edge.target];
		const [upper, lower] =
			(rankByNodeId.get(from) ?? 0) <= (rankByNodeId.get(to) ?? 0) ? [from, to] : [to, from];
		const top = rankByNodeId.get(upper) ?? 0;
		const bottom = rankByNodeId.get(lower) ?? 0;
		if (top === bottom) continue;
		let previous = upper;
		for (let rank = top + 1; rank < bottom; rank += 1) {
			// A virtual node starts under its upper neighbor's relative position.
			const id = `\u0000${edge.id}\u0000${rank}`;
			virtual.add(id);
			const above = order.get(rank - 1)!;
			const ids = order.get(rank)!;
			ids.splice(Math.round(((above.indexOf(previous) + 0.5) / above.length) * ids.length), 0, id);
			link(previous, id, rank - 1);
			previous = id;
		}
		link(previous, lower, bottom - 1);
	}
	const position = new Map<string, number>();
	const place = (rank: number) => order.get(rank)?.forEach((id, index) => position.set(id, index));
	const ranks = [...order.keys()].sort((a, b) => a - b);
	ranks.forEach(place);
	const between = (rank: number) => {
		const pairs = links.get(rank) ?? [];
		let crossings = 0;
		for (const [index, [upper, lower]] of pairs.entries())
			for (const [otherUpper, otherLower] of pairs.slice(index + 1))
				if (
					(position.get(upper)! - position.get(otherUpper)!) *
						(position.get(lower)! - position.get(otherLower)!) <
					0
				)
					crossings += 1;
		return crossings;
	};
	const total = () => ranks.reduce((sum, rank) => sum + between(rank), 0);
	const initial = total();
	const real = () =>
		new Map([...order].map(([rank, ids]) => [rank, ids.filter((id) => !virtual.has(id))]));
	const full = () => new Map([...order].map(([rank, ids]) => [rank, [...ids]]));
	const plain = real();
	if (initial === 0) return { crossings: 0, real: plain, full: full(), links, virtual };

	const neighbors = new Map<string, { above: string[]; below: string[] }>();
	for (const pairs of links.values())
		for (const [upper, lower] of pairs) {
			const up = neighbors.get(upper) ?? { above: [], below: [] };
			up.below.push(lower);
			neighbors.set(upper, up);
			const down = neighbors.get(lower) ?? { above: [], below: [] };
			down.above.push(upper);
			neighbors.set(lower, down);
		}
	let best = { crossings: initial, order: plain, full: full() };
	for (let sweep = 0; sweep < CROSSING_SWEEPS && best.crossings > 0; sweep += 1) {
		const downward = sweep % 2 === 0;
		for (const rank of downward ? ranks.slice(1) : ranks.slice(0, -1).reverse()) {
			const ids = order.get(rank)!;
			const key = new Map(
				ids.map((id, index) => {
					const around = (downward ? neighbors.get(id)?.above : neighbors.get(id)?.below) ?? [];
					return [
						id,
						around.length > 0
							? around.reduce((sum, other) => sum + position.get(other)!, 0) / around.length
							: index,
					];
				}),
			);
			ids.sort((a, b) => key.get(a)! - key.get(b)!);
			place(rank);
		}
		// Swap neighbors in a rank while that removes crossings with the ranks beside it.
		for (let improved = true; improved;) {
			improved = false;
			for (const rank of ranks) {
				const ids = order.get(rank)!;
				for (let index = 0; index + 1 < ids.length; index += 1) {
					const before = between(rank - 1) + between(rank);
					[ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
					place(rank);
					if (between(rank - 1) + between(rank) < before) improved = true;
					else {
						[ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
						place(rank);
					}
				}
			}
		}
		const crossings = total();
		if (crossings < best.crossings) best = { crossings, order: real(), full: full() };
	}
	if (thorough && best.crossings > 0) {
		// Sifting: each node or placeholder moves to the place in its rank that
		// crosses fewest lines with the ranks beside it; then each skipping line
		// moves whole to either end of every rank it passes, kept where, sifted
		// again, the ranks cross fewer lines in all.
		const restore = (from: ReadonlyMap<number, readonly string[]>) => {
			for (const [rank, ids] of from) order.set(rank, [...ids]);
			ranks.forEach(place);
		};
		restore(best.full);
		const rankOf = new Map<string, number>();
		for (const [rank, ids] of order) for (const id of ids) rankOf.set(id, rank);
		const near = (rank: number) => between(rank - 1) + between(rank);
		const sift = (within: readonly number[]) => {
			let moved = false;
			for (const rank of within) {
				const ids = order.get(rank)!;
				for (const id of [...ids]) {
					const from = ids.indexOf(id);
					let [at, fewest] = [from, near(rank)];
					ids.splice(from, 1);
					for (let to = 0; to <= ids.length; to += 1) {
						if (to === from) continue;
						ids.splice(to, 0, id);
						place(rank);
						const crossings = near(rank);
						if (crossings < fewest) [at, fewest] = [to, crossings];
						ids.splice(to, 1);
					}
					ids.splice(at, 0, id);
					place(rank);
					if (at !== from) moved = true;
				}
			}
			return moved;
		};
		for (let pass = 0; pass < SIFT_PASSES && sift(ranks); pass += 1);
		let crossings = total();
		if (crossings < best.crossings) best = { crossings, order: real(), full: full() };
		const chains = new Map<string, string[]>();
		for (const id of virtual) {
			const edgeId = id.split("\u0000")[1]!;
			chains.set(edgeId, [...(chains.get(edgeId) ?? []), id]);
		}
		if (virtual.size <= SIFT_MAX_PLACEHOLDERS)
			for (const ids of chains.values())
				for (const end of ["low", "high"] as const) {
					if (best.crossings === 0) break;
					restore(best.full);
					for (const id of ids) {
						const row = order.get(rankOf.get(id)!)!;
						row.splice(row.indexOf(id), 1);
						if (end === "low") row.unshift(id);
						else row.push(id);
					}
					ranks.forEach(place);
					const within = [...new Set(ids.map((id) => rankOf.get(id)!))].flatMap((rank) => [
						rank - 1,
						rank,
						rank + 1,
					]);
					const passed = ranks.filter((rank) => within.includes(rank));
					for (let pass = 0; pass < SIFT_PASSES && sift(passed); pass += 1);
					crossings = total();
					if (crossings < best.crossings) best = { crossings, order: real(), full: full() };
				}
	}
	return { crossings: best.crossings, real: best.order, full: best.full, links, virtual };
}

/** Size-independent results, shared by every arrangement and polish pass. */
export interface RankOrder {
	readonly ranks: ReadonlyMap<string, number>;
	readonly plain: ReadonlyMap<number, readonly string[]>;
	readonly reduced?: LayeredOrder;
	readonly sifted?: LayeredOrder;
}
export interface RankedFlow extends FlowGraph {
	readonly feedback: ReadonlySet<string>;
	readonly order: RankOrder;
	readonly through?: { readonly order: RankOrder; readonly entries: ReadonlySet<string> };
}
function orderRanks(
	flow: FlowGraph,
	ranks: ReadonlyMap<string, number>,
	feedback: ReadonlySet<string>,
): RankOrder {
	return { ranks, plain: orderedRanks(flow, ranks, feedback) };
}
function rankedFlow(
	flow: FlowGraph,
	feedback: ReadonlySet<string>,
	pairs: readonly (readonly [string, string])[] = [],
): RankedFlow {
	const ranks = liftRanks(flow, rankNodes(flow, feedback), feedback, pairs, []);
	return { ...flow, feedback, order: orderRanks(flow, ranks, feedback) };
}
function reduceOrder(flow: RankedFlow, order: RankOrder, thorough: boolean): RankOrder {
	const reduced = reducedRankOrder(
		new Map([...order.plain].map(([rank, ids]) => [rank, [...ids]])),
		flow,
		order.ranks,
		flow.feedback,
		thorough,
	);
	return thorough ? { ...order, sifted: reduced } : { ...order, reduced };
}
/** The crossing-repair branch requests this once; its plain and reduced orders
 * are then reused by all candidate placements, directions and polish levels. */
export function withReducedRanks(layout: GraphLayout): GraphLayout {
	const reduce = (flow: RankedFlow): RankedFlow => ({
		...flow,
		order: reduceOrder(flow, flow.order, false),
	});
	return {
		...layout,
		...(layout.ranks ? { ranks: reduce(layout.ranks) } : {}),
		...(layout.groups
			? {
					groups: {
						...layout.groups,
						top: reduce(layout.groups.top),
						groups: layout.groups.groups.map((level) => ({ ...level, flow: reduce(level.flow) })),
					},
				}
			: {}),
	};
}
/** Only an ungrouped crossing rival needs the skipping-line search. */
export function withSiftedRanks(layout: GraphLayout): GraphLayout {
	return layout.ranks
		? {
				...layout,
				ranks: { ...layout.ranks, order: reduceOrder(layout.ranks, layout.ranks.order, true) },
			}
		: layout;
}
/** The zoned rival alone asks which paths through blocks lift another rank.
 * Constraints become ranks immediately; no precedence protocol is retained. */
export function withThroughRanks(layout: GraphLayout, reorder: boolean): GraphLayout {
	const structure = layout.groups;
	if (!structure?.zoned) return layout;
	const unitOf = (id: string): string => {
		let group = structure.composites.has(id) ? id : structure.groupOf.get(id);
		if (group === undefined) return id;
		for (
			let parent = structure.parentOf.get(group);
			parent !== undefined;
			parent = structure.parentOf.get(group)
		)
			group = parent;
		return groupUnitId(group);
	};
	const entries = new Set<string>();
	const top = structure.top;
	const pairs = throughBlockPairs(layout.flow, top, top.feedback, unitOf, entries);
	if (pairs.length === 0) return layout;
	const ranks = liftRanks(top, new Map(top.order.ranks), top.feedback, [], pairs);
	const plain = orderRanks(top, ranks, top.feedback);
	const order = reorder ? reduceOrder(top, plain, false) : plain;
	return { ...layout, groups: { ...structure, top: { ...top, through: { order, entries } } } };
}
export function rankOrder(flow: RankedFlow, through = false): RankOrder {
	return (through ? flow.through?.order : undefined) ?? flow.order;
}
export const GROUP_UNIT_PREFIX = "\u0000group:";
export function groupUnitId(groupId: string): string {
	return `${GROUP_UNIT_PREFIX}${groupId}`;
}
export interface GroupLevel {
	readonly children: readonly string[];
	readonly crossing: ReadonlySet<string>;
	readonly flow: RankedFlow;
	readonly group: DiagramGroup;
}
export interface GroupStructure {
	readonly composites: ReadonlySet<string>;
	readonly crossEdges: readonly LayoutEdge[];
	readonly groupOf: ReadonlyMap<string, string>;
	readonly groups: readonly GroupLevel[];
	readonly parentOf: ReadonlyMap<string, string>;
	readonly top: RankedFlow;
	readonly zoned: boolean;
}
export interface GraphLayout {
	readonly flow: FlowGraph;
	readonly ranks?: RankedFlow;
	readonly feedback: ReadonlySet<string>;
	readonly groups?: GroupStructure;
}
export function prepareGraph(diagram: IntermediateDiagram, place: boolean): GraphLayout {
	const flow = flowGraph(diagram.nodes, measureEdges(diagram.nodes, diagram.edges));
	const global = feedbackEdgeIds(flow);
	const groups = groupStructure(diagram, flow, global);
	return {
		flow,
		feedback: groups?.feedback ?? global,
		...(groups
			? { groups: groups.structure }
			: place && (diagram.lanes ?? []).length === 0
				? { ranks: rankedFlow(flow, global) }
				: {}),
	};
}

/** The nested layouts of a diagram whose declared groups hold nodes; undefined otherwise. */
function groupStructure(
	diagram: IntermediateDiagram,
	whole: FlowGraph,
	global: ReadonlySet<string>,
): { readonly structure: GroupStructure; readonly feedback: ReadonlySet<string> } | undefined {
	const sourceEdges = flowEdges(whole);
	const declaredParent = new Map(
		(diagram.groups ?? []).flatMap((group) =>
			group.parent === undefined ? [] : [[group.id, group.parent] as const],
		),
	);
	// A group holds nodes itself or through the groups nested in it.
	const holding = new Set<string>();
	for (const node of diagram.nodes)
		for (let id = node.group; id !== undefined && !holding.has(id); id = declaredParent.get(id))
			holding.add(id);
	const groups = (diagram.groups ?? []).filter((group) => holding.has(group.id));
	if (groups.length === 0) {
		return undefined;
	}
	const declared = new Set(groups.map((group) => group.id));
	const parentOf = new Map(
		[...declaredParent].filter(([id, parent]) => declared.has(id) && declared.has(parent)),
	);
	const zoned = groups.some((group) => group.parent !== undefined || group.kind !== undefined);
	const groupOf = new Map(
		diagram.nodes.flatMap((node) =>
			node.group !== undefined && declared.has(node.group) ? [[node.id, node.group] as const] : [],
		),
	);
	const nodeIds = new Set(diagram.nodes.map((node) => node.id));
	const composites = new Set(
		sourceEdges.flatMap((edge) =>
			[edge.source, edge.target].filter((id) => !nodeIds.has(id) && declared.has(id)),
		),
	);
	// The groups around a node or composite, innermost first.
	const chainOf = (id: string) => {
		const chain: string[] = [];
		for (
			let group = composites.has(id) ? id : groupOf.get(id);
			group !== undefined;
			group = parentOf.get(group)
		)
			chain.push(group);
		return chain;
	};
	// What a node is at a level (a group's, or the top level's when undefined):
	// itself when it is a direct member, else the block of the nested group that
	// holds it; undefined when the level does not hold it. A composite is a block
	// around its group's level, never inside it.
	const unitAt = (level: string | undefined, id: string) => {
		const chain = chainOf(id);
		const index = level === undefined ? chain.length : chain.indexOf(level);
		if (index < 0 || (index === 0 && composites.has(id))) return undefined;
		return index === 0 ? id : groupUnitId(chain[index - 1]!);
	};
	const unitNode = (group: DiagramGroup, unit: string): DiagramNode => ({
		id: unit,
		label: group.label,
		kind: "process",
		metadata: {},
	});
	// Inside a group, loops break where the whole flow breaks them, so a group
	// reads in the same direction as the diagram around it.
	// A self-loop runs against the flow wherever it is.
	const feedback = new Set(
		sourceEdges.flatMap((edge) => (edge.source === edge.target ? [edge.id] : [])),
	);
	const nested = groups.map((group): GroupLevel => {
		const children = groups.filter((child) => parentOf.get(child.id) === group.id);
		const edges = sourceEdges.flatMap((edge) => {
			const [source, target] = [unitAt(group.id, edge.source), unitAt(group.id, edge.target)];
			if (source === undefined || target === undefined) return [];
			// An edge inside one nested group belongs to that group's level.
			if (source === target && source !== edge.source) return [];
			return [
				source === edge.source && target === edge.target ? edge : { ...edge, source, target },
			];
		});
		const units: DiagramNode[] = [];
		for (const node of diagram.nodes) {
			const unit = unitAt(group.id, node.id);
			if (unit === undefined || units.some((placed) => placed.id === unit)) continue;
			const child = children.find((candidate) => groupUnitId(candidate.id) === unit);
			units.push(child ? unitNode(child, unit) : node);
		}
		const inner = flowGraph(units, edges);
		const innerFeedback = new Set(edges.flatMap((edge) => (global.has(edge.id) ? [edge.id] : [])));
		// Folding nested groups into blocks can close loops of its own; they break
		// where a walk of the level does.
		if (children.length > 0) {
			const rest = flowGraph(
				units,
				edges.filter((edge) => !innerFeedback.has(edge.id)),
			);
			for (const id of feedbackEdgeIds(rest)) innerFeedback.add(id);
		}
		for (const id of innerFeedback) feedback.add(id);
		const pairs = zoned
			? loopsThroughOutside(whole, inner, innerFeedback, (id) => unitAt(group.id, id))
			: [];
		const crossing = new Set(
			sourceEdges.flatMap((edge) => {
				const [source, target] = [unitAt(group.id, edge.source), unitAt(group.id, edge.target)];
				return source === undefined && target !== undefined
					? [target]
					: target === undefined && source !== undefined
						? [source]
						: [];
			}),
		);
		return {
			children: children.map((child) => child.id),
			crossing,
			flow: rankedFlow(inner, innerFeedback, pairs),
			group,
		};
	});
	const units: DiagramNode[] = [];
	const placed = new Set<string>();
	for (const node of diagram.nodes) {
		const unit = unitAt(undefined, node.id)!;
		if (placed.has(unit)) continue;
		placed.add(unit);
		const outermost = chainOf(node.id).at(-1);
		units.push(
			outermost === undefined
				? node
				: unitNode(
						groups.find((candidate) => candidate.id === outermost)!,
						unit,
					),
		);
	}
	const topUnit = (id: string) => unitAt(undefined, id) ?? id;
	const crossEdges = sourceEdges.filter((edge) => topUnit(edge.source) !== topUnit(edge.target));
	const top = flowGraph(
		units,
		crossEdges.map((edge) => ({
			...edge,
			source: topUnit(edge.source),
			target: topUnit(edge.target),
		})),
	);
	const topFeedback = feedbackEdgeIds(top);
	for (const id of topFeedback) feedback.add(id);
	const structure = {
		composites,
		crossEdges,
		groupOf,
		groups: nested,
		parentOf,
		top: rankedFlow(top, topFeedback),
		zoned,
	};
	return { structure, feedback };
}

/**
 * The top level's own node pairs (blockPrecedence): a line from the first
 * into a block whose member reaches, through the block's members alone, a
 * line out of the block into the second, where the second does not already
 * lead to the first and the level ranks them alike.
 */
function throughBlockPairs(
	flow: FlowGraph,
	top: FlowGraph,
	feedback: ReadonlySet<string>,
	unitOf: (id: string) => string,
	entries: Set<string>,
): (readonly [string, string])[] {
	const own = (id: string) => unitOf(id) === id;
	const edges = flowEdges(flow);
	const after = Graph.mutate(top.graph, (mutable) => {
		Graph.filterEdges(mutable, (edge) => !feedback.has(edge.id));
	});
	const leads = (from: string, to: string) =>
		Graph.hasPath(after, top.indices.get(from)!, top.indices.get(to)!);
	const inside = Graph.mutate(flow.graph, (mutable) => {
		Graph.filterEdges(
			mutable,
			(edge) => !own(edge.source) && unitOf(edge.source) === unitOf(edge.target),
		);
	});
	const pairs: (readonly [string, string])[] = [];
	for (const into of edges) {
		if (!own(into.source) || own(into.target)) continue;
		const reached = new Set(
			Graph.values(Graph.dfs(inside, { start: [flow.indices.get(into.target)!] })),
		);
		for (const out of edges) {
			const [first, later] = [into.source, out.target];
			if (
				!reached.has(out.source) ||
				!own(later) ||
				first === later ||
				unitOf(out.source) !== unitOf(into.target) ||
				leads(later, first)
			)
				continue;
			entries.add(into.id);
			if (!pairs.some(([a, b]) => a === first && b === later)) pairs.push([first, later]);
		}
	}
	return pairs;
}

/**
 * A level's member pairs that leave it and come back: an edge out of the level
 * whose path, through nodes outside it alone, reaches an edge back in. Each
 * pair stays only while its later member does not already lead to the first,
 * so the level's ranks keep no loop.
 */
function loopsThroughOutside(
	flow: FlowGraph,
	level: FlowGraph,
	feedback: ReadonlySet<string>,
	unitOf: (id: string) => string | undefined,
): (readonly [string, string])[] {
	const inside = (id: string) => unitOf(id) !== undefined;
	const edges = flowEdges(flow);
	const outgoing = Graph.mutate(flow.graph, (mutable) => {
		Graph.filterEdges(mutable, (edge) => !inside(edge.source) && !inside(edge.target));
	});
	const reachedFrom = (start: string) =>
		new Set(Graph.values(Graph.dfs(outgoing, { start: [flow.indices.get(start)!] })));
	// Added precedence links carry no rendered edge; they only prevent a later
	// pair from introducing a cycle among the dependencies already accepted.
	const after = Graph.beginMutation<string, DiagramEdge | undefined, "directed">(level.graph);
	Graph.filterEdges(after, (edge) => edge !== undefined && !feedback.has(edge.id));
	const leads = (from: string, to: string) =>
		Graph.hasPath(after, level.indices.get(from)!, level.indices.get(to)!);
	const pairs: (readonly [string, string])[] = [];
	for (const out of edges) {
		if (!inside(out.source) || inside(out.target)) continue;
		const reached = reachedFrom(out.target);
		for (const back of edges) {
			if (inside(back.source) || !inside(back.target) || !reached.has(back.source)) continue;
			const [first, later] = [unitOf(out.source)!, unitOf(back.target)!];
			if (first === later || pairs.some(([a, b]) => a === first && b === later)) continue;
			if (leads(later, first)) continue;
			pairs.push([first, later]);
			Graph.addEdge(after, level.indices.get(first)!, level.indices.get(later)!, undefined);
		}
	}
	return pairs;
}
