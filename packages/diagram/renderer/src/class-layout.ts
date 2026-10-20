/**
 * Where a class diagram's boxes go. Classes stand in rows, every superclass
 * and interface in a row above the classes that extend or implement it, and
 * the other relationships run between neighbors in one row or between rows.
 * Each relationship end has a port of its own, and each line that steps
 * sideways between two rows does so on a track of its own in the channel
 * between them, so no two lines share a run.
 */
import { routingCorridorGap, routingQualityScale } from "@sketchi/diagram-core";

import type { GraphAnchor } from "./scene.js";

/** A class box to place: its size. */
export interface ClassLayoutBox {
	readonly id: string;
	readonly width: number;
	readonly height: number;
	/** Heights of the lines between its compartments, from its top; no port sits on one. */
	readonly dividers?: readonly number[];
}

/**
 * A relationship to place boxes for, drawn from `from` to `to`. A
 * generalization puts `to` (the superclass or interface) in a row above `from`.
 */
export interface ClassLayoutLink {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly generalization: boolean;
	/** A composition or aggregation: `from` is the whole, drawn above or beside its part. */
	readonly whole?: boolean;
	/** Widths of the labels each end carries beside its line; 0 without one. */
	readonly fromLabel: number;
	readonly toLabel: number;
	/** Width of the relationship's own name; 0 without one. */
	readonly label: number;
}

/** Choices behind one candidate placement; the renderer routes a few and keeps the best. */
export interface ClassPlacementOptions {
	/** Width over height to aim for; 1.6 when omitted. */
	readonly aspect?: number;
	/** Cost of a relationship between two rows instead of side by side in one. */
	readonly between?: number;
	/** Cost of a composition or aggregation whose whole stands below its part; none when omitted. */
	readonly wholeBelow?: number;
	/**
	 * Also move each superclass together with every class under it, so a whole
	 * hierarchy can step a row down beside another instead of sharing its rows.
	 */
	readonly hierarchies?: boolean;
}

export interface ClassPlacement {
	readonly boxes: ReadonlyMap<
		string,
		{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }
	>;
	/** Every relationship end, by `<id>:source` (its `from`) or `<id>:target` (its `to`). */
	readonly anchors: ReadonlyMap<string, GraphAnchor>;
	/** The row each box stands in, from the top. */
	readonly rows: ReadonlyMap<string, number>;
}

/**
 * Straight run every line keeps at each end: Excalidraw draws an open arrow
 * (25 units), a triangle (15) or a diamond (24) at full size on a last run of
 * 50 or more.
 */
export const CLASS_END_RUN = 50;
/** Room between neighboring boxes in a row. */
const BOX_GAP = 64;
/** Room a long relationship's corridor takes in a row it passes, and beside it. */
const CORRIDOR_WIDTH = 4;
const CORRIDOR_GAP = 30;
/** Distance between tracks in a channel, and between ports on one side. */
export const CLASS_TRACK_STEP = 28;
const PORT_STEP = 32;
/**
 * Room a port keeps beside it for its labels: past a label's width beside a
 * vertical run (its offset from the line and its clearance), or a label's
 * height above or below a horizontal one.
 */
const LABEL_ROOM = 14;
const LABEL_ROW = 26;
/** Height a channel adds above its tracks when a named line crosses it: a name on three lines. */
const NAME_ROOM = 54;
/** Ports keep this far from a side's corners, past the router's own port padding. */
const PORT_MARGIN = 18;
/** Lines of two neighboring rows keep this far apart across their channel, so none reads as the other. */
const LANE_CLEARANCE = 20;
/** Room past the reader's corridor gap, for the export's padding and labels the estimate leaves out. */
const LANE_MARGIN = 4;
/** No port sits nearer a compartment's divider than this, so no line reads as its continuation. */
const DIVIDER_CLEARANCE = 8;
/** A line between rows whose ends lie this close moves one end onto the other's line. */
const SNAP = 36;
/** Times a layout grows crowded boxes and runs again. */
const MAX_GROWTH = 2;
/** Run out of a box's side before a loop back to the same box turns. */
const LOOP_RUN = 40;
/** Distance between a loop's two ends: room inside it for a label at each. */
const LOOP_SPAN = 64;
/** Width over height the whole layout aims for. */
const TARGET_ASPECT = 1.6;
/** How much wider than its target a layout may run before its width costs anything. */
const WIDTH_ALLOWANCE = 1.2;
/** A gap between rows as the row search estimates it. */
const ESTIMATED_CHANNEL = 130;
/** Costs, in units of one ideal relationship. */
const PER_SKIPPED_ROW = 2.5;
const BETWEEN_ROWS = 0.3;
const CROWDED_ROW = 1.5;
const OVERFLOW = 1.5;
const MAX_ROUNDS = 40;
const ORDER_SWEEPS = 8;
const ALIGN_SWEEPS = 12;
/** Each box between two side-by-side ends costs as much as a crossing. */
const FLAT_BETWEEN = 1;
/** How strongly a corridor holds to a straight line. */
const CORRIDOR_WEIGHT = 4;
/** How much harder a generalization pulls its two classes into line than another relationship. */
const GENERALIZATION_WEIGHT = 3;

interface Graph {
	readonly boxes: readonly ClassLayoutBox[];
	readonly index: ReadonlyMap<string, number>;
	readonly links: readonly ClassLayoutLink[];
	/** Generalizations by box index: the superclass above, the subclass below. */
	readonly generalizations: readonly { readonly parent: number; readonly child: number }[];
	/** Every other relationship between two different boxes; `whole` when `a` holds `b`. */
	readonly others: readonly { readonly a: number; readonly b: number; readonly whole: boolean }[];
}

function graphOf(boxes: readonly ClassLayoutBox[], links: readonly ClassLayoutLink[]): Graph {
	const index = new Map(boxes.map((box, at) => [box.id, at]));
	const generalizations: { parent: number; child: number }[] = [];
	const others: { a: number; b: number; whole: boolean }[] = [];
	for (const link of links) {
		const [from, to] = [index.get(link.from)!, index.get(link.to)!];
		if (from === to) continue;
		if (link.generalization) generalizations.push({ parent: to, child: from });
		else others.push({ a: from, b: to, whole: link.whole === true });
	}
	return { boxes, index, links, generalizations, others };
}

interface Target {
	readonly width: number;
	readonly height: number;
	/** An average box's width with its gap, and height with its channel. */
	readonly column: number;
	readonly unit: number;
}

function targetFor(graph: Graph, aspect = TARGET_ASPECT): Target {
	const area = graph.boxes.reduce(
		(sum, box) => sum + (box.width + BOX_GAP) * (box.height + ESTIMATED_CHANNEL),
		0,
	);
	const widest = Math.max(...graph.boxes.map((box) => box.width));
	const height = Math.sqrt(area / aspect);
	const count = graph.boxes.length;
	return {
		width: Math.max(widest, WIDTH_ALLOWANCE * aspect * height),
		height,
		column: graph.boxes.reduce((sum, box) => sum + box.width + BOX_GAP, 0) / count,
		unit: graph.boxes.reduce((sum, box) => sum + box.height + ESTIMATED_CHANNEL, 0) / count,
	};
}

/** First guess: each class one row below its lowest superclass, superclasses just above their nearest subclass. */
function initialRows(graph: Graph): number[] {
	const n = graph.boxes.length;
	const parents = Array.from({ length: n }, () => [] as number[]);
	const children = Array.from({ length: n }, () => [] as number[]);
	for (const { parent, child } of graph.generalizations) {
		parents[child]!.push(parent);
		children[parent]!.push(child);
	}
	const row = Array.from({ length: n }, () => 0);
	const indegree = parents.map((list) => list.length);
	const queue = indegree.flatMap((count, node) => (count === 0 ? [node] : []));
	const order: number[] = [];
	while (queue.length > 0) {
		const node = queue.shift()!;
		order.push(node);
		for (const child of children[node]!) {
			row[child] = Math.max(row[child]!, row[node]! + 1);
			indegree[child]! -= 1;
			if (indegree[child] === 0) queue.push(child);
		}
	}
	for (const node of order.toReversed())
		if (children[node]!.length > 0)
			row[node] = Math.min(...children[node]!.map((child) => row[child]!)) - 1;
	// A class outside every hierarchy starts in the row of the class it links to most.
	const placed = new Set(graph.generalizations.flatMap(({ parent, child }) => [parent, child]));
	if (placed.size === 0 && graph.others.length > 0) placed.add(graph.others[0]!.a);
	for (let pass = 0; pass < n && placed.size < n; pass += 1)
		for (const { a, b } of graph.others) {
			if (placed.has(a) === placed.has(b)) continue;
			const [known, unknown] = placed.has(a) ? [a, b] : [b, a];
			row[unknown] = row[known]!;
			placed.add(unknown);
		}
	const lowest = Math.min(...row);
	return row.map((value) => value - lowest);
}

function rowCost(
	graph: Graph,
	row: readonly number[],
	target: Target,
	between: number,
	wholeBelow: number,
): number {
	let cost = 0;
	for (const { parent, child } of graph.generalizations) {
		const span = row[child]! - row[parent]!;
		if (span < 1) return Infinity;
		cost += PER_SKIPPED_ROW * (span - 1);
	}
	const flat = graph.boxes.map(() => 0);
	for (const { a, b, whole } of graph.others) {
		const span = Math.abs(row[a]! - row[b]!);
		if (span === 0) {
			flat[a]! += 1;
			flat[b]! += 1;
		} else cost += between + PER_SKIPPED_ROW * (span - 1);
		if (whole && row[a]! > row[b]!) cost += wholeBelow;
	}
	// A class has two sides for neighbors in its row; a third must reach around one,
	// and so must one link of a ring of neighbors, which a row lays out only as a line.
	for (const count of flat) cost += CROWDED_ROW * Math.max(0, count - 2);
	const joined = graph.boxes.map((_, node) => node);
	const root = (node: number): number =>
		joined[node] === node ? node : (joined[node] = root(joined[node]!));
	for (const { a, b } of graph.others) {
		if (row[a] !== row[b]) continue;
		const [p, q] = [root(a), root(b)];
		if (p === q) cost += CROWDED_ROW;
		else joined[p] = q;
	}
	const widths = new Map<number, number>();
	const heights = new Map<number, number>();
	for (const [node, box] of graph.boxes.entries()) {
		const at = row[node]!;
		widths.set(at, (widths.get(at) ?? -BOX_GAP) + box.width + BOX_GAP);
		heights.set(at, Math.max(heights.get(at) ?? 0, box.height));
	}
	for (const width of widths.values()) {
		const excess = Math.max(0, width - target.width) / target.column;
		cost += OVERFLOW * excess * excess;
	}
	const height =
		[...heights.values()].reduce((sum, value) => sum + value, 0) +
		ESTIMATED_CHANNEL * Math.max(0, heights.size - 1);
	const taller = Math.max(0, height - target.height * WIDTH_ALLOWANCE) / target.unit;
	return cost + OVERFLOW * taller * taller;
}

/** Rows numbered from 0 with none left empty, in their order. */
function compact(row: readonly number[]): number[] {
	const used = [...new Set(row)].sort((a, b) => a - b);
	const rank = new Map(used.map((value, at) => [value, at]));
	return row.map((value) => rank.get(value)!);
}

/** Move one class at a time to the row that lowers the cost most, until none does. */
function assignRows(graph: Graph, options: ClassPlacementOptions): number[] {
	const target = targetFor(graph, options.aspect);
	const between = options.between ?? BETWEEN_ROWS;
	const wholeBelow = options.wholeBelow ?? 0;
	const row = initialRows(graph);
	const neighbors = graph.boxes.map(() => new Set<number>());
	for (const { parent, child } of graph.generalizations) {
		neighbors[parent]!.add(child);
		neighbors[child]!.add(parent);
	}
	for (const { a, b } of graph.others) {
		neighbors[a]!.add(b);
		neighbors[b]!.add(a);
	}
	const visitOrder = graph.boxes
		.map((_, node) => node)
		.sort((a, b) => neighbors[b]!.size - neighbors[a]!.size || a - b);
	let cost = rowCost(graph, row, target, between, wholeBelow);
	const children = graph.boxes.map(() => [] as number[]);
	for (const { parent, child } of graph.generalizations) children[parent]!.push(child);
	const hierarchies = options.hierarchies
		? visitOrder.flatMap((node) => {
				if (children[node]!.length === 0) return [];
				const members = new Set([node]);
				for (const member of members) for (const child of children[member]!) members.add(child);
				return [[...members]];
			})
		: [];
	for (let round = 0; round < MAX_ROUNDS; round += 1) {
		let improved = false;
		for (const members of hierarchies)
			for (const delta of [-1, 1]) {
				for (const member of members) row[member]! += delta;
				const next = rowCost(graph, row, target, between, wholeBelow);
				if (next < cost - 1e-9) {
					cost = next;
					improved = true;
				} else for (const member of members) row[member]! -= delta;
			}
		for (const node of visitOrder) {
			const current = row[node]!;
			const candidates = new Set([current - 1, current + 1, current + 2]);
			for (const other of neighbors[node]!)
				for (const delta of [-1, 0, 1]) candidates.add(row[other]! + delta);
			if (neighbors[node]!.size === 0) for (const value of row) candidates.add(value);
			candidates.delete(current);
			let best = current;
			for (const candidate of [...candidates].sort((a, b) => a - b)) {
				row[node] = candidate;
				const next = rowCost(graph, row, target, between, wholeBelow);
				if (next < cost - 1e-9) [best, cost] = [candidate, next];
			}
			row[node] = best;
			if (best !== current) improved = true;
		}
		if (!improved) break;
	}
	return compact(row);
}

/**
 * What stands in the rows: the boxes and, for each relationship that skips a
 * row, a corridor in every row it passes, so its line runs straight down
 * between the boxes there.
 */
interface Layers {
	readonly row: readonly number[];
	readonly width: readonly number[];
	readonly corridor: readonly boolean[];
	/** Items joined across neighboring rows by a relationship or a stretch of one. */
	readonly segments: readonly {
		readonly upper: number;
		readonly lower: number;
		/** A generalization pulls its classes into line harder than other relationships. */
		readonly weight: number;
	}[];
	/** Relationships between two boxes of one row. */
	readonly flats: readonly { readonly a: number; readonly b: number }[];
	/** Each relationship's items from its `from` box to its `to` box, by link index. */
	readonly chains: readonly (readonly number[])[];
}

function layersOf(graph: Graph, row: readonly number[]): Layers {
	const rows = [...row];
	const width = graph.boxes.map((box) => box.width);
	const corridor = graph.boxes.map(() => false);
	const segments: { upper: number; lower: number; weight: number }[] = [];
	const flats: { a: number; b: number }[] = [];
	const chains: number[][] = [];
	for (const link of graph.links) {
		const [from, to] = [graph.index.get(link.from)!, graph.index.get(link.to)!];
		if (from === to) {
			chains.push([from]);
			continue;
		}
		const [a, b] = [row[from]!, row[to]!];
		if (a === b) {
			flats.push({ a: from, b: to });
			chains.push([from, to]);
			continue;
		}
		const step = Math.sign(b - a);
		const chain = [from];
		for (let at = a + step; at !== b; at += step) {
			const item = rows.length;
			rows.push(at);
			width.push(CORRIDOR_WIDTH);
			corridor.push(true);
			chain.push(item);
		}
		chain.push(to);
		const weight = link.generalization ? GENERALIZATION_WEIGHT : 1;
		for (const [index, item] of chain.slice(1).entries()) {
			const previous = chain[index]!;
			segments.push(
				rows[previous]! < rows[item]!
					? { upper: previous, lower: item, weight }
					: { upper: item, lower: previous, weight },
			);
		}
		chains.push(chain);
	}
	return { row: rows, width, corridor, segments, flats, chains };
}

/** Least room between two neighbors of one row: wide enough for the labels of a line between them. */
function gapBetween(
	layers: Layers,
	room: ReadonlyMap<string, number>,
	a: number,
	b: number,
): number {
	const corridors = [a, b].filter((item) => layers.corridor[item]).length;
	if (corridors === 2) return CLASS_TRACK_STEP;
	if (corridors === 1)
		return Math.max(CORRIDOR_GAP, room.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0);
	return Math.max(BOX_GAP, room.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0);
}

/**
 * Left edges of each item when its row is packed in order, gap apart, from 0.
 * Two boxes a line joins keep its room between them even with corridors between.
 */
function packOffsets(
	layers: Layers,
	room: ReadonlyMap<string, number>,
	items: readonly number[],
): number[] {
	const offsets: number[] = [];
	for (const [index, item] of items.entries()) {
		if (index === 0) {
			offsets.push(0);
			continue;
		}
		const previous = items[index - 1]!;
		let offset =
			offsets[index - 1]! + layers.width[previous]! + gapBetween(layers, room, previous, item);
		for (const [at, earlier] of items.slice(0, index - 1).entries()) {
			const need = room.get(earlier < item ? `${earlier}:${item}` : `${item}:${earlier}`);
			if (need !== undefined)
				offset = Math.max(offset, offsets[at]! + layers.width[earlier]! + need);
		}
		offsets.push(offset);
	}
	return offsets;
}

/** Each item's center when its row is packed in order and centered on 0. */
function packed(
	layers: Layers,
	room: ReadonlyMap<string, number>,
	rows: readonly (readonly number[])[],
): number[] {
	const center = layers.row.map(() => 0);
	for (const items of rows) {
		const offsets = packOffsets(layers, room, items);
		const total = items.length > 0 ? offsets.at(-1)! + layers.width[items.at(-1)!]! : 0;
		for (const [index, item] of items.entries())
			center[item] = offsets[index]! + layers.width[item]! / 2 - total / 2;
	}
	return center;
}

/**
 * Crossings between segments across each channel, each drawn straight from
 * center to center, plus each box standing between two side-by-side ends and
 * each pair of side-by-side links that interleave.
 */
function orderCrossings(
	layers: Layers,
	rows: readonly (readonly number[])[],
	center: readonly number[],
): number {
	const channels = new Map<number, { upper: number; lower: number }[]>();
	for (const { upper, lower } of layers.segments) {
		const list = channels.get(layers.row[upper]!) ?? [];
		list.push({ upper: center[upper]!, lower: center[lower]! });
		channels.set(layers.row[upper]!, list);
	}
	let crossings = 0;
	for (const list of channels.values())
		for (const [index, segment] of list.entries())
			for (const other of list.slice(index + 1))
				if ((segment.upper - other.upper) * (segment.lower - other.lower) < 0) crossings += 1;
	const position = new Map<number, number>();
	for (const items of rows) for (const [index, item] of items.entries()) position.set(item, index);
	const spans = layers.flats.map(({ a, b }) => {
		const [low, high] = [position.get(a)!, position.get(b)!].sort((p, q) => p - q) as [
			number,
			number,
		];
		return { row: layers.row[a]!, low, high };
	});
	for (const span of spans) {
		const items = rows[span.row]!;
		for (let at = span.low + 1; at < span.high; at += 1)
			if (!layers.corridor[items[at]!]) crossings += FLAT_BETWEEN;
	}
	for (const [index, span] of spans.entries())
		for (const other of spans.slice(index + 1))
			if (
				span.row === other.row &&
				((span.low < other.low && other.low < span.high && span.high < other.high) ||
					(other.low < span.low && span.low < other.high && other.high < span.high))
			)
				crossings += 1;
	return crossings;
}

/** Order each row by where its items' neighbors sit, keeping the order with the fewest crossings. */
function orderRows(layers: Layers, room: ReadonlyMap<string, number>): number[][] {
	const count = Math.max(...layers.row) + 1;
	let rows = Array.from({ length: count }, () => [] as number[]);
	for (const [item, at] of layers.row.entries()) rows[at]!.push(item);
	const around = layers.row.map(() => [] as { other: number; weight: number }[]);
	for (const { upper, lower } of layers.segments) {
		around[upper]!.push({ other: lower, weight: 1 });
		around[lower]!.push({ other: upper, weight: 1 });
	}
	for (const { a, b } of layers.flats) {
		around[a]!.push({ other: b, weight: 0.5 });
		around[b]!.push({ other: a, weight: 0.5 });
	}
	let center = packed(layers, room, rows);
	let best = {
		rows: rows.map((items) => [...items]),
		crossings: orderCrossings(layers, rows, center),
	};
	for (let sweep = 0; sweep < ORDER_SWEEPS && best.crossings > 0; sweep += 1) {
		const sequence = [...rows.keys()];
		if (sweep % 2 === 1) sequence.reverse();
		for (const at of sequence) {
			const key = new Map<number, number>();
			for (const item of rows[at]!) {
				let sum = 0;
				let weight = 0;
				for (const { other, weight: w } of around[item]!) {
					sum += w * center[other]!;
					weight += w;
				}
				key.set(item, weight > 0 ? sum / weight : center[item]!);
			}
			rows[at] = [...rows[at]!].sort(
				(a, b) => key.get(a)! - key.get(b)! || center[a]! - center[b]!,
			);
			center = packed(layers, room, rows);
		}
		const crossings = orderCrossings(layers, rows, center);
		if (crossings < best.crossings) best = { rows: rows.map((items) => [...items]), crossings };
	}
	rows = best.rows;
	// Corridors from a parent through the row of its other children spread evenly
	// among them, one to a gap, so each line below drops straight through its own gap.
	rows = rows.map((items) => {
		const parentOf = (item: number) =>
			layers.segments.find((segment) => segment.lower === item)?.upper;
		const groups = new Map<number, number[]>();
		for (const item of items) {
			const parent = parentOf(item);
			if (parent !== undefined) groups.set(parent, [...(groups.get(parent) ?? []), item]);
		}
		let reordered = items;
		for (const members of groups.values()) {
			const corridors = members.filter((item) => layers.corridor[item]);
			const children = members.filter((item) => !layers.corridor[item]);
			if (corridors.length === 0 || children.length < 2) continue;
			const spread: number[] = [];
			for (const [index, child] of children.entries()) {
				spread.push(child);
				const from = Math.round((index * corridors.length) / (children.length - 1));
				const to = Math.round(((index + 1) * corridors.length) / (children.length - 1));
				if (index < children.length - 1) spread.push(...corridors.slice(from, to));
			}
			const slots = reordered.flatMap((item, at) => (members.includes(item) ? [at] : []));
			const next = [...reordered];
			for (const [index, at] of slots.entries()) next[at] = spread[index]!;
			reordered = next;
		}
		return reordered;
	});
	const spreadRows = rows;
	rows = best.rows;
	if (
		orderCrossings(layers, spreadRows, packed(layers, room, spreadRows)) <=
		orderCrossings(layers, rows, packed(layers, room, rows))
	)
		rows = spreadRows;
	// Then swap neighbors while that removes crossings.
	let crossings = orderCrossings(layers, rows, packed(layers, room, rows));
	for (let improved = crossings > 0, round = 0; improved && round < MAX_ROUNDS; round += 1) {
		improved = false;
		for (const items of rows)
			for (let index = 0; index + 1 < items.length; index += 1) {
				[items[index], items[index + 1]] = [items[index + 1]!, items[index]!];
				const swapped = orderCrossings(layers, rows, packed(layers, room, rows));
				if (swapped < crossings) {
					crossings = swapped;
					improved = true;
				} else [items[index], items[index + 1]] = [items[index + 1]!, items[index]!];
			}
	}
	return rows;
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

/**
 * Slide items along their rows, keeping order and gaps, so each superclass
 * centers over its subclasses, each line between rows comes as near
 * vertical as the others allow, and each corridor runs straight.
 */
function alignColumns(
	layers: Layers,
	room: ReadonlyMap<string, number>,
	rows: readonly (readonly number[])[],
): number[] {
	const center = packed(layers, room, rows);
	const around = layers.row.map(() => [] as { other: number; weight: number }[]);
	for (const { upper, lower, weight } of layers.segments) {
		around[upper]!.push({ other: lower, weight });
		around[lower]!.push({ other: upper, weight });
	}
	for (let sweep = 0; sweep < ALIGN_SWEEPS; sweep += 1) {
		const sequence = [...rows.keys()];
		if (sweep % 2 === 1) sequence.reverse();
		for (const at of sequence) {
			const items = rows[at]!;
			if (items.length === 0) continue;
			const desired: number[] = [];
			const weights: number[] = [];
			for (const item of items) {
				const others = around[item]!;
				if (others.length === 0) {
					desired.push(center[item]!);
					weights.push(0.05);
					continue;
				}
				const total = others.reduce((sum, { weight }) => sum + weight, 0);
				desired.push(
					others.reduce((sum, { other, weight }) => sum + weight * center[other]!, 0) / total,
				);
				weights.push(layers.corridor[item] ? CORRIDOR_WEIGHT : total);
			}
			const offsets = packOffsets(layers, room, items);
			const fitted = isotonic(
				desired.map((value, index) => value - layers.width[items[index]!]! / 2 - offsets[index]!),
				weights,
			);
			for (const [index, item] of items.entries())
				center[item] = fitted[index]! + offsets[index]! + layers.width[item]! / 2;
		}
	}
	// Boxes at either end of a row with no line to another row close up on the
	// nearest box that has one, so a row never trails off past a gap it doesn't need.
	for (const items of rows) {
		const offsets = packOffsets(layers, room, items);
		const slack = (index: number) =>
			center[items[index]!]! - layers.width[items[index]!]! / 2 - offsets[index]!;
		const first = items.findIndex((item) => around[item]!.length > 0);
		const last = items.findLastIndex((item) => around[item]!.length > 0);
		if (first < 0) continue;
		for (const [index, item] of items.entries())
			if (index < first || index > last)
				center[item] =
					slack(index < first ? first : last) + offsets[index]! + layers.width[item]! / 2;
	}
	// Whole-unit left edges, so ports and their partners meet exactly.
	return center.map((value, item) => {
		const half = layers.width[item]! / 2;
		return Math.round(value - half) + half;
	});
}

type Side = GraphAnchor["side"];

/** One relationship end on its box: its side and its place along that side. */
interface End {
	readonly link: number;
	readonly end: "source" | "target";
	readonly box: number;
	side: Side;
	/** Along the side: x for the top and bottom, y for the left and right, from the box's corner. */
	at: number;
	/** The item this end's line heads to first: the partner box, or the corridor it passes. */
	readonly toward: number;
	loop: boolean;
	/** A loop's place among the loops on its side: each later one nests outside the earlier. */
	slot: number;
}

/**
 * Which side each end leaves its box by: down to a lower row and up to a
 * higher one, facing each other side by side in a row, around through the
 * channel above or below (whichever its line crosses fewer lines in) when
 * another box stands between them, and out and back on one side for a
 * relationship to its own class.
 */
function endsOf(
	graph: Graph,
	layers: Layers,
	rows: readonly (readonly number[])[],
	center: readonly number[],
): End[] {
	const position = new Map<number, number>();
	for (const items of rows) for (const [index, item] of items.entries()) position.set(item, index);
	const ends: End[] = [];
	const sideUse = new Map<string, number>();
	const countSide = (item: number, side: Side) =>
		sideUse.set(`${item}:${side}`, (sideUse.get(`${item}:${side}`) ?? 0) + 1);
	const loops: End[][] = [];
	const make = (link: number, end: "source" | "target", item: number, toward: number, side: Side) =>
		({ link, end, box: item, side, at: 0, toward, loop: false, slot: 0 }) satisfies End;
	// Lines reaching a row's boxes from the channel above or below it, at their centers.
	const crossed = (at: number, low: number, high: number, above: boolean) =>
		layers.segments.filter(({ upper, lower }) => {
			const item = above ? lower : upper;
			return layers.row[item] === at && center[item]! > low && center[item]! < high;
		}).length;
	for (const [index] of graph.links.entries()) {
		const chain = layers.chains[index]!;
		const [from, to] = [chain[0]!, chain.at(-1)!];
		if (from === to) {
			loops.push([
				make(index, "source", from, from, "right"),
				make(index, "target", to, to, "right"),
			]);
			continue;
		}
		if (layers.row[from] === layers.row[to]) {
			const [p, q] = [position.get(from)!, position.get(to)!];
			const at = layers.row[from]!;
			const items = rows[at]!;
			const between = items
				.slice(Math.min(p, q) + 1, Math.max(p, q))
				.some((item) => !layers.corridor[item]);
			let sides: [Side, Side] = p < q ? ["right", "left"] : ["left", "right"];
			if (between) {
				const [low, high] = [center[from]!, center[to]!].sort((a, b) => a - b) as [number, number];
				const [above, below] = [crossed(at, low, high, true), crossed(at, low, high, false)];
				const top = above < below || (above === below && at === 0);
				sides = top ? ["top", "top"] : ["bottom", "bottom"];
			}
			ends.push(
				make(index, "source", from, to, sides[0]),
				make(index, "target", to, from, sides[1]),
			);
			countSide(from, sides[0]);
			countSide(to, sides[1]);
			continue;
		}
		const down = layers.row[from]! < layers.row[to]!;
		ends.push(
			make(index, "source", from, chain[1]!, down ? "bottom" : "top"),
			make(index, "target", to, chain.at(-2)!, down ? "top" : "bottom"),
		);
	}
	// A loop goes out and back on a side of its box no other line uses: its right or
	// left, or over the top of the first row or under the last, where nothing runs.
	// Without one, it takes the right or left side fewer neighbors' lines use, so it
	// crosses none of them, and loops on one side nest.
	const nested = new Map<string, number>();
	const lastRow = rows.length - 1;
	for (const pair of loops) {
		const item = pair[0]!.box;
		const used = (side: Side) => ends.some((end) => end.box === item && end.side === side);
		const open = (["right", "left", "top", "bottom"] as const).filter(
			(side) =>
				!used(side) &&
				(side === "right" ||
					side === "left" ||
					(side === "top" ? layers.row[item] === 0 : layers.row[item] === lastRow)),
		);
		const side: Side =
			open[0] ??
			((sideUse.get(`${item}:right`) ?? 0) <= (sideUse.get(`${item}:left`) ?? 0)
				? "right"
				: "left");
		const slot = nested.get(`${item}:${side}`) ?? 0;
		nested.set(`${item}:${side}`, slot + 1);
		for (const end of pair) {
			end.side = side;
			end.loop = true;
			end.slot = slot;
		}
		ends.push(...pair);
	}
	return ends;
}

function partnerOf(ends: readonly End[], end: End): End {
	return ends.find((other) => other.link === end.link && other !== end)!;
}

const horizontal = (side: Side) => side === "top" || side === "bottom";

/**
 * How far apart neighboring lines stand: ports on one side, tracks in a
 * channel, and lines of two rows across their channel. Each is at least the
 * gap a reader tells two parallel lines apart by at the export's size.
 */
interface Spacing {
	readonly port: number;
	readonly track: number;
	readonly lane: number;
}

/**
 * Spread the ends on each side of each box, each at a port of its own, in
 * the order of where their lines head, and as near as that allows to the
 * point their line heads for, so lines between rows run straight where they
 * can. A line that would still jog a little runs straight when one end can
 * move onto the other's line, and no port sits on a compartment's divider.
 */
function placePorts(
	ends: readonly End[],
	center: readonly number[],
	box: (item: number) => ClassLayoutBox,
	labels: (end: End) => { readonly end: number; readonly name: number },
	rowOf: (item: number) => number,
	spacing: Spacing,
): void {
	const { port: portStep, lane: laneClearance } = spacing;
	const sides = new Map<string, End[]>();
	for (const end of ends) {
		const key = `${end.box}:${end.side}`;
		sides.set(key, [...(sides.get(key) ?? []), end]);
	}
	const left = (item: number) => center[item]! - box(item).width / 2;
	const lengthOf = (end: End) => (horizontal(end.side) ? box(end.box).width : box(end.box).height);
	// Neighboring ports keep a step apart and room between them for the labels
	// beside their lines: an end's multiplicity or role and, on a line between
	// rows, its name wrapped onto two lines. A side too short shares out what it has.
	const roomOf = (end: End) => {
		const { end: label, name } = labels(end);
		if (!horizontal(end.side)) return label > 0 ? LABEL_ROW : 0;
		// A name on two lines runs a word wider than half of it.
		const widest = Math.max(label, end.loop || name === 0 ? 0 : Math.ceil(name / 2) + LABEL_ROOM);
		return widest > 0 ? widest + LABEL_ROOM : 0;
	};
	const gapOf = (a: End, b: End) => {
		const [p, q] = [roomOf(a), roomOf(b)];
		return Math.max(portStep, p > 0 && q > 0 ? p + q : Math.max(p, q));
	};
	// A short side gives up label room first and keeps a full step between ports;
	// only when even the steps do not fit does it spread its ports evenly.
	const offsetsOf = (ordered: readonly End[]) => {
		const gaps = ordered.slice(1).map((end, index) => gapOf(ordered[index]!, end));
		const room = lengthOf(ordered[0]!) - 2 * PORT_MARGIN;
		const steps = gaps.length * portStep;
		const extra = gaps.reduce((sum, gap) => sum + gap - portStep, 0);
		const fitted =
			steps + extra <= room
				? gaps
				: steps <= room
					? gaps.map((gap) => portStep + ((gap - portStep) * (room - steps)) / extra)
					: gaps.map(() => room / gaps.length);
		const offsets = [0];
		for (const gap of fitted) offsets.push(offsets.at(-1)! + gap);
		return offsets;
	};
	// Heights on a side too near a divider of the end's box or, side by side, its partner's.
	const blocked = (end: End, at: number) => {
		if (horizontal(end.side)) return false;
		const partner = partnerOf(ends, end);
		const dividers = [
			...(box(end.box).dividers ?? []),
			...(partner.loop ? [] : (box(partner.box).dividers ?? [])),
		];
		return dividers.some((divider) => Math.abs(divider - at) < DIVIDER_CLEARANCE);
	};
	// The middle of the height two boxes side by side share, off their dividers.
	const clearMiddle = (end: End) => {
		const partner = partnerOf(ends, end);
		const height = end.loop
			? box(end.box).height
			: Math.min(box(end.box).height, box(partner.box).height);
		const middle = Math.round(height / 2);
		for (let shift = 0; shift < height / 2 - PORT_MARGIN; shift += 2)
			for (const at of [middle + shift, middle - shift]) if (!blocked(end, at)) return at;
		return middle;
	};
	// Where along a side a port wants to be: level with its partner, or above the corridor it heads for.
	const aim = (end: End): number => {
		const partner = partnerOf(ends, end);
		if (horizontal(end.side) && end.loop) {
			// Over or under its box, a loop's labels stand beside its two verticals, inside it.
			const span = Math.min(
				2 * Math.max(labels(end).end, labels(partner).end) +
					4 * PORT_MARGIN +
					2 * end.slot * portStep,
				box(end.box).width - 2 * PORT_MARGIN,
			);
			return box(end.box).width / 2 + ((end.end === "source" ? -1 : 1) * span) / 2;
		}
		if (horizontal(end.side)) {
			const x =
				partner.box === end.toward && !end.loop
					? left(partner.box) + partner.at
					: center[end.toward]!;
			return x - left(end.box);
		}
		if (end.loop) {
			const span = Math.min(
				LOOP_SPAN + 2 * end.slot * portStep,
				box(end.box).height - 2 * PORT_MARGIN,
			);
			return clearMiddle(end) + ((end.end === "source" ? -1 : 1) * span) / 2;
		}
		return partner.at;
	};
	for (const end of ends) end.at = horizontal(end.side) ? box(end.box).width / 2 : clearMiddle(end);
	for (let pass = 0; pass < 8; pass += 1) {
		let moved = false;
		for (const list of sides.values()) {
			const length = lengthOf(list[0]!);
			const desired = list.map(aim);
			const order = list
				.map((_, index) => index)
				.sort(
					(a, b) =>
						desired[a]! - desired[b]! ||
						list[a]!.link - list[b]!.link ||
						(list[a]!.end === "source" ? -1 : 1),
				);
			// Fit each port near its aim, in order and its room apart, inside the side's margins.
			const offsets = offsetsOf(order.map((index) => list[index]!));
			const fitted = isotonic(
				order.map((index, slot) => desired[index]! - offsets[slot]!),
				order.map(() => 1),
			);
			const span = offsets.at(-1) ?? 0;
			order.forEach((index, slot) => {
				const start = Math.min(Math.max(fitted[slot]!, PORT_MARGIN), length - PORT_MARGIN - span);
				const at = Math.round(start + offsets[slot]!);
				if (at !== list[index]!.at) moved = true;
				list[index]!.at = at;
			});
		}
		if (!moved) break;
	}
	// A port may move while it keeps its order and the room it has from each neighbor.
	const fits = (end: End, at: number) => {
		const list = sides.get(`${end.box}:${end.side}`)!;
		if (at < PORT_MARGIN || at > lengthOf(end) - PORT_MARGIN || blocked(end, at)) return false;
		return list.every(
			(other) =>
				other === end ||
				(Math.sign(other.at - end.at) === Math.sign(other.at - at) &&
					Math.abs(other.at - at) >=
						Math.min(gapOf(other, end), Math.abs(other.at - end.at)) - 0.5),
		);
	};
	// A line between rows that would jog a little runs straight instead.
	for (const end of ends) {
		if (end.end !== "source" || end.loop || !horizontal(end.side)) continue;
		const partner = partnerOf(ends, end);
		if (partner.box !== end.toward || !horizontal(partner.side) || partner.side === end.side)
			continue;
		const [x, y] = [left(end.box) + end.at, left(partner.box) + partner.at];
		if (Math.abs(x - y) < 0.5 || Math.abs(x - y) > 2 * SNAP) continue;
		if (fits(partner, Math.round(x - left(partner.box))))
			partner.at = Math.round(x - left(partner.box));
		else if (fits(end, Math.round(y - left(end.box)))) end.at = Math.round(y - left(end.box));
	}
	// A port under or near the bottom port of another line, in the row above, would
	// run along that line or hug it across the channel: it steps a clear lane aside.
	const xOf = (end: End) => left(end.box) + end.at;
	const facing = (end: End) =>
		ends.filter(
			(other) =>
				other.link !== end.link &&
				!other.loop &&
				other.side === (end.side === "top" ? "bottom" : "top") &&
				rowOf(other.box) === rowOf(end.box) + (end.side === "top" ? -1 : 1),
		);
	const clearOf = (end: End, at: number) =>
		facing(end).every((other) => Math.abs(xOf(other) - (left(end.box) + at)) >= laneClearance);
	// Move one port aside; failing that, slide every port of its side together.
	const separate = (end: End) => {
		for (let shift = 4; shift <= 3 * portStep; shift += 4) {
			const at = [end.at + shift, end.at - shift].find(
				(candidate) => fits(end, candidate) && clearOf(end, candidate),
			);
			if (at === undefined) continue;
			end.at = at;
			return true;
		}
		const side = sides.get(`${end.box}:${end.side}`)!;
		const length = lengthOf(end);
		for (let shift = 4; shift <= 3 * portStep; shift += 4)
			for (const delta of [shift, -shift]) {
				const moved = side.every(
					(other) =>
						other.at + delta >= PORT_MARGIN &&
						other.at + delta <= length - PORT_MARGIN &&
						(clearOf(other, other.at + delta) || !clearOf(other, other.at)),
				);
				if (!moved || !clearOf(end, end.at + delta)) continue;
				for (const other of side) other.at += delta;
				return true;
			}
		return false;
	};
	for (const end of ends) {
		if (end.loop || end.side !== "top") continue;
		const near = facing(end).filter((other) => Math.abs(xOf(other) - xOf(end)) < laneClearance);
		// Move this port, or else the ports above it that it hugs.
		if (near.length > 0 && !separate(end)) for (const other of near) separate(other);
	}
	// A port on a divider moves off it, its partner alongside when the two face each other level.
	for (const end of ends) {
		if (horizontal(end.side) || !blocked(end, end.at)) continue;
		const partner = partnerOf(ends, end);
		const level = !end.loop && partner.at === end.at;
		for (let shift = 2; shift <= 2 * DIVIDER_CLEARANCE; shift += 2) {
			const at = [end.at + shift, end.at - shift].find(
				(candidate) => fits(end, candidate) && (!level || fits(partner, candidate)),
			);
			if (at === undefined) continue;
			end.at = at;
			if (level) partner.at = at;
			break;
		}
	}
}

/** A line's sideways run in a channel between two rows: from its verticals above to those below. */
interface Jog {
	readonly ends: readonly End[];
	/** Verticals reaching the run from above and leaving it below. */
	readonly upper: readonly number[];
	readonly lower: readonly number[];
	readonly min: number;
	readonly max: number;
	track: number;
}

/** Crossings drawn when `a` runs on a track above `b`. */
function crossingsAbove(a: Jog, b: Jog): number {
	const within = (x: number, jog: Jog) => x > jog.min + 0.5 && x < jog.max - 0.5;
	// A vertical at the same place as another's would run along it: never let them meet.
	const along = (x: number, list: readonly number[]) => list.some((y) => Math.abs(x - y) < 0.5);
	let cost = 0;
	for (const x of b.upper) if (within(x, a)) cost += 1;
	for (const x of a.lower) if (within(x, b)) cost += 1;
	for (const x of a.lower) if (along(x, b.upper)) cost += 1000;
	return cost;
}

/**
 * Give each jog in a channel its track: in the order that crosses least
 * (each next the one whose run above all the rest crosses least), each
 * track below every overlapping one before it.
 */
function assignTracks(jogs: Jog[], step: number): number {
	const remaining = [...jogs];
	const order: Jog[] = [];
	while (remaining.length > 0) {
		let best = 0;
		let bestCost = Infinity;
		for (const [index, jog] of remaining.entries()) {
			const cost = remaining.reduce(
				(sum, other) => (other === jog ? sum : sum + crossingsAbove(jog, other)),
				0,
			);
			if (cost < bestCost) [best, bestCost] = [index, cost];
		}
		order.push(remaining.splice(best, 1)[0]!);
	}
	const overlaps = (a: Jog, b: Jog) => a.min < b.max + step && b.min < a.max + step;
	let tracks = 0;
	for (const [index, jog] of order.entries()) {
		jog.track = Math.max(
			0,
			...order
				.slice(0, index)
				.filter((other) => overlaps(other, jog) || crossingsAbove(jog, other) >= 1000)
				.map((other) => other.track + 1),
		);
		tracks = Math.max(tracks, jog.track + 1);
	}
	return tracks;
}

/**
 * Stand each long relationship's corridors on the line of one of its ports
 * when the rows it passes leave room there, so it runs straight from that end.
 */
function straightenCorridors(
	layers: Layers,
	room: ReadonlyMap<string, number>,
	rows: readonly (readonly number[])[],
	center: number[],
	ports: (link: number) => readonly number[],
	lanes: readonly { readonly link: number; readonly row: number; readonly x: number }[],
	spacing: Spacing,
): void {
	const position = new Map<number, number>();
	for (const items of rows) for (const [index, item] of items.entries()) position.set(item, index);
	const fits = (item: number, x: number) => {
		const items = rows[layers.row[item]!]!;
		const at = position.get(item)!;
		const [before, after] = [items[at - 1], items[at + 1]];
		const half = layers.width[item]! / 2;
		return (
			(before === undefined ||
				x - half >=
					center[before]! + layers.width[before]! / 2 + gapBetween(layers, room, before, item)) &&
			(after === undefined ||
				x + half <=
					center[after]! - layers.width[after]! / 2 - gapBetween(layers, room, item, after))
		);
	};
	for (const [link, chain] of layers.chains.entries()) {
		const corridors = chain.slice(1, -1);
		if (corridors.length === 0) continue;
		const target = ports(link).find((x) => corridors.every((item) => fits(item, x)));
		if (target !== undefined) for (const item of corridors) center[item] = target;
	}
	// A corridor near another line's port in the row above or below steps aside within its gap.
	for (const [link, chain] of layers.chains.entries())
		for (const item of chain.slice(1, -1)) {
			const row = layers.row[item]!;
			const near = (x: number) =>
				lanes.some(
					(lane) =>
						lane.link !== link &&
						(lane.row === row - 1 || lane.row === row + 1) &&
						Math.abs(lane.x - x) < spacing.lane,
				);
			if (!near(center[item]!)) continue;
			for (let shift = 4; shift <= 3 * spacing.port; shift += 4) {
				const x = [center[item]! + shift, center[item]! - shift].find(
					(candidate) => fits(item, candidate) && !near(candidate),
				);
				if (x === undefined) continue;
				center[item] = x;
				break;
			}
		}
}

/**
 * Place every class: rows, order within them, columns aligned, ports, and
 * channels for the lines. A box with more ends on a side than that side holds
 * a port step apart grows to hold them, and the layout runs again with it.
 */
export function placeClasses(
	boxes: readonly ClassLayoutBox[],
	links: readonly ClassLayoutLink[],
	options: ClassPlacementOptions = {},
	attempt = 0,
): ClassPlacement {
	const graph = graphOf(boxes, links);
	const row = assignRows(graph, options);
	const layers = layersOf(graph, row);
	// Room a line between two neighbors needs for its labels and heads.
	const room = new Map<string, number>();
	const widen = (a: number, b: number, need: number) => {
		const key = a < b ? `${a}:${b}` : `${b}:${a}`;
		room.set(key, Math.max(room.get(key) ?? 0, need));
	};
	for (const [index, link] of links.entries()) {
		const chain = layers.chains[index]!;
		const [from, to] = [chain[0]!, chain.at(-1)!];
		if (from === to || layers.row[from] !== layers.row[to]) continue;
		widen(
			from,
			to,
			Math.max(CLASS_END_RUN, link.fromLabel + 16) +
				(link.label > 0 ? link.label + 16 : 0) +
				Math.max(CLASS_END_RUN, link.toLabel + 16),
		);
	}
	const rows = orderRows(layers, room);
	// A corridor between two neighbors a line joins stands clear of the labels at both its ends.
	for (const [index, link] of links.entries()) {
		const chain = layers.chains[index]!;
		const [from, to] = [chain[0]!, chain.at(-1)!];
		if (from === to || layers.row[from] !== layers.row[to]) continue;
		const items = rows[layers.row[from]!]!;
		const [p, q] = [items.indexOf(from), items.indexOf(to)];
		const between = items.slice(Math.min(p, q) + 1, Math.max(p, q));
		if (between.length === 0 || between.some((item) => !layers.corridor[item])) continue;
		const [near, far] = p < q ? [from, to] : [to, from];
		const [nearLabel, farLabel] =
			p < q ? [link.fromLabel, link.toLabel] : [link.toLabel, link.fromLabel];
		widen(near, between[0]!, Math.max(CLASS_END_RUN, nearLabel + 16));
		widen(between.at(-1)!, far, Math.max(CLASS_END_RUN, farLabel + 16));
	}
	// A loop keeps room for its run and labels from the nearest box on each side,
	// past any corridor between them.
	const loopRun = (link: ClassLayoutLink) =>
		Math.max(LOOP_RUN, Math.max(link.fromLabel, link.toLabel) + 24);
	for (const [index, link] of links.entries()) {
		if (link.from !== link.to) continue;
		const item = layers.chains[index]![0]!;
		const items = rows[layers.row[item]!]!;
		const boxes = items.filter((other) => !layers.corridor[other]);
		const place = boxes.indexOf(item);
		const at = items.indexOf(item);
		const need = loopRun(link) + link.label + 2 * CLASS_TRACK_STEP + BOX_GAP;
		for (const other of [boxes[place - 1], boxes[place + 1], items[at - 1], items[at + 1]])
			if (other !== undefined) widen(item, other, need);
	}
	const center = alignColumns(layers, room, rows);
	const size = (item: number): ClassLayoutBox =>
		item < boxes.length ? boxes[item]! : { id: "", width: CORRIDOR_WIDTH, height: 0 };
	// Lines stand at least a reader's corridor gap apart at the size the layout will export at.
	const extent = {
		width:
			Math.max(...boxes.map((box, item) => center[item]! + box.width / 2)) -
			Math.min(...boxes.map((box, item) => center[item]! - box.width / 2)),
		height: rows.reduce(
			(sum, items) =>
				sum +
				Math.max(
					0,
					...items.filter((item) => item < boxes.length).map((item) => boxes[item]!.height),
				) +
				2 * CLASS_END_RUN +
				CLASS_TRACK_STEP,
			0,
		),
	};
	const gap = Math.ceil(routingCorridorGap(routingQualityScale(extent))) + LANE_MARGIN;
	const spacing: Spacing = {
		port: Math.max(PORT_STEP, gap),
		track: Math.max(CLASS_TRACK_STEP, gap),
		lane: Math.max(LANE_CLEARANCE, gap),
	};
	const ends = endsOf(graph, layers, rows, center);
	if (attempt < MAX_GROWTH) {
		const grown = boxes.map((box, item) => {
			const count = (side: Side) =>
				ends.filter((end) => end.box === item && end.side === side).length;
			const need = (side: Side) => 2 * PORT_MARGIN + Math.max(0, count(side) - 1) * spacing.port;
			const width = Math.ceil(Math.max(box.width, need("top"), need("bottom")));
			const height = Math.ceil(Math.max(box.height, need("left"), need("right")));
			return width === box.width && height === box.height ? box : { ...box, width, height };
		});
		if (grown.some((box, item) => box !== boxes[item]))
			return placeClasses(grown, links, options, attempt + 1);
	}
	const ports = () =>
		placePorts(
			ends,
			center,
			size,
			(end) => {
				const link = links[end.link]!;
				return { end: end.end === "source" ? link.fromLabel : link.toLabel, name: link.label };
			},
			(item) => layers.row[item]!,
			spacing,
		);
	ports();
	const left = (item: number) => center[item]! - size(item).width / 2;
	const portX = (end: End) => left(end.box) + end.at;
	const linkEnds = links.map((_, index) =>
		(["source", "target"] as const).map((key) =>
			ends.find((end) => end.link === index && end.end === key)!,
		),
	) as [End, End][];
	straightenCorridors(
		layers,
		room,
		rows,
		center,
		(link) => {
			const [source, target] = linkEnds[link]!;
			const upperFirst = layers.row[source.box]! < layers.row[target.box]!;
			return upperFirst ? [portX(source), portX(target)] : [portX(target), portX(source)];
		},
		ends.flatMap((end) =>
			horizontal(end.side) && !end.loop
				? [{ link: end.link, row: layers.row[end.box]!, x: portX(end) }]
				: [],
		),
		spacing,
	);
	// Ports then follow the corridors where they settled, so lines keep their order across rows.
	if (layers.corridor.some(Boolean)) ports();

	// Rows top-aligned; each channel holds its jogs' tracks between two end runs. Channel
	// `at` lies below row `at`; channel -1, above the first row, holds lines looping over it.
	const rowCount = rows.length;
	const rowHeight = rows.map((items) =>
		Math.max(0, ...items.filter((item) => item < boxes.length).map((item) => boxes[item]!.height)),
	);
	const channels = new Map<number, Jog[]>();
	const addJog = (at: number, jog: Jog) => channels.set(at, [...(channels.get(at) ?? []), jog]);
	for (const [index] of links.entries()) {
		const [source, target] = linkEnds[index]!;
		const chain = layers.chains[index]!;
		if (source.loop || source.side === "left" || source.side === "right") continue;
		if (source.side === target.side) {
			const [a, b] = [portX(source), portX(target)];
			const at = layers.row[chain[0]!]!;
			const over = source.side === "top";
			addJog(over ? at - 1 : at, {
				ends: [source, target],
				upper: over ? [] : [a, b],
				lower: over ? [a, b] : [],
				min: Math.min(a, b),
				max: Math.max(a, b),
				track: 0,
			});
			continue;
		}
		// Down the chain from its upper end: each stretch between neighboring rows.
		const items = layers.row[chain[0]!]! < layers.row[chain.at(-1)!]! ? chain : chain.toReversed();
		const [upperEnd, lowerEnd] = items[0] === chain[0] ? [source, target] : [target, source];
		for (const [at, item] of items.slice(1).entries()) {
			const previous = items[at]!;
			const top = previous === items[0] ? portX(upperEnd) : center[previous]!;
			const bottom = item === items.at(-1) ? portX(lowerEnd) : center[item]!;
			if (Math.abs(top - bottom) < 0.5) continue;
			addJog(layers.row[previous]!, {
				ends: [
					...(previous === items[0] ? [upperEnd] : []),
					...(item === items.at(-1) ? [lowerEnd] : []),
				],
				upper: [top],
				lower: [bottom],
				min: Math.min(top, bottom),
				max: Math.max(top, bottom),
				track: 0,
			});
		}
	}
	const tracks = new Map(
		[...channels].map(([at, jogs]) => [at, assignTracks(jogs, spacing.track)]),
	);
	// Channels a named line crosses, between rows or under or over one, hold room for its name.
	const named = new Set<number>();
	for (const [index, link] of links.entries()) {
		const [source, target] = linkEnds[index]!;
		if (link.label === 0 || source.loop || source.side === "left" || source.side === "right")
			continue;
		const [a, b] = [layers.row[source.box]!, layers.row[target.box]!];
		if (source.side === target.side) named.add(source.side === "top" ? a - 1 : a);
		else for (let at = Math.min(a, b); at < Math.max(a, b); at += 1) named.add(at);
	}
	const extra = (at: number) => (named.has(at) ? NAME_ROOM : 0);
	const channelHeight = (at: number) =>
		2 * CLASS_END_RUN + extra(at) + Math.max(0, (tracks.get(at) ?? 0) - 1) * spacing.track;
	const rowTop: number[] = [];
	let y = tracks.has(-1) ? channelHeight(-1) : 0;
	for (let at = 0; at < rowCount; at += 1) {
		rowTop.push(y);
		y += rowHeight[at]! + channelHeight(at);
	}
	const rowBottom = (at: number) => (at < 0 ? 0 : rowTop[at]! + rowHeight[at]!);
	const trackY = (at: number, track: number) =>
		rowBottom(at) + CLASS_END_RUN + extra(at) + track * spacing.track;

	const minX = Math.min(...boxes.map((_, item) => left(item)));
	const placed = new Map(
		boxes.map((box, item) => [
			box.id,
			{
				x: Math.round(left(item) - minX),
				y: rowTop[layers.row[item]!]!,
				width: box.width,
				height: box.height,
			},
		]),
	);
	const runs = new Map<End, number>();
	for (const [at, jogs] of channels)
		for (const jog of jogs)
			for (const end of jog.ends) {
				const position = placed.get(boxes[end.box]!.id)!;
				const edge = end.side === "bottom" ? position.y + position.height : position.y;
				runs.set(end, Math.abs(trackY(at, jog.track) - edge));
			}
	// Loops on one side nest, the later outside the earlier.
	for (const end of ends) {
		if (!end.loop) continue;
		const outer = ends
			.filter(
				(other) =>
					other.loop && other.box === end.box && other.side === end.side && other.slot < end.slot,
			)
			.reduce((widest, other) => Math.max(widest, loopRun(links[other.link]!)), 0);
		runs.set(end, Math.max(loopRun(links[end.link]!), outer + spacing.track));
	}
	const anchors = new Map<string, GraphAnchor>(
		ends.map((end) => {
			const box = boxes[end.box]!;
			const along = horizontal(end.side) ? box.width : box.height;
			const run = runs.get(end);
			return [
				`${links[end.link]!.id}:${end.end}`,
				{ side: end.side, offset: end.at - along / 2, ...(run === undefined ? {} : { run }) },
			] as const;
		}),
	);
	return {
		boxes: placed,
		anchors,
		rows: new Map(boxes.map((box, item) => [box.id, layers.row[item]!])),
	};
}
