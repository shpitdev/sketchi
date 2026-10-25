/**
 * Where an ER diagram's tables go. Tables stand in columns, and each
 * relationship runs between neighboring columns where it can, its referenced
 * table to the left of the one that holds the foreign key. Columns stay about
 * as tall as the whole layout is wide over its aspect, tables move between
 * columns while that leaves fewer crossings once each column is ordered, and
 * tables slide up or down so the rows a relationship joins sit level and its
 * line runs straight.
 */

/** A table to place: its size. */
export interface ErLayoutTable {
	readonly id: string;
	readonly width: number;
	readonly height: number;
}

/**
 * A relationship to place tables for, from its referenced (parent) table to the
 * one that holds the foreign key (child), with the height of the row each end
 * attaches to, from its table's top.
 */
export interface ErLayoutLink {
	readonly id: string;
	readonly parent: string;
	readonly child: string;
	readonly parentY: number;
	readonly childY: number;
	/**
	 * Where the line meets each end's row, from its table's top, where that is
	 * not the row's middle: rows align on these, so the line runs level.
	 */
	readonly parentPort?: number;
	readonly childPort?: number;
	/** Width of the label beside the parent's end; 0 without one. */
	readonly labelWidth: number;
}

export type ErSide = "left" | "right";

/**
 * Choices behind one candidate placement. The renderer routes a few and keeps
 * the one that reads best: columns from a layered start or from one centered
 * on the most linked table, its links spread to both sides, each aiming at a
 * shape, and one that lets linked tables share a column freely.
 */
export interface ErPlacementOptions {
	readonly start?: "layered" | "hub";
	/** Cost of a link between two tables in one column, in units of one ideal link. */
	readonly sameColumn?: number;
	/** Width over height to aim for; 1.6 when omitted. */
	readonly aspect?: number;
	/**
	 * Columns and the order within them, kept as an earlier placement of these
	 * tables and links arranged them; only rows realign, for changed heights.
	 */
	readonly arrangement?: ErArrangement;
}

/** Where a placement put each table: its column, and every item's order within each column. */
export interface ErArrangement {
	readonly column: readonly number[];
	readonly stacks: readonly (readonly number[])[];
}

export interface ErPlacement {
	readonly boxes: ReadonlyMap<
		string,
		{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }
	>;
	/** The side each link leaves its parent and reaches its child by. */
	readonly sides: ReadonlyMap<string, { readonly parent: ErSide; readonly child: ErSide }>;
	readonly arrangement: ErArrangement;
}

/** Room between stacked tables, wide enough for a line to pass between them. */
export const ER_STACK_GAP = 56;
/** The narrowest gap between columns: two end runs and a lane each side. */
const MIN_COLUMN_GAP = 132;
/** Room each further line through a gap takes beside the others. */
const LANE = 20;
/** Width over height the whole layout aims for. */
const TARGET_ASPECT = 1.6;
/** Costs, in units of one ideal link: a link drawn right to left, within a column, or across columns. */
const FLIPPED = 0.4;
const SAME_COLUMN = 2.5;
const PER_SKIPPED_COLUMN = 2.5;
/**
 * Cost of a column one table taller than the target, or of a layout one column
 * wider, growing with the square of the excess.
 */
const OVERFLOW = 1.5;
/**
 * Cost of each pair of links that leave one side of a table together: a hub
 * spreads its links over both sides instead of fanning them all from one.
 */
const FAN = 0.4;
/** Cost of each end past the second on one side of one row, where their marks would bunch. */
const CROWD = 1;
/** Cost of each crossing the order within columns leaves. */
const CROSSING = 1;
/** How much wider than its target a layout may run before its width costs anything. */
const WIDTH_ALLOWANCE = 1.25;
/** A gap between columns as the column search estimates it. */
const ESTIMATED_GAP = 150;
/** How much further each line turning the same way out of one row runs before it turns, so none share a vertical run. */
export const ER_FAN_STEP = 32;
const MAX_ROUNDS = 40;
/** Rounds of the column search that counts crossings, each ordering every candidate's columns. */
const CROSSING_ROUNDS = 8;
const ORDER_SWEEPS = 8;
const ALIGN_SWEEPS = 12;

interface Graph {
	readonly tables: readonly ErLayoutTable[];
	readonly index: ReadonlyMap<string, number>;
	readonly links: readonly ErLayoutLink[];
	/** Links between two different tables, by table index. */
	readonly pairs: readonly {
		readonly parent: number;
		readonly child: number;
		readonly link: ErLayoutLink;
	}[];
}

function graphOf(tables: readonly ErLayoutTable[], links: readonly ErLayoutLink[]): Graph {
	const index = new Map(tables.map((table, at) => [table.id, at]));
	return {
		tables,
		index,
		links,
		pairs: links.flatMap((link) =>
			link.parent === link.child
				? []
				: [{ parent: index.get(link.parent)!, child: index.get(link.child)!, link }],
		),
	};
}

/** First guess: each table one column right of the tables it references, sources pulled toward their children. */
function initialColumns(graph: Graph): number[] {
	const n = graph.tables.length;
	const children = Array.from({ length: n }, () => [] as number[]);
	for (const { parent, child } of graph.pairs) children[parent]!.push(child);
	// Break cycles where a depth-first walk meets a table it is still inside.
	const state = Array.from<0 | 1 | 2>({ length: n }).fill(0);
	const forward = Array.from({ length: n }, () => [] as number[]);
	const visit = (node: number) => {
		state[node] = 1;
		for (const child of children[node]!) {
			if (state[child] === 1) continue;
			forward[node]!.push(child);
			if (state[child] === 0) visit(child);
		}
		state[node] = 2;
	};
	for (let node = 0; node < n; node += 1) if (state[node] === 0) visit(node);
	const parents = Array.from({ length: n }, () => [] as number[]);
	for (const [node, list] of forward.entries())
		for (const child of list) parents[child]!.push(node);
	const column = Array.from({ length: n }, () => 0);
	const order: number[] = [];
	const indegree = parents.map((list) => list.length);
	const queue = indegree.flatMap((count, node) => (count === 0 ? [node] : []));
	while (queue.length > 0) {
		const node = queue.shift()!;
		order.push(node);
		for (const child of forward[node]!) {
			column[child] = Math.max(column[child]!, column[node]! + 1);
			indegree[child]! -= 1;
			if (indegree[child] === 0) queue.push(child);
		}
	}
	// A referenced table with no parents of its own sits just left of its nearest child.
	for (const node of [...order].reverse())
		if (parents[node]!.length === 0 && forward[node]!.length > 0)
			column[node] = Math.min(...forward[node]!.map((child) => column[child]!)) - 1;
	return column;
}

interface Target {
	/** Column height the layout aims for. */
	readonly height: number;
	/** Height of an average table and the gap below it: one table's worth of overflow. */
	readonly unit: number;
	/** Width the layout aims for, and an average column's width with its gap. */
	readonly width: number;
	readonly column: number;
}

function targetFor(graph: Graph, aspect = TARGET_ASPECT): Target {
	const area = graph.tables.reduce(
		(sum, table) => sum + (table.width + MIN_COLUMN_GAP) * (table.height + ER_STACK_GAP),
		0,
	);
	const tallest = Math.max(...graph.tables.map((table) => table.height));
	const unit =
		graph.tables.reduce((sum, table) => sum + table.height + ER_STACK_GAP, 0) / graph.tables.length;
	const column =
		graph.tables.reduce((sum, table) => sum + table.width + ESTIMATED_GAP, 0) / graph.tables.length;
	const height = Math.max(tallest, Math.sqrt(area / aspect));
	return { height, unit, width: WIDTH_ALLOWANCE * aspect * height, column };
}

function linkCost(parent: number, child: number, sameColumn: number): number {
	const span = child - parent;
	if (span === 1) return 0;
	if (span === -1) return FLIPPED;
	if (span === 0) return sameColumn;
	return PER_SKIPPED_COLUMN * (Math.abs(span) - 1) + (span < 0 ? FLIPPED : 0);
}

function layoutCost(
	graph: Graph,
	column: readonly number[],
	target: Target,
	sameColumn: number,
): number {
	let cost = 0;
	// Links leaving each side of each table: right toward later columns, left toward earlier.
	const sides = new Map<number, number>();
	const rows = new Map<number, number>();
	const leave = (node: number, toward: number, y: number) => {
		const side = 2 * node + (toward >= column[node]! ? 1 : 0);
		sides.set(side, (sides.get(side) ?? 0) + 1);
		// Rows sit whole or half pixels from their table's top.
		const row = side * 1e6 + Math.round(2 * y);
		rows.set(row, (rows.get(row) ?? 0) + 1);
	};
	for (const { parent, child, link } of graph.pairs) {
		cost += linkCost(column[parent]!, column[child]!, sameColumn);
		leave(parent, column[child]!, link.parentY);
		leave(child, column[parent]!, link.childY);
	}
	for (const count of sides.values()) cost += (FAN * count * (count - 1)) / 2;
	for (const count of rows.values()) cost += CROWD * Math.max(0, count - 2);
	const heights = new Map<number, number>();
	const widths = new Map<number, number>();
	for (const [node, table] of graph.tables.entries()) {
		const at = column[node]!;
		heights.set(at, (heights.get(at) ?? -ER_STACK_GAP) + table.height + ER_STACK_GAP);
		widths.set(at, Math.max(widths.get(at) ?? 0, table.width));
	}
	for (const height of heights.values()) {
		const excess = Math.max(0, height - target.height) / target.unit;
		cost += OVERFLOW * excess * excess;
	}
	const width =
		[...widths.values()].reduce((sum, value) => sum + value, 0) +
		ESTIMATED_GAP * Math.max(0, widths.size - 1);
	const wider = Math.max(0, width - target.width) / target.column;
	return cost + OVERFLOW * wider * wider;
}

/** Columns numbered from 0 with none left empty, in their order. */
function compact(column: readonly number[]): number[] {
	const used = [...new Set(column)].sort((a, b) => a - b);
	const rank = new Map(used.map((value, at) => [value, at]));
	return column.map((value) => rank.get(value)!);
}

function neighborSets(graph: Graph): Set<number>[] {
	const neighbors = graph.tables.map(() => new Set<number>());
	for (const { parent, child } of graph.pairs) {
		neighbors[parent]!.add(child);
		neighbors[child]!.add(parent);
	}
	return neighbors;
}

/**
 * A start centered on each component's most linked table: its neighbors split
 * between the columns either side of it, the side with less height so far
 * taking the next, and each further table one column beyond its way in.
 */
function hubColumns(graph: Graph): number[] {
	const neighbors = neighborSets(graph);
	const column: (number | undefined)[] = graph.tables.map(() => undefined);
	const heading = new Map<number, number>();
	const byDegree = graph.tables
		.map((_, node) => node)
		.sort((a, b) => neighbors[b]!.size - neighbors[a]!.size || a - b);
	for (const hub of byDegree) {
		if (column[hub] !== undefined) continue;
		column[hub] = 0;
		heading.set(hub, 0);
		const height = { [-1]: 0, [1]: 0 } as Record<number, number>;
		const queue = [hub];
		while (queue.length > 0) {
			const node = queue.shift()!;
			const next = [...neighbors[node]!]
				.filter((other) => column[other] === undefined)
				.sort((a, b) => neighbors[b]!.size - neighbors[a]!.size || a - b);
			for (const other of next) {
				let step = heading.get(node)!;
				if (step === 0) {
					step = height[1]! <= height[-1]! ? 1 : -1;
					height[step] = height[step]! + graph.tables[other]!.height;
				}
				column[other] = column[node]! + step;
				heading.set(other, step);
				queue.push(other);
			}
		}
	}
	return column.map((value) => value ?? 0);
}

/**
 * Move one table at a time to the column that lowers `cost` most, until none
 * does or the rounds run out: each table tries the columns near its own and
 * its neighbors', an unlinked table any column.
 */
function descend(
	graph: Graph,
	column: number[],
	rounds: number,
	cost: (column: readonly number[]) => number,
): void {
	const neighbors = neighborSets(graph);
	const visitOrder = graph.tables
		.map((_, node) => node)
		.sort((a, b) => neighbors[b]!.size - neighbors[a]!.size || a - b);
	let current = cost(column);
	for (let round = 0; round < rounds; round += 1) {
		let improved = false;
		for (const node of visitOrder) {
			const from = column[node]!;
			const candidates = new Set([from - 2, from - 1, from + 1, from + 2]);
			for (const other of neighbors[node]!)
				for (const delta of [-1, 0, 1]) candidates.add(column[other]! + delta);
			if (neighbors[node]!.size === 0) for (const value of column) candidates.add(value);
			candidates.delete(from);
			let best = from;
			for (const candidate of [...candidates].sort((a, b) => a - b)) {
				column[node] = candidate;
				const next = cost(column);
				if (next < current - 1e-9) [best, current] = [candidate, next];
			}
			column[node] = best;
			if (best !== from) improved = true;
		}
		if (!improved) break;
	}
}

/**
 * Columns for each table: the cheapest by the links' spans, sides and the
 * layout's shape, then the cheapest once the crossings left after ordering
 * each candidate's columns count too.
 */
function assignColumns(graph: Graph, options: ErPlacementOptions): number[] {
	const target = targetFor(graph, options.aspect);
	const sameColumn = options.sameColumn ?? SAME_COLUMN;
	const column = options.start === "hub" ? hubColumns(graph) : initialColumns(graph);
	descend(graph, column, MAX_ROUNDS, (values) => layoutCost(graph, values, target, sameColumn));
	const crossings = new Map<string, number>();
	descend(graph, column, CROSSING_ROUNDS, (values) => {
		const compacted = compact(values);
		const key = compacted.join(",");
		let count = crossings.get(key);
		if (count === undefined) {
			count = orderColumns(layersOf(graph, compacted), false).crossings;
			crossings.set(key, count);
		}
		return layoutCost(graph, values, target, sameColumn) + CROSSING * count;
	});
	return compact(column);
}

/**
 * What stands in the columns: the tables and, for each link that skips a
 * column, a corridor in every column it passes, held at its parent's row so the
 * line runs straight through between the tables there.
 */
interface Layers {
	readonly column: readonly number[];
	readonly height: readonly number[];
	/** For a corridor, the absolute row height it holds to follow: its link and parent. */
	readonly corridor: readonly ({ readonly parent: number; readonly y: number } | undefined)[];
	/** Neighboring items joined by a link or a stretch of one, with where each end attaches. */
	readonly segments: readonly {
		readonly a: number;
		readonly b: number;
		readonly aY: number;
		readonly bY: number;
	}[];
}

/** A corridor's height, the room beside it and between two corridors side by side. */
const CORRIDOR_HEIGHT = 4;
const CORRIDOR_GAP = 26;

function layersOf(graph: Graph, column: readonly number[]): Layers {
	const columns = [...column];
	const height = graph.tables.map((table) => table.height);
	const corridor: ({ parent: number; y: number } | undefined)[] = graph.tables.map(() => undefined);
	const segments: { a: number; b: number; aY: number; bY: number }[] = [];
	for (const { parent, child, link } of graph.pairs) {
		const [from, to] = [column[parent]!, column[child]!];
		const [parentY, childY] = [link.parentPort ?? link.parentY, link.childPort ?? link.childY];
		if (Math.abs(to - from) <= 1) {
			segments.push({ a: parent, b: child, aY: parentY, bY: childY });
			continue;
		}
		const step = Math.sign(to - from);
		let previous = { item: parent, y: parentY };
		for (let at = from + step; at !== to; at += step) {
			const item = columns.length;
			columns.push(at);
			height.push(CORRIDOR_HEIGHT);
			corridor.push({ parent, y: parentY });
			segments.push({ a: previous.item, b: item, aY: previous.y, bY: CORRIDOR_HEIGHT / 2 });
			previous = { item, y: CORRIDOR_HEIGHT / 2 };
		}
		segments.push({ a: previous.item, b: child, aY: previous.y, bY: childY });
	}
	return { column: columns, height, corridor, segments };
}

function stackGap(layers: Layers, above: number, below: number): number {
	const corridors = [above, below].filter((item) => layers.corridor[item] !== undefined).length;
	return corridors === 2 ? LANE : corridors === 1 ? CORRIDOR_GAP : ER_STACK_GAP;
}

/** Offsets of each item from its column's top when stacked in order, gap apart. */
function stackOffsets(layers: Layers, items: readonly number[]): number[] {
	const offsets: number[] = [];
	let offset = 0;
	for (const [index, item] of items.entries()) {
		if (index > 0) offset += stackGap(layers, items[index - 1]!, item);
		offsets.push(offset);
		offset += layers.height[item]!;
	}
	return offsets;
}

/** Stack each column's items in order, gap apart, centered on 0. */
function stacked(layers: Layers, columns: readonly number[][]): number[] {
	const top = layers.column.map(() => 0);
	for (const items of columns) restack(layers, top, items);
	return top;
}

/** Stack one column's items in order, gap apart, centered on 0. */
function restack(layers: Layers, top: number[], items: readonly number[]): void {
	const offsets = stackOffsets(layers, items);
	const height = items.length > 0 ? offsets.at(-1)! + layers.height[items.at(-1)!]! : 0;
	for (const [index, item] of items.entries()) top[item] = offsets[index]! - height / 2;
}

/**
 * Segments crossing between neighboring columns, each drawn straight from end
 * to end, and the lines each link within a column crosses: those leaving the
 * column between its two rows, on the side with fewer of them.
 */
function orderCrossings(layers: Layers, top: readonly number[]): number {
	const runs = new Map<number, number[]>();
	// Where segments leave each column, by side: column * 2 toward the column before, + 1 after.
	const ends = new Map<number, number[]>();
	const loops: number[] = [];
	const leave = (column: number, after: boolean, y: number) => {
		const key = 2 * column + (after ? 1 : 0);
		const list = ends.get(key);
		if (list) list.push(y);
		else ends.set(key, [y]);
	};
	for (const { a, b, aY, bY } of layers.segments) {
		const [ca, cb] = [layers.column[a]!, layers.column[b]!];
		const [ya, yb] = [top[a]! + aY, top[b]! + bY];
		if (ca === cb) {
			loops.push(ca, Math.min(ya, yb), Math.max(ya, yb));
			continue;
		}
		leave(ca, cb > ca, ya);
		leave(cb, ca > cb, yb);
		const gap = Math.min(ca, cb);
		const list = runs.get(gap);
		const run = ca < cb ? [ya, yb] : [yb, ya];
		if (list) list.push(...run);
		else runs.set(gap, run);
	}
	let crossings = 0;
	for (const list of runs.values())
		for (let index = 0; index < list.length; index += 2)
			for (let other = index + 2; other < list.length; other += 2)
				if ((list[index]! - list[other]!) * (list[index + 1]! - list[other + 1]!) < 0)
					crossings += 1;
	for (let index = 0; index < loops.length; index += 3) {
		const [column, low, high] = [loops[index]!, loops[index + 1]!, loops[index + 2]!];
		const crossed = (after: number) => {
			let count = 0;
			for (const y of ends.get(2 * column + after) ?? []) if (y > low && y < high) count += 1;
			return count;
		};
		crossings += Math.min(crossed(0), crossed(1));
	}
	return crossings;
}

/** Each item's neighbors: the other end of each segment, with both attachment heights. */
function neighborsOf(layers: Layers) {
	const around = layers.column.map(() => [] as { other: number; ownY: number; otherY: number }[]);
	for (const { a, b, aY, bY } of layers.segments) {
		around[a]!.push({ other: b, ownY: aY, otherY: bY });
		around[b]!.push({ other: a, ownY: bY, otherY: aY });
	}
	return around;
}

interface Stack {
	readonly columns: readonly number[][];
	readonly top: number[];
	readonly crossings: number;
}

/**
 * Order each column by where its items' neighbors sit, keeping the order with
 * the fewest crossings, then, with `swaps`, swap neighbors while that removes
 * more; the column search leaves the swaps out to stay quick.
 */
function orderColumns(layers: Layers, swaps = true): Stack {
	const count = Math.max(...layers.column) + 1;
	let columns = Array.from({ length: count }, () => [] as number[]);
	for (const [item, at] of layers.column.entries()) columns[at]!.push(item);
	const around = neighborsOf(layers);
	let top = stacked(layers, columns);
	let best = {
		columns: columns.map((items) => [...items]),
		crossings: orderCrossings(layers, top),
	};
	for (let sweep = 0; sweep < ORDER_SWEEPS && best.crossings > 0; sweep += 1) {
		const sequence = [...columns.keys()];
		if (sweep % 2 === 1) sequence.reverse();
		for (const at of sequence) {
			const key = new Map<number, number>();
			for (const item of columns[at]!) {
				let sum = 0;
				let weight = 0;
				for (const { other, ownY, otherY } of around[item]!) {
					const w = layers.column[other] === at ? 0.5 : 1;
					sum += w * (top[other]! + otherY - ownY);
					weight += w;
				}
				key.set(item, weight > 0 ? sum / weight : top[item]!);
			}
			columns[at] = [...columns[at]!].sort(
				(a, b) => key.get(a)! - key.get(b)! || top[a]! - top[b]!,
			);
			restack(layers, top, columns[at]);
		}
		const crossings = orderCrossings(layers, top);
		if (crossings < best.crossings)
			best = { columns: columns.map((items) => [...items]), crossings };
	}
	columns = best.columns;
	// Then swap neighbors in a column while that removes crossings.
	top = stacked(layers, columns);
	let crossings = orderCrossings(layers, top);
	for (let improved = swaps && crossings > 0; improved;) {
		improved = false;
		for (const items of columns)
			for (let index = 0; index + 1 < items.length; index += 1) {
				[items[index], items[index + 1]] = [items[index + 1]!, items[index]!];
				const swapped = orderCrossings(layers, stacked(layers, columns));
				if (swapped < crossings) {
					crossings = swapped;
					improved = true;
				} else [items[index], items[index + 1]] = [items[index + 1]!, items[index]!];
			}
	}
	return { columns, top: stacked(layers, columns), crossings };
}

/**
 * The closest nondecreasing sequence to `values`, each weighted: pool
 * neighbors that fall out of order into their weighted mean.
 */
function isotonic(values: readonly number[], weights: readonly number[]): number[] {
	const blocks: { count: number; weight: number; sum: number }[] = [];
	for (const [index, value] of values.entries()) {
		const weight = weights[index]!;
		blocks.push({ count: 1, weight, sum: value * weight });
		while (blocks.length > 1) {
			const last = blocks.at(-1)!;
			const previous = blocks.at(-2)!;
			if (previous.sum / previous.weight <= last.sum / last.weight) break;
			blocks.pop();
			previous.count += last.count;
			previous.weight += last.weight;
			previous.sum += last.sum;
		}
	}
	return blocks.flatMap((block) => Array<number>(block.count).fill(block.sum / block.weight));
}

/** How strongly a corridor holds to its parent's row against the tables beside it. */
const CORRIDOR_WEIGHT = 4;

/**
 * Slide items within their columns, keeping their order and gaps, so each
 * link's rows come as level as the others allow and each corridor stays level
 * with the row its line leaves.
 */
function alignRows(layers: Layers, stack: Stack): number[] {
	const top = [...stack.top];
	const around = neighborsOf(layers);
	for (let sweep = 0; sweep < ALIGN_SWEEPS; sweep += 1) {
		const sequence = [...stack.columns.keys()];
		if (sweep % 2 === 1) sequence.reverse();
		for (const at of sequence) {
			const items = stack.columns[at]!;
			if (items.length === 0) continue;
			const desired: number[] = [];
			const weights: number[] = [];
			for (const item of items) {
				const corridor = layers.corridor[item];
				if (corridor) {
					desired.push(top[corridor.parent]! + corridor.y - CORRIDOR_HEIGHT / 2);
					weights.push(CORRIDOR_WEIGHT);
					continue;
				}
				let sum = 0;
				let weight = 0;
				for (const { other, ownY, otherY } of around[item]!) {
					if (layers.column[other] === at) continue;
					sum += top[other]! + otherY - ownY;
					weight += 1;
				}
				// An unlinked table holds still, lightly.
				desired.push(weight > 0 ? sum / weight : top[item]!);
				weights.push(weight > 0 ? weight : 0.05);
			}
			const offsets = stackOffsets(layers, items);
			const fitted = isotonic(
				desired.map((value, index) => value - offsets[index]!),
				weights,
			);
			for (const [index, item] of items.entries()) top[item] = fitted[index]! + offsets[index]!;
		}
	}
	return snapRows(
		layers,
		stack,
		top.map((value) => Math.round(value)),
	);
}

/** A link this close to level reads as a jog; it moves its table to run level instead. */
const SNAP = 40;

/**
 * Bring nearly level links exactly level: a table moves by a link's small step,
 * pushing the tables packed against it on that side along with it, when its
 * column still holds them all in order with their gaps and more of the moved
 * tables' links end level than before.
 */
function snapRows(layers: Layers, stack: Stack, top: number[]): number[] {
	const around = neighborsOf(layers);
	const level = (items: readonly number[]) =>
		items.reduce(
			(sum, item) =>
				sum +
				around[item]!.filter(
					({ other, ownY, otherY }) =>
						layers.column[other] !== layers.column[item] &&
						Math.abs(top[other]! + otherY - top[item]! - ownY) < 0.5,
				).length,
			0,
		);
	const tight = (above: number, below: number) =>
		top[below]! - top[above]! - layers.height[above]! - stackGap(layers, above, below) < 0.5;
	for (let pass = 0; pass < 2; pass += 1)
		for (const items of stack.columns)
			for (const [index, item] of items.entries()) {
				if (layers.corridor[item]) continue;
				const steps = around[item]!.flatMap(({ other, ownY, otherY }) => {
					const step = top[other]! + otherY - top[item]! - ownY;
					return layers.column[other] !== layers.column[item] &&
						Math.abs(step) >= 0.5 &&
						Math.abs(step) <= SNAP
						? [step]
						: [];
				});
				for (const step of steps) {
					// The block: this table and the tables packed against it the way it moves.
					const block = [item];
					const direction = step > 0 ? 1 : -1;
					for (let at = index; ; at += direction) {
						const next = items[at + direction];
						if (next === undefined) break;
						const packed = direction > 0 ? tight(items[at]!, next) : tight(next, items[at]!);
						if (!packed) {
							const room =
								direction > 0
									? top[next]! -
										top[items[at]!]! -
										layers.height[items[at]!]! -
										stackGap(layers, items[at]!, next)
									: top[items[at]!]! -
										top[next]! -
										layers.height[next]! -
										stackGap(layers, next, items[at]!);
							if (room < Math.abs(step) - 0.5) block.length = 0;
							break;
						}
						block.push(next);
					}
					if (block.length === 0) continue;
					const before = level(block);
					for (const moved of block) top[moved] = top[moved]! + step;
					if (level(block) > before) break;
					for (const moved of block) top[moved] = top[moved]! - step;
				}
			}
	return top;
}

/**
 * Which side each link leaves and reaches its tables by: the side facing the
 * other table, or, within a column or to its own table, the side where fewer
 * other lines leave the column between its two rows, since its loop crosses
 * each of them. A tie takes the column's outer side at the layout's edges,
 * otherwise the right.
 */
function linkSides(
	graph: Graph,
	column: readonly number[],
	columns: number,
	top: readonly number[],
): Map<string, { parent: ErSide; child: ErSide }> {
	const sides = new Map<string, { parent: ErSide; child: ErSide }>();
	const ends: { column: number; side: ErSide; y: number }[] = [];
	const loops: ErLayoutLink[] = [];
	for (const link of graph.links) {
		const [parent, child] = [graph.index.get(link.parent)!, graph.index.get(link.child)!];
		const [a, b] = [column[parent]!, column[child]!];
		if (a === b) {
			loops.push(link);
			continue;
		}
		const [parentSide, childSide]: [ErSide, ErSide] = a < b ? ["right", "left"] : ["left", "right"];
		sides.set(link.id, { parent: parentSide, child: childSide });
		ends.push({ column: a, side: parentSide, y: top[parent]! + link.parentY });
		ends.push({ column: b, side: childSide, y: top[child]! + link.childY });
	}
	for (const link of loops) {
		const [parent, child] = [graph.index.get(link.parent)!, graph.index.get(link.child)!];
		const at = column[parent]!;
		const [from, to] = [top[parent]! + link.parentY, top[child]! + link.childY];
		const [low, high] = [Math.min(from, to), Math.max(from, to)];
		const crossed = (side: ErSide) =>
			ends.filter((end) => end.column === at && end.side === side && end.y > low && end.y < high)
				.length;
		const outer: ErSide = at === 0 && columns > 1 ? "left" : "right";
		const [left, right] = [crossed("left"), crossed("right")];
		const side: ErSide = left === right ? outer : left < right ? "left" : "right";
		sides.set(link.id, { parent: side, child: side });
		ends.push({ column: at, side, y: from }, { column: at, side, y: to });
	}
	return sides;
}

/**
 * Each gap between columns, wide enough for the end runs (longer where lines
 * fan out of one row), a lane per line through it and any label beside it.
 */
function columnGaps(
	graph: Graph,
	column: readonly number[],
	sides: ReadonlyMap<string, { parent: ErSide; child: ErSide }>,
	columns: number,
	endRun: number,
): number[] {
	const lanes = Array.from({ length: Math.max(0, columns - 1) }, () => 0);
	const labels = Array.from({ length: Math.max(0, columns - 1) }, () => 0);
	// Lines out of each port, by the gap the port opens into and its side of the gap.
	const ports = new Map<string, { gap: number; low: boolean; count: number }>();
	const port = (node: number, side: ErSide, y: number) => {
		const gap = side === "right" ? column[node]! : column[node]! - 1;
		const key = `${node}:${side}:${y}`;
		const entry = ports.get(key) ?? { gap, low: side === "right", count: 0 };
		entry.count += 1;
		ports.set(key, entry);
	};
	for (const link of graph.links) {
		const [parent, child] = [graph.index.get(link.parent)!, graph.index.get(link.child)!];
		const [a, b] = [column[parent]!, column[child]!];
		const side = sides.get(link.id)!;
		port(parent, side.parent, link.parentY);
		port(child, side.child, link.childY);
		const parentGap = side.parent === "right" ? a : a - 1;
		if (link.labelWidth > 0 && parentGap >= 0 && parentGap < lanes.length)
			labels[parentGap] = Math.max(labels[parentGap]!, link.labelWidth + 16);
		if (a === b) {
			if (parentGap >= 0 && parentGap < lanes.length) lanes[parentGap]! += 1;
			continue;
		}
		for (let gap = Math.min(a, b); gap < Math.max(a, b); gap += 1) lanes[gap]! += 1;
	}
	const fans = lanes.map(() => ({ low: 0, high: 0 }));
	const fanOf = new Map<string, number>();
	for (const [key, { gap, low, count }] of ports) {
		const run = (count - 1) * ER_FAN_STEP;
		const side = key.split(":").slice(0, 2).join(":");
		fanOf.set(side, Math.max(fanOf.get(side) ?? 0, run));
		const fan = fans[gap];
		if (!fan) continue;
		if (low) fan.low = Math.max(fan.low, run);
		else fan.high = Math.max(fan.high, run);
	}
	// A loop within a column keeps room past both its tables and any fan beside them.
	for (const link of graph.links) {
		const [parent, child] = [graph.index.get(link.parent)!, graph.index.get(link.child)!];
		if (column[parent] !== column[child]) continue;
		const side = sides.get(link.id)!.parent;
		const gap = side === "right" ? column[parent]! : column[parent]! - 1;
		const fan = fans[gap];
		if (!fan) continue;
		const run =
			Math.max(fanOf.get(`${parent}:${side}`) ?? 0, fanOf.get(`${child}:${side}`) ?? 0) +
			ER_FAN_STEP +
			Math.abs(graph.tables[parent]!.width - graph.tables[child]!.width) / 2;
		if (side === "right") fan.low = Math.max(fan.low, run);
		else fan.high = Math.max(fan.high, run);
	}
	return lanes.map((count, gap) =>
		Math.max(
			MIN_COLUMN_GAP,
			2 * endRun + fans[gap]!.low + fans[gap]!.high + labels[gap]! + LANE * (count + 1),
		),
	);
}

/** Place every table: columns, order within them, rows aligned, and room between columns for the lines. */
export function placeErTables(
	tables: readonly ErLayoutTable[],
	links: readonly ErLayoutLink[],
	endRun: number,
	options: ErPlacementOptions = {},
): ErPlacement {
	const graph = graphOf(tables, links);
	const given = options.arrangement;
	const column = given ? [...given.column] : assignColumns(graph, options);
	const columns = Math.max(...column) + 1;
	const layers = layersOf(graph, column);
	const stack = given ? arranged(layers, given) : orderColumns(layers);
	const top = alignRows(layers, stack);
	const sides = linkSides(graph, column, columns, top);
	const gaps = columnGaps(graph, column, sides, columns, endRun);
	const widths = Array.from({ length: columns }, (_, at) =>
		Math.max(
			0,
			...stack.columns[at]!.flatMap((item) => (item < tables.length ? [tables[item]!.width] : [])),
		),
	);
	// A loop on the outer side of the first or last column needs room outside it.
	const outer = links.some((link) => {
		const at = column[graph.index.get(link.parent)!]!;
		return at === column[graph.index.get(link.child)!]! && (at === 0 || at === columns - 1);
	})
		? endRun + 2 * LANE
		: 0;
	const lefts: number[] = [];
	let x = outer;
	for (const [at, width] of widths.entries()) {
		lefts.push(x);
		x += width + (gaps[at] ?? 0);
	}
	const minTop = Math.min(...top.slice(0, tables.length));
	const boxes = new Map(
		tables.map((table, node) => {
			const at = column[node]!;
			return [
				table.id,
				{
					x: lefts[at]! + Math.round((widths[at]! - table.width) / 2),
					y: top[node]! - minTop,
					width: table.width,
					height: table.height,
				},
			] as const;
		}),
	);
	return { boxes, sides, arrangement: { column, stacks: stack.columns } };
}

/** The stack an earlier placement ordered, each column's items stacked afresh. */
function arranged(layers: Layers, arrangement: ErArrangement): Stack {
	const columns = arrangement.stacks.map((items) => [...items]);
	return {
		columns,
		top: stacked(layers, columns),
		crossings: orderCrossings(layers, stacked(layers, columns)),
	};
}
