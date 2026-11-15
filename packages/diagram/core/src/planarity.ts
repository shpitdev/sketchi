import { Array, Graph, MutableHashMap, MutableHashSet, Option } from "effect";

/**
 * How many crossings a drawing of a graph cannot avoid, read from its
 * planarity: a flowchart whose graph is planar can be drawn crossing nothing,
 * so every crossing it draws is avoidable. Each block (biconnected component)
 * is tested on its own with the Demoucron–Malgrange–Pertuiset embedding,
 * which suits the small graphs diagrams hold.
 */

type DiagramGraph = Graph.UndirectedGraph<string, string>;

/** Domain IDs retain first-occurrence indices; loops and undirected repeats add nothing. */
function diagramGraph(edges: readonly (readonly [string, string])[]): DiagramGraph {
	return Graph.undirected<string, string>((mutable) => {
		const indices = MutableHashMap.empty<string, Graph.NodeIndex>();
		const indexOf = (id: string) =>
			Option.getOrElse(MutableHashMap.get(indices, id), () => {
				const index = Graph.addNode(mutable, id);
				MutableHashMap.set(indices, id, index);
				return index;
			});
		for (const [source, target] of edges) {
			if (source === target) continue;
			const a = indexOf(source);
			const b = indexOf(target);
			if (Graph.edgesBetween(mutable, a, b).length > 0) continue;
			// Retain the embedding's existing undirected edge identity, independent of traversal order.
			const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
			Graph.addEdge(mutable, a, b, key);
		}
	});
}

interface Fragment {
	readonly attachments: readonly Graph.NodeIndex[];
	readonly path: () => Option.Option<readonly Graph.NodeIndex[]>;
}

/** Whether a biconnected graph embeds in the plane. */
function blockPlanar(graph: DiagramGraph): boolean {
	const nodes = Graph.nodeCount(graph);
	const edges = Graph.edgeCount(graph);
	// K5 and K3,3, the smallest graphs that cannot, have five nodes and nine edges.
	if (nodes < 5 || edges < 9) return true;
	if (edges > 3 * nodes - 6) return false;
	const witness = Graph.findCycle(graph);
	if (Option.isNone(witness)) return true;
	// Upstream closes its witness by repeating the first node; DMP stores open face boundaries.
	const cycle = Array.dropRight(witness.value.path, 1);
	const placed = MutableHashSet.fromIterable(cycle);
	const drawn = MutableHashSet.fromIterable(
		Array.getSomes(
			Array.map(witness.value.edges, (index) =>
				Option.map(Graph.getEdge(graph, index), (edge) => edge.data),
			),
		),
	);
	let faces: (readonly Graph.NodeIndex[])[] = [cycle, [...cycle]];
	for (;;) {
		// The fragments still to embed: each undrawn edge between placed nodes,
		// and each component of the unplaced nodes with the edges that attach it.
		let fragments: Fragment[] = [];
		for (const edge of Graph.values(Graph.edges(graph))) {
			if (
				MutableHashSet.has(placed, edge.source) &&
				MutableHashSet.has(placed, edge.target) &&
				!MutableHashSet.has(drawn, edge.data)
			) {
				fragments = Array.append(fragments, {
					attachments: [edge.source, edge.target],
					path: () => Option.some([edge.source, edge.target]),
				});
			}
		}
		const unplaced = Graph.inducedSubgraph(
			graph,
			Array.filter(Graph.indices(Graph.nodes(graph)), (node) => !MutableHashSet.has(placed, node)),
		);
		for (const component of Graph.connectedComponents(unplaced)) {
			const attachments = MutableHashSet.empty<Graph.NodeIndex>();
			for (const node of component) {
				for (const next of Graph.neighbors(graph, node)) {
					if (MutableHashSet.has(placed, next)) MutableHashSet.add(attachments, next);
				}
			}
			fragments = Array.append(fragments, {
				attachments: Array.fromIterable(attachments),
				// Select the closest other attachment through this component, never a drawn chord.
				path: () =>
					Option.flatMap(Array.head(Array.fromIterable(attachments)), (from) => {
						const fragment = Graph.mutate(
							Graph.inducedSubgraph(graph, [...component, ...attachments]),
							(mutable) => {
								Graph.removeEdges(
									mutable,
									Array.map(
										Array.filter(
											Graph.entries(Graph.edges(mutable)),
											([, edge]) =>
												MutableHashSet.has(placed, edge.source) &&
												MutableHashSet.has(placed, edge.target),
										),
										([index]) => index,
									),
								);
							},
						);
						const target = Array.findFirst(
							Graph.indices(Graph.bfs(fragment, { start: [from] })),
							(node) => node !== from && MutableHashSet.has(placed, node),
						);
						return Option.flatMap(target, (to) =>
							Option.map(
								Graph.dijkstra(fragment, { source: from, target: to, cost: () => 1 }),
								({ path }) => path,
							),
						);
					}),
			});
		}
		if (fragments.length === 0) return true;
		const fitting = Array.map(fragments, (fragment) => ({
			fragment,
			faces: Array.filter(faces, (face) =>
				Array.every(fragment.attachments, (node) => Array.contains(face, node)),
			),
		}));
		if (Array.some(fitting, (options) => options.faces.length === 0)) return false;
		// A fragment with one face it fits must go there; any other may go anywhere.
		const placement = Option.gen(function* () {
			const chosen = yield* Option.orElse(
				Array.findFirst(fitting, (options) => options.faces.length === 1),
				() => Array.head(fitting),
			);
			const face = yield* Array.head(chosen.faces);
			const path = yield* chosen.fragment.path();
			const first = yield* Array.head(path);
			const last = yield* Array.last(path);
			const from = yield* Array.findFirstIndex(face, (node) => node === first);
			const to = yield* Array.findFirstIndex(face, (node) => node === last);
			return { face, path, from, to };
		});
		if (Option.isNone(placement)) return false;
		const { face, path, from, to } = placement.value;
		const inner = Array.dropRight(Array.drop(path, 1), 1);
		const around = (start: number, end: number) =>
			start <= end
				? Array.take(Array.drop(face, start), end - start + 1)
				: [...Array.drop(face, start), ...Array.take(face, end + 1)];
		faces = [
			...Array.filter(faces, (other) => other !== face),
			[...around(from, to), ...Array.reverse(inner)],
			[...around(to, from), ...inner],
		];
		for (const node of inner) MutableHashSet.add(placed, node);
		for (const [a, b] of Array.zip(path, Array.drop(path, 1))) {
			for (const index of Graph.edgesBetween(graph, a, b)) {
				Option.map(Graph.getEdge(graph, index), (edge) => MutableHashSet.add(drawn, edge.data));
			}
		}
	}
}

/**
 * Crossings no drawing of the graph through these edges (direction ignored,
 * loops and repeats dropped) can avoid, at least: none when it is planar, and
 * otherwise, for each block that is not, at least one and at least as many as
 * its edges beyond what a plane graph of its nodes holds (3n - 6).
 */
export function unavoidableCrossings(edges: readonly (readonly [string, string])[]): number {
	const graph = diagramGraph(edges);
	return Array.reduce(Graph.biconnectedComponents(graph), 0, (sum, nodes) => {
		const block = Graph.inducedSubgraph(graph, nodes);
		return blockPlanar(block)
			? sum
			: sum + Math.max(1, Graph.edgeCount(block) - 3 * Graph.nodeCount(block) + 6);
	});
}

interface LinePoint {
	readonly x: number;
	readonly y: number;
}

const COLLINEAR = 0.01;

/** A line's points with every point that continues a straight run dropped. */
function bends(points: readonly LinePoint[]): LinePoint[] {
	let kept: LinePoint[] = [];
	for (const point of points) {
		const last = Array.last(kept);
		if (
			Option.isSome(last) &&
			Math.hypot(point.x - last.value.x, point.y - last.value.y) < COLLINEAR
		)
			continue;
		const turn = Option.getOrElse(
			Option.zipWith(
				Array.get(kept, kept.length - 2),
				last,
				(before, last) =>
					(last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x),
			),
			() => Infinity,
		);
		if (Math.abs(turn) < COLLINEAR)
			kept = Option.getOrElse(Array.replace(kept, kept.length - 1, point), () => kept);
		else kept = Array.append(kept, point);
	}
	return kept;
}

/**
 * Times the lines cross one another, at any angle: each pair of their runs
 * that pass strictly through each other. A crossing counts once wherever a
 * line runs straight on through a point it was drawn through; lines that only
 * meet, at an end or a bend, do not cross.
 */
export function lineCrossings(lines: readonly (readonly LinePoint[])[]): number {
	const runs = Array.map(lines, bends);
	const side = (o: LinePoint, p: LinePoint, q: LinePoint) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	const strict = (value: number) => Math.abs(value) > COLLINEAR;
	let crossings = 0;
	Array.forEach(runs, (a, index) => {
		for (const b of Array.drop(runs, index + 1))
			for (const [p, q] of Array.zip(a, Array.drop(a, 1)))
				for (const [r, u] of Array.zip(b, Array.drop(b, 1))) {
					const [s1, s2, s3, s4] = [side(r, u, p), side(r, u, q), side(p, q, r), side(p, q, u)];
					if (
						Array.every([s1, s2, s3, s4], strict) &&
						Math.sign(s1) !== Math.sign(s2) &&
						Math.sign(s3) !== Math.sign(s4)
					)
						crossings += 1;
				}
	});
	return crossings;
}
