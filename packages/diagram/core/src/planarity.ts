/**
 * How many crossings a drawing of a graph cannot avoid, read from its
 * planarity: a flowchart whose graph is planar can be drawn crossing nothing,
 * so every crossing it draws is avoidable. Each block (biconnected component)
 * is tested on its own with the Demoucron–Malgrange–Pertuiset embedding,
 * which suits the small graphs diagrams hold.
 */

type Graph = Map<string, Set<string>>;

function link(graph: Graph, a: string, b: string): void {
	graph.set(a, (graph.get(a) ?? new Set()).add(b));
	graph.set(b, (graph.get(b) ?? new Set()).add(a));
}

function edgeCount(graph: Graph): number {
	let ends = 0;
	for (const neighbors of graph.values()) ends += neighbors.size;
	return ends / 2;
}

/** The graph's blocks: its maximal biconnected subgraphs (Hopcroft–Tarjan). */
function blocks(graph: Graph): Graph[] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: (readonly [string, string])[] = [];
	const found: Graph[] = [];
	const visit = (node: string, parent: string | undefined) => {
		index.set(node, index.size);
		low.set(node, index.get(node)!);
		for (const next of graph.get(node) ?? []) {
			if (next === parent) continue;
			if (!index.has(next)) {
				stack.push([node, next]);
				visit(next, node);
				low.set(node, Math.min(low.get(node)!, low.get(next)!));
				if (low.get(next)! >= index.get(node)!) {
					const block: Graph = new Map();
					for (;;) {
						const [a, b] = stack.pop()!;
						link(block, a, b);
						if (a === node && b === next) break;
					}
					found.push(block);
				}
			} else if (index.get(next)! < index.get(node)!) {
				stack.push([node, next]);
				low.set(node, Math.min(low.get(node)!, index.get(next)!));
			}
		}
	};
	for (const node of graph.keys()) if (!index.has(node)) visit(node, undefined);
	return found;
}

/** A cycle of a biconnected graph, as its nodes in order. */
function cycleOf(graph: Graph): string[] {
	const start = graph.keys().next().value!;
	const parent = new Map<string, string | undefined>([[start, undefined]]);
	const depth = new Map([[start, 0]]);
	const stack = [start];
	while (stack.length > 0) {
		const node = stack.pop()!;
		for (const next of graph.get(node)!) {
			if (next === parent.get(node)) continue;
			if (parent.has(next)) {
				// Both ends climb to where their branches meet.
				const [left, right] = [[node], [next]];
				let [a, b] = [node, next];
				while (depth.get(a)! > depth.get(b)!) left.push((a = parent.get(a)!));
				while (depth.get(b)! > depth.get(a)!) right.push((b = parent.get(b)!));
				while (a !== b) {
					left.push((a = parent.get(a)!));
					right.push((b = parent.get(b)!));
				}
				right.pop();
				return [...left, ...right.reverse()];
			}
			parent.set(next, node);
			depth.set(next, depth.get(node)! + 1);
			stack.push(next);
		}
	}
	return [];
}

/** Whether a biconnected graph embeds in the plane. */
function blockPlanar(graph: Graph): boolean {
	const [nodes, edges] = [graph.size, edgeCount(graph)];
	// K5 and K3,3, the smallest graphs that cannot, have five nodes and nine edges.
	if (nodes < 5 || edges < 9) return true;
	if (edges > 3 * nodes - 6) return false;
	const key = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
	const cycle = cycleOf(graph);
	const placed = new Set(cycle);
	const drawn = new Set(cycle.map((node, at) => key(node, cycle[(at + 1) % cycle.length]!)));
	let faces: string[][] = [cycle, [...cycle]];
	for (;;) {
		// The fragments still to embed: each undrawn edge between placed nodes,
		// and each component of the unplaced nodes with the edges that attach it.
		const fragments: { attachments: Set<string>; path: () => string[] }[] = [];
		for (const [node, neighbors] of graph)
			for (const next of neighbors)
				if (node < next && placed.has(node) && placed.has(next) && !drawn.has(key(node, next)))
					fragments.push({ attachments: new Set([node, next]), path: () => [node, next] });
		const seen = new Set<string>();
		for (const start of graph.keys()) {
			if (placed.has(start) || seen.has(start)) continue;
			const component = new Set([start]);
			const attachments = new Set<string>();
			seen.add(start);
			for (const node of component)
				for (const next of graph.get(node)!) {
					if (placed.has(next)) attachments.add(next);
					else if (!seen.has(next)) {
						seen.add(next);
						component.add(next);
					}
				}
			fragments.push({
				attachments,
				// From one attachment through the component to another.
				path: () => {
					const [from] = attachments;
					const previous = new Map<string, string>();
					const queue: string[] = [];
					for (const next of graph.get(from!)!)
						if (component.has(next) && !previous.has(next)) {
							previous.set(next, from!);
							queue.push(next);
						}
					for (const node of queue)
						for (const next of graph.get(node)!) {
							if (next !== from && placed.has(next)) {
								const path = [next, node];
								for (let at = node; previous.get(at) !== from;) path.push((at = previous.get(at)!));
								path.push(from!);
								return path.reverse();
							}
							if (component.has(next) && !previous.has(next)) {
								previous.set(next, node);
								queue.push(next);
							}
						}
					return [];
				},
			});
		}
		if (fragments.length === 0) return true;
		const fitting = fragments.map((fragment) =>
			faces.filter((face) => [...fragment.attachments].every((node) => face.includes(node))),
		);
		if (fitting.some((options) => options.length === 0)) return false;
		// A fragment with one face it fits must go there; any other may go anywhere.
		const forced = fitting.findIndex((options) => options.length === 1);
		const chosen = forced >= 0 ? forced : 0;
		const face = fitting[chosen]![0]!;
		const path = fragments[chosen]!.path();
		const inner = path.slice(1, -1);
		const [from, to] = [face.indexOf(path[0]!), face.indexOf(path.at(-1)!)];
		const around = (start: number, end: number) => {
			const nodes = [face[start]!];
			for (let at = start; at !== end;) {
				at = (at + 1) % face.length;
				nodes.push(face[at]!);
			}
			return nodes;
		};
		faces = [
			...faces.filter((other) => other !== face),
			[...around(from, to), ...[...inner].reverse()],
			[...around(to, from), ...inner],
		];
		for (const node of inner) placed.add(node);
		for (let at = 0; at + 1 < path.length; at += 1) drawn.add(key(path[at]!, path[at + 1]!));
	}
}

/**
 * Crossings no drawing of the graph through these edges (direction ignored,
 * loops and repeats dropped) can avoid, at least: none when it is planar, and
 * otherwise, for each block that is not, at least one and at least as many as
 * its edges beyond what a plane graph of its nodes holds (3n - 6).
 */
export function unavoidableCrossings(edges: readonly (readonly [string, string])[]): number {
	const graph: Graph = new Map();
	for (const [source, target] of edges) if (source !== target) link(graph, source, target);
	return blocks(graph).reduce(
		(sum, block) =>
			blockPlanar(block) ? sum : sum + Math.max(1, edgeCount(block) - 3 * block.size + 6),
		0,
	);
}

interface LinePoint {
	readonly x: number;
	readonly y: number;
}

const COLLINEAR = 0.01;

/** A line's points with every point that continues a straight run dropped. */
function bends(points: readonly LinePoint[]): LinePoint[] {
	const kept: LinePoint[] = [];
	for (const point of points) {
		const last = kept.at(-1);
		if (last && Math.hypot(point.x - last.x, point.y - last.y) < COLLINEAR) continue;
		const before = kept.at(-2);
		const turn =
			before && last
				? (last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x)
				: Infinity;
		if (Math.abs(turn) < COLLINEAR) kept[kept.length - 1] = point;
		else kept.push(point);
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
	const runs = lines.map(bends);
	const side = (o: LinePoint, p: LinePoint, q: LinePoint) =>
		(p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
	const strict = (value: number) => Math.abs(value) > COLLINEAR;
	let crossings = 0;
	for (const [index, a] of runs.entries())
		for (const b of runs.slice(index + 1))
			for (let i = 0; i + 1 < a.length; i += 1)
				for (let j = 0; j + 1 < b.length; j += 1) {
					const [p, q, r, u] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
					const [s1, s2, s3, s4] = [side(r, u, p), side(r, u, q), side(p, q, r), side(p, q, u)];
					if (
						[s1, s2, s3, s4].every(strict) &&
						Math.sign(s1) !== Math.sign(s2) &&
						Math.sign(s3) !== Math.sign(s4)
					)
						crossings += 1;
				}
	return crossings;
}
