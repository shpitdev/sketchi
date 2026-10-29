import {
	estimateTextWidth,
	sankeyColumns,
	sankeyNodeTotals,
	wrapTextToWidth,
	type SankeyDiagram,
} from "@sketchi/diagram-core";

import { formatValue, unitParts } from "./chart-scale.js";

/** Categorical colors in fixed order, shared with charts: adjacent pairs stay apart for color-vision deficiencies. */
const SANKEY_COLORS = [
	"#2a78d6",
	"#eb6834",
	"#1baf7a",
	"#eda100",
	"#e87ba4",
	"#008300",
	"#6250d6",
	"#e34948",
] as const;

/** Bars of nodes nothing flows out of: their flows already carry their sources' colors. */
export const SANKEY_SINK_COLOR = "#8c826f";
export const SANKEY_NODE_WIDTH = 14;
export const SANKEY_LABEL_FONT = 14;
export const SANKEY_VALUE_FONT = 12;
export const SANKEY_LINE_HEIGHT = 1.35;
/** Least vertical gap between two bars (or a bar and a band passing through) in one column. */
const NODE_GAP = 22;
/** Labels sit this far from the bar or band edge they describe. */
const LABEL_GAP = 6;
/** Two labels in one column stay this far apart. */
const LABEL_CLEAR = 4;
const LABEL_MAX_WIDTH = 170;
const VALUE_MAX_WIDTH = 140;
/** Least horizontal run of a band's curve between its straight leads. */
const CURVE_RUN = 120;
const CURVE_MAX_RUN = 340;
/** A curve runs at least this many times as far as its steepest band climbs. */
const CURVE_SLOPE = 0.7;
/** Room the title takes above the flow, for the aspect estimate. */
const HEADER_HEIGHT = 60;
/** A flow too small to see draws at least this wide, and its value is always written. */
export const SANKEY_MIN_BAND = 3;
/** The tallest column's flow spans this much, more when the diagram would read too wide. */
const BASE_FLOW_HEIGHT = 360;
const MAX_FLOW_HEIGHT = 1_400;
/** A diagram with crowded values grows taller by this factor, up to a few times. */
const CROWD_GROWTH = 1.4;
const CROWD_RETRIES = 3;
const CROWD_MAX_FLOW_HEIGHT = 1_100;
/** Growing stops before the diagram stands taller than this many times its width. */
const CROWD_MAX_TALL = 1.25;
/** The last-resort search for a value's spot tries at most about this many places. */
const GRID_SPOTS = 2_500;
/** A reflow widens the gaps between columns by this much and may grow this tall. */
const REFLOW_SPREAD = 1.8;
const REFLOW_MAX_TALL = 3;
const REFLOW_MAX_FLOW_HEIGHT = 2_400;
/** Widest aspect the layout aims for before growing taller. */
const TARGET_ASPECT = 2.2;
/** How far a crowded value may move from its band, in steps, on a leader. */
const LEADER_RADII = [26, 40, 56, 76, 100, 130, 170, 220, 300] as const;
/** A ribbon polygon keeps under the canvas point limit. */
const MAX_RIBBON_POINTS = 250;
const ORDER_SWEEPS = 12;
/** Passes moving each item to its best place in its column, while one helps. */
const SIFT_PASSES = 8;
const RELAX_ITERATIONS = 24;
/** Pair comparisons the ordering may spend before it settles on its best order. */
const ORDER_WORK_BUDGET = 4_000_000;

export interface SankeyBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface SankeyText {
	readonly text: string;
	readonly fontSize: number;
	readonly width: number;
	readonly height: number;
	readonly align: "left" | "right" | "center";
	readonly box: SankeyBox;
}

export interface SankeyLayoutNode {
	readonly id: string;
	readonly label: string;
	readonly color: string;
	readonly column: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly inflow: number;
	readonly outflow: number;
	readonly total: number;
	readonly text: SankeyText;
}

export interface SankeyLayoutBand {
	/** The link's index in the diagram. */
	readonly index: number;
	readonly source: string;
	readonly target: string;
	readonly value: number;
	/** Drawn thickness, the same at both ends and along every column it passes. */
	readonly width: number;
	readonly color: string;
	/** Top of the band where it leaves its source and where it enters its target. */
	readonly sourceTop: number;
	readonly targetTop: number;
	/** Closed outline: the top edge from source to target, then the bottom edge back. */
	readonly points: readonly { readonly x: number; readonly y: number }[];
	/** The flow's value, under its label when it has one. */
	readonly text: SankeyText;
	/** A leader from the band to its value, when no clear spot sits beside the band. */
	readonly leader?: readonly [Point, Point];
}

export interface SankeyLayout {
	readonly nodes: readonly SankeyLayoutNode[];
	readonly bands: readonly SankeyLayoutBand[];
	readonly columns: number;
	/** Pairs of bands that cross, counted between each pair of adjacent columns. */
	readonly crossings: number;
	/** The sum over those pairs of the product of their values. */
	readonly weightedCrossings: number;
	/** Deterministic work spent ordering nodes, in pair comparisons. */
	readonly work: number;
	/** Flow values that sit away from their band on a leader. */
	readonly crowdedValues: number;
	/**
	 * Flow values that found no clear spot even after a reflow, drawn over other marks.
	 * A diagram with any does not read; callers reject it.
	 */
	readonly unplacedValues: number;
}

export interface SankeyLayoutOptions {
	/** "authored" keeps each column in input order: the baseline the optimized order must match or beat. */
	readonly ordering?: "optimized" | "authored";
}

interface Item {
	readonly key: string;
	readonly node?: string;
	readonly column: number;
	height: number;
	y: number;
	/** How far the item's label reaches past its bar above and below. */
	overhang: number;
}

interface Segment {
	readonly link: number;
	readonly from: Item;
	readonly to: Item;
	/** The link's value: what a crossing weighs. */
	readonly value: number;
	width: number;
}

function measure(text: string, fontSize: number, maxWidth: number) {
	const wrapped = wrapTextToWidth(text, maxWidth, fontSize);
	const lines = wrapped.split("\n");
	return {
		text: wrapped,
		width: Math.ceil(Math.max(...lines.map((line) => estimateTextWidth(line, fontSize)))),
		height: Math.ceil(lines.length * fontSize * SANKEY_LINE_HEIGHT),
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export function sankeyBoxesOverlap(a: SankeyBox, b: SankeyBox, gap = 0): boolean {
	return (
		a.left < b.right + gap &&
		b.left < a.right + gap &&
		a.top < b.bottom + gap &&
		b.top < a.bottom + gap
	);
}

export type Point = { readonly x: number; readonly y: number };

/** Whether a segment passes through a box's interior. */
export function segmentMeetsBox(from: Point, to: Point, box: SankeyBox): boolean {
	let low = 0;
	let high = 1;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	for (const [p, q] of [
		[-dx, from.x - box.left],
		[dx, box.right - from.x],
		[-dy, from.y - box.top],
		[dy, box.bottom - from.y],
	] as const) {
		if (Math.abs(p) < 1e-9) {
			if (q <= 0) return false;
			continue;
		}
		const r = q / p;
		if (p < 0) low = Math.max(low, r);
		else high = Math.min(high, r);
		if (low >= high) return false;
	}
	return high - low > 1e-6;
}

/** Whether a segment enters a polygon: crosses its outline or starts or ends inside it. */
export function segmentMeetsPolygon(
	from: Point,
	to: Point,
	polygon: readonly Point[],
	bounds: SankeyBox = polygonBounds(polygon),
): boolean {
	if (
		!segmentMeetsBox(from, to, {
			left: bounds.left - 0.01,
			top: bounds.top - 0.01,
			right: bounds.right + 0.01,
			bottom: bounds.bottom + 0.01,
		})
	)
		return false;
	if (sankeyPointInPolygon(from, polygon) || sankeyPointInPolygon(to, polygon)) return true;
	for (let index = 0; index < polygon.length; index += 1)
		if (segmentsIntersect(from, to, polygon[index]!, polygon[(index + 1) % polygon.length]!))
			return true;
	return false;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
	const cross = (p: Point, q: Point, r: Point) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function sankeyPointInPolygon(point: Point, polygon: readonly Point[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
		const a = polygon[i]!;
		const b = polygon[j]!;
		if (
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
		)
			inside = !inside;
	}
	return inside;
}

/** Whether a box's interior meets a polygon's interior (touching edges do not count). */
export function sankeyBoxMeetsPolygon(
	box: SankeyBox,
	polygon: readonly Point[],
	bounds: SankeyBox = polygonBounds(polygon),
): boolean {
	if (!sankeyBoxesOverlap(box, bounds)) return false;
	const inner = {
		left: box.left + 0.01,
		top: box.top + 0.01,
		right: box.right - 0.01,
		bottom: box.bottom - 0.01,
	};
	if (inner.left >= inner.right || inner.top >= inner.bottom) return false;
	const corners = [
		{ x: inner.left, y: inner.top },
		{ x: inner.right, y: inner.top },
		{ x: inner.right, y: inner.bottom },
		{ x: inner.left, y: inner.bottom },
	];
	if (corners.some((corner) => sankeyPointInPolygon(corner, polygon))) return true;
	for (let i = 0; i < polygon.length; i += 1) {
		const a = polygon[i]!;
		const b = polygon[(i + 1) % polygon.length]!;
		if (a.x > inner.left && a.x < inner.right && a.y > inner.top && a.y < inner.bottom) return true;
		if (Math.max(a.x, b.x) <= inner.left || Math.min(a.x, b.x) >= inner.right) continue;
		if (Math.max(a.y, b.y) <= inner.top || Math.min(a.y, b.y) >= inner.bottom) continue;
		for (let edge = 0; edge < 4; edge += 1)
			if (segmentsIntersect(a, b, corners[edge]!, corners[(edge + 1) % 4]!)) return true;
	}
	return false;
}

export function polygonBounds(points: readonly Point[]): SankeyBox {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const point of points) {
		left = Math.min(left, point.x);
		right = Math.max(right, point.x);
		top = Math.min(top, point.y);
		bottom = Math.max(bottom, point.y);
	}
	return { left, top, right, bottom };
}

/** The point at t along a band edge's curve: horizontal at both ends, as Sankey links are drawn. */
function curvePoint(x0: number, y0: number, x1: number, y1: number, t: number): Point {
	const xm = (x0 + x1) / 2;
	const u = 1 - t;
	return {
		x: u * u * u * x0 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x1,
		y: y0 + (y1 - y0) * (3 * t * t - 2 * t * t * t),
	};
}

/** The y of a band edge's curve at `x`, clamped to its straight leads outside it. */
function curveYAt(x0: number, y0: number, x1: number, y1: number, x: number): number {
	if (x <= x0) return y0;
	if (x >= x1) return y1;
	let low = 0;
	let high = 1;
	for (let step = 0; step < 24; step += 1) {
		const middle = (low + high) / 2;
		if (curvePoint(x0, y0, x1, y1, middle).x < x) low = middle;
		else high = middle;
	}
	return curvePoint(x0, y0, x1, y1, (low + high) / 2).y;
}

interface CrossingScore {
	readonly count: number;
	/** The sum over crossing pairs of the product of their values: what a reader sees. */
	readonly weighted: number;
}

/**
 * Pairs of segments in one gap that cross: their ends sit in opposite orders.
 * Each pair weighs the product of its values, so two wide bands crossing cost
 * far more than two slivers.
 */
function gapCrossings(segments: readonly Segment[], position: ReadonlyMap<Item, number>) {
	let count = 0;
	let weighted = 0;
	for (let i = 0; i < segments.length; i += 1) {
		const a = segments[i]!;
		const af = position.get(a.from)!;
		const at = position.get(a.to)!;
		for (let j = i + 1; j < segments.length; j += 1) {
			const b = segments[j]!;
			if (a.from === b.from || a.to === b.to) continue;
			if ((af - position.get(b.from)!) * (at - position.get(b.to)!) < 0) {
				count += 1;
				weighted += a.value * b.value;
			}
		}
	}
	return { count, weighted, work: (segments.length * (segments.length - 1)) / 2 };
}

/** A node's label as drawn, before wrapping: its name over its total, in the diagram's unit. */
export function sankeyNodeText(
	diagram: Pick<SankeyDiagram, "unit">,
	label: string,
	total: number,
): string {
	return `${label}\n${formatValue(total, unitParts(diagram.unit))}`;
}

/**
 * A flow's text as drawn, before wrapping: its value under its label when it
 * has one. A word unit ("visits") reads once on each total, so flow values
 * stay bare beside them; symbols and scale letters stay ($310k, 12%).
 */
export function sankeyFlowText(
	diagram: Pick<SankeyDiagram, "unit">,
	link: Pick<SankeyDiagram["links"][number], "label" | "value">,
): string {
	const parts = unitParts(diagram.unit);
	const value = formatValue(
		link.value,
		parts.suffix.startsWith(" ") ? { ...parts, suffix: "" } : parts,
	);
	return link.label === undefined ? value : `${link.label}\n${value}`;
}

/** Lay out a Sankey diagram: columns, bars, bands and every label, in absolute coordinates. */
export function layoutSankeyDiagram(
	diagram: SankeyDiagram,
	options: SankeyLayoutOptions = {},
): SankeyLayout {
	const totals = sankeyNodeTotals(diagram);
	const columnOf = sankeyColumns(diagram);
	const columns = Math.max(...columnOf.values()) + 1;
	// Palette colors go to nodes with outflow, column by column, so the sources whose
	// bands meet take distinct colors first; a node nothing leaves draws in neutral gray.
	const sources = new Set(diagram.links.map((link) => link.source));
	const colorOf = new Map<string, string>(
		diagram.nodes
			.filter((node) => sources.has(node.id))
			.map((node, index) => ({ node, index }))
			.toSorted((a, b) => columnOf.get(a.node.id)! - columnOf.get(b.node.id)! || a.index - b.index)
			.map(({ node }, rank) => [node.id, SANKEY_COLORS[rank % SANKEY_COLORS.length]!]),
	);
	for (const node of diagram.nodes)
		colorOf.set(node.id, node.color ?? colorOf.get(node.id) ?? SANKEY_SINK_COLOR);
	const labelOf = new Map(
		diagram.nodes.map((node) => [
			node.id,
			measure(
				sankeyNodeText(diagram, node.label, totals.get(node.id)!.total),
				SANKEY_LABEL_FONT,
				LABEL_MAX_WIDTH,
			),
		]),
	);
	// Every flow writes its value (and label), however small its band.
	const flowText = diagram.links.map((link) =>
		measure(sankeyFlowText(diagram, link), SANKEY_VALUE_FONT, VALUE_MAX_WIDTH),
	);

	// Items: every node, plus one pass-through slot in each column a long flow crosses.
	const items: Item[][] = Array.from({ length: columns }, () => []);
	const nodeItem = new Map<string, Item>();
	for (const node of diagram.nodes) {
		const item: Item = {
			key: node.id,
			node: node.id,
			column: columnOf.get(node.id)!,
			height: 0,
			y: 0,
			overhang: 0,
		};
		nodeItem.set(node.id, item);
		items[item.column]!.push(item);
	}
	const segments: Segment[] = [];
	const chains: Segment[][] = diagram.links.map((link, index) => {
		const chain: Segment[] = [];
		let from = nodeItem.get(link.source)!;
		const last = nodeItem.get(link.target)!;
		for (let column = from.column + 1; column < last.column; column += 1) {
			const through: Item = { key: `~${index}:${column}`, column, height: 0, y: 0, overhang: 0 };
			items[column]!.push(through);
			chain.push({ link: index, from, to: through, value: link.value, width: 0 });
			from = through;
		}
		chain.push({ link: index, from, to: last, value: link.value, width: 0 });
		segments.push(...chain);
		return chain;
	});
	const segmentsInto = new Map<Item, Segment[]>();
	const segmentsOutOf = new Map<Item, Segment[]>();
	for (const segment of segments) {
		segmentsOutOf.set(segment.from, [...(segmentsOutOf.get(segment.from) ?? []), segment]);
		segmentsInto.set(segment.to, [...(segmentsInto.get(segment.to) ?? []), segment]);
	}
	const gapSegments = Array.from({ length: Math.max(0, columns - 1) }, (_, gap) =>
		segments.filter((segment) => segment.from.column === gap),
	);

	const gapBetween = (a: Item, b: Item) =>
		Math.max(NODE_GAP, a.overhang + b.overhang + LABEL_CLEAR);
	const columnHeight = (column: readonly Item[]) =>
		column.reduce(
			(sum, item, index) =>
				sum + item.height + (index > 0 ? gapBetween(column[index - 1]!, item) : 0),
			0,
		);

	/** Size every band and bar for `scale` pixels per unit of value. */
	const size = (scale: number) => {
		for (const segment of segments)
			segment.width = Math.max(diagram.links[segment.link]!.value * scale, SANKEY_MIN_BAND);
		for (const column of items)
			for (const item of column) {
				const sum = (list: readonly Segment[] | undefined) =>
					(list ?? []).reduce((total, segment) => total + segment.width, 0);
				item.height = Math.max(sum(segmentsInto.get(item)), sum(segmentsOutOf.get(item)));
				const label = item.node === undefined ? undefined : labelOf.get(item.node);
				item.overhang = label ? Math.max(0, (label.height - item.height) / 2) : 0;
			}
	};

	// Order each column so as little band weight crosses as possible: barycenter sweeps,
	// then moving each item to its best place in its column, keeping the authored order
	// whenever nothing beats it. Crossing count breaks ties.
	let work = 0;
	const positions = () => {
		const position = new Map<Item, number>();
		for (const column of items) column.forEach((item, index) => position.set(item, index));
		return position;
	};
	const scoreGaps = (gaps: readonly number[]): CrossingScore => {
		const position = positions();
		let count = 0;
		let weighted = 0;
		for (const gap of gaps) {
			const result = gapCrossings(gapSegments[gap]!, position);
			count += result.count;
			weighted += result.weighted;
			work += result.work;
		}
		return { count, weighted };
	};
	const allGaps = gapSegments.map((_, gap) => gap);
	const score = () => scoreGaps(allGaps);
	// Scores compare relative to their own size: weights scale with the square of the
	// values, so an absolute tolerance would let the unit decide the order.
	const better = (a: CrossingScore, b: CrossingScore) => {
		const tolerance = 1e-9 * Math.max(Math.abs(a.weighted), Math.abs(b.weighted));
		return (
			a.weighted < b.weighted - tolerance ||
			(Math.abs(a.weighted - b.weighted) <= tolerance && a.count < b.count)
		);
	};
	size(1);
	if (options.ordering !== "authored") {
		let best = items.map((column) => [...column]);
		let bestScore = score();
		const centers = (column: readonly Item[]) => {
			const center = new Map<Item, number>();
			let y = 0;
			for (const item of column) {
				center.set(item, y + item.height / 2);
				y += item.height + NODE_GAP;
			}
			return center;
		};
		const reorder = (column: number, side: "in" | "out") => {
			const other = centers(items[side === "in" ? column - 1 : column + 1]!);
			const own = centers(items[column]!);
			const key = new Map(
				items[column]!.map((item) => {
					const list = (side === "in" ? segmentsInto : segmentsOutOf).get(item) ?? [];
					const weight = list.reduce((sum, segment) => sum + segment.value, 0);
					if (weight === 0) return [item, own.get(item)!] as const;
					const sum = list.reduce(
						(total, segment) =>
							total + segment.value * other.get(side === "in" ? segment.from : segment.to)!,
						0,
					);
					return [item, sum / weight] as const;
				}),
			);
			items[column]!.sort((a, b) => key.get(a)! - key.get(b)!);
		};
		const snapshot = () => items.map((column) => [...column]);
		const restore = (order: readonly Item[][]) =>
			items.splice(0, items.length, ...order.map((column) => [...column]));
		/** Barycenter sweeps from the current order; the best order they pass through. */
		const sweeps = () => {
			let found = snapshot();
			let foundScore = score();
			for (let sweep = 0; sweep < ORDER_SWEEPS && work < ORDER_WORK_BUDGET; sweep += 1) {
				for (let column = 1; column < columns; column += 1) reorder(column, "in");
				for (let column = columns - 2; column >= 0; column -= 1) reorder(column, "out");
				const current = score();
				if (better(current, foundScore)) {
					foundScore = current;
					found = snapshot();
				}
			}
			return found;
		};
		// Move each item to the place in its column where the least weight crosses, while
		// a move helps; an adjacent swap is the smallest such move.
		const sift = () => {
			for (let pass = 0, improved = true; improved && pass < SIFT_PASSES; pass += 1) {
				improved = false;
				for (const [column, list] of items.entries()) {
					const gaps = [column - 1, column].filter((gap) => gap >= 0 && gap < gapSegments.length);
					for (const item of [...list]) {
						if (work >= ORDER_WORK_BUDGET) break;
						const from = list.indexOf(item);
						let place = from;
						let placeScore = scoreGaps(gaps);
						list.splice(from, 1);
						for (let index = 0; index <= list.length; index += 1) {
							if (index === from) continue;
							list.splice(index, 0, item);
							const moved = scoreGaps(gaps);
							list.splice(index, 1);
							if (better(moved, placeScore)) {
								place = index;
								placeScore = moved;
							}
						}
						list.splice(place, 0, item);
						if (place !== from) improved = true;
					}
				}
			}
			return score();
		};
		// Local search finds local optima, so it starts from several orders: the authored
		// one, the barycenter sweeps' best, and the sweeps' best from the reversed authored
		// order. The lightest result wins.
		const authored = snapshot();
		const starts = [authored, sweeps()];
		restore(authored.map((column) => column.toReversed()));
		starts.push(sweeps());
		for (const start of starts) {
			if (work >= ORDER_WORK_BUDGET) break;
			restore(start);
			const sifted = sift();
			if (better(sifted, bestScore)) {
				bestScore = sifted;
				best = snapshot();
			}
		}
		restore(best);
	}
	const { count: crossings, weighted: weightedCrossings } = score();

	// Horizontal plan: labels left of the first column and right of the last; a middle
	// column's labels ride its bands' straight leads out; flow values ride the leads in.
	const nodeLabelWidth = (column: number) =>
		Math.max(
			0,
			...items[column]!.flatMap((item) =>
				item.node === undefined ? [] : [labelOf.get(item.node)!.width],
			),
		);
	const leadOut = Array.from({ length: Math.max(0, columns - 1) }, (_, gap) =>
		gap > 0 ? nodeLabelWidth(gap) + 2 * LABEL_GAP : 0,
	);
	const leadIn = Array.from({ length: Math.max(0, columns - 1) }, (_, gap) => {
		const widths = diagram.links.flatMap((link, index) =>
			columnOf.get(link.target) === gap + 1 ? [flowText[index]!.width] : [],
		);
		return widths.length > 0 ? Math.max(...widths) + 2 * LABEL_GAP : 0;
	});
	const fixedWidth =
		nodeLabelWidth(0) +
		2 * LABEL_GAP +
		nodeLabelWidth(columns - 1) +
		columns * SANKEY_NODE_WIDTH +
		[...leadOut, ...leadIn].reduce((sum, width) => sum + width, 0);

	const order = positions();
	const outSlots = new Map<Item, Segment[]>();
	const inSlots = new Map<Item, Segment[]>();
	const slotOrder = (list: readonly Segment[], end: "from" | "to") =>
		list.toSorted((a, b) => order.get(a[end])! - order.get(b[end])! || a.link - b.link);
	for (const column of items)
		for (const item of column) {
			outSlots.set(item, slotOrder(segmentsOutOf.get(item) ?? [], "to"));
			inSlots.set(item, slotOrder(segmentsInto.get(item) ?? [], "from"));
		}
	const offsetIn = (slots: readonly Segment[], segment: Segment) => {
		let offset = 0;
		for (const slot of slots) {
			if (slot === segment) return offset;
			offset += slot.width;
		}
		return offset;
	};
	const sourceTop = (segment: Segment) =>
		segment.from.y + offsetIn(outSlots.get(segment.from)!, segment);
	const targetTop = (segment: Segment) =>
		segment.to.y + offsetIn(inSlots.get(segment.to)!, segment);

	// Vertical placement: center each column, then relax every item toward the bands it
	// joins, keeping the order and the gaps.
	const place = (column: readonly Item[], height: number) => {
		let y = 0;
		column.forEach((item, index) => {
			if (index > 0) y += gapBetween(column[index - 1]!, item);
			item.y = Math.max(item.y, y);
			y = item.y + item.height;
		});
		let bottom = height;
		for (let index = column.length - 1; index >= 0; index -= 1) {
			const item = column[index]!;
			item.y = Math.min(item.y, bottom - item.height);
			if (index > 0) bottom = item.y - gapBetween(column[index - 1]!, item);
		}
	};
	const arrange = (height: number) => {
		for (const column of items) {
			let y = (height - columnHeight(column)) / 2;
			column.forEach((item, index) => {
				if (index > 0) y += gapBetween(column[index - 1]!, item);
				item.y = y;
				y += item.height;
			});
		}
		for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration += 1) {
			const alpha = 0.9 ** iteration * 0.8;
			for (let column = 1; column < columns; column += 1) {
				for (const item of items[column]!) {
					const list = segmentsInto.get(item) ?? [];
					const weight = list.reduce((sum, segment) => sum + segment.width, 0);
					if (weight === 0) continue;
					const want =
						list.reduce(
							(sum, segment) =>
								sum + segment.width * (sourceTop(segment) - (targetTop(segment) - item.y)),
							0,
						) / weight;
					item.y += (want - item.y) * alpha;
				}
				place(items[column]!, height);
			}
			for (let column = columns - 2; column >= 0; column -= 1) {
				for (const item of items[column]!) {
					const list = segmentsOutOf.get(item) ?? [];
					const weight = list.reduce((sum, segment) => sum + segment.width, 0);
					if (weight === 0) continue;
					const want =
						list.reduce(
							(sum, segment) =>
								sum + segment.width * (targetTop(segment) - (sourceTop(segment) - item.y)),
							0,
						) / weight;
					item.y += (want - item.y) * alpha;
				}
				place(items[column]!, height);
			}
		}
		// A flow passing columns runs as straight as the room between its neighbors allows.
		for (const chain of chains) {
			if (chain.length < 2) continue;
			const from = sourceTop(chain[0]!);
			const to = targetTop(chain.at(-1)!);
			const first = chain[0]!.from.column;
			const span = chain.at(-1)!.to.column - first;
			for (const segment of chain.slice(1)) {
				const item = segment.from;
				const column = items[item.column]!;
				const index = column.indexOf(item);
				const above = column[index - 1];
				const below = column[index + 1];
				const low = above ? above.y + above.height + gapBetween(above, item) : 0;
				const high = below ? below.y - gapBetween(item, below) - item.height : height - item.height;
				const want = from + ((to - from) * (item.column - first)) / span;
				if (low <= high) item.y = Math.min(high, Math.max(low, want));
			}
		}
	};

	// Vertical scale: the tallest column's bars span the base flow height, and grow
	// while the diagram would read wider than the target aspect. Each curve runs at
	// least as far as its steepest band climbs, so no band turns too sharply.
	const maxColumnValue = Math.max(
		...items.map((column) =>
			column.reduce((sum, item) => {
				const value = (side: readonly Segment[] | undefined) =>
					(side ?? []).reduce((total, segment) => total + diagram.links[segment.link]!.value, 0);
				return sum + Math.max(value(segmentsInto.get(item)), value(segmentsOutOf.get(item)));
			}, 0),
		),
	);
	const tallest = () => Math.max(...items.map(columnHeight));
	/** Size, place and space everything for `scale`. */
	const fit = (scale: number, spread = 1) => {
		size(scale);
		const height = tallest();
		arrange(height);
		const runs = gapSegments.map(
			(gap) =>
				spread *
				Math.min(
					CURVE_MAX_RUN,
					Math.max(
						CURVE_RUN,
						CURVE_SLOPE *
							Math.max(
								0,
								...gap.map((segment) => Math.abs(sourceTop(segment) - targetTop(segment))),
							),
					),
				),
		);
		const bars = Math.max(
			...items.map((column) => column.reduce((sum, item) => sum + item.height, 0)),
		);
		return { height, runs, bars };
	};
	let scale = BASE_FLOW_HEIGHT / maxColumnValue;
	for (let pass = 0; pass < 2; pass += 1) {
		const { height, runs, bars } = fit(scale);
		const width = fixedWidth + runs.reduce((sum, run) => sum + run, 0);
		const wanted = width / TARGET_ASPECT - HEADER_HEIGHT;
		if (height >= wanted - 1 || bars >= MAX_FLOW_HEIGHT) break;
		scale *= Math.min(MAX_FLOW_HEIGHT, bars + (wanted - height)) / bars;
	}

	const draw = (scale: number, spread = 1) => {
		const { runs, bars: barsHeight, height: flowHeight } = fit(scale, spread);
		const columnX: number[] = [];
		let x = 0;
		for (let column = 0; column < columns; column += 1) {
			columnX.push(x);
			if (column < columns - 1)
				x += SANKEY_NODE_WIDTH + leadOut[column]! + runs[column]! + leadIn[column]!;
		}

		// Bars and their labels.
		const nodes: SankeyLayoutNode[] = diagram.nodes.map((node) => {
			const item = nodeItem.get(node.id)!;
			const label = labelOf.get(node.id)!;
			const barX = columnX[item.column]!;
			const centerY = item.y + item.height / 2;
			const top = centerY - label.height / 2;
			const align = item.column === 0 && columns > 1 ? "right" : "left";
			const left =
				align === "right" ? barX - LABEL_GAP - label.width : barX + SANKEY_NODE_WIDTH + LABEL_GAP;
			const total = totals.get(node.id)!;
			return {
				id: node.id,
				label: node.label,
				color: colorOf.get(node.id)!,
				column: item.column,
				x: round(barX),
				y: round(item.y),
				width: SANKEY_NODE_WIDTH,
				height: round(Math.max(item.height, 0.5)),
				inflow: total.inflow,
				outflow: total.outflow,
				total: total.total,
				text: {
					...label,
					fontSize: SANKEY_LABEL_FONT,
					align,
					box: { left, top, right: left + label.width, bottom: top + label.height },
				},
			};
		});

		// Bands: one closed outline per flow through every column it crosses.
		const samples = (gaps: number) =>
			Math.max(6, Math.min(20, Math.floor((MAX_RIBBON_POINTS / 2 - 6 * gaps) / gaps)));
		const edge = (
			chain: readonly Segment[],
			offset: (segment: Segment) => number,
			top: (segment: Segment) => number,
			end: (segment: Segment) => number,
		): Point[] => {
			const points: Point[] = [];
			const steps = samples(chain.length);
			for (const segment of chain) {
				const gap = segment.from.column;
				const x0 = columnX[gap]! + SANKEY_NODE_WIDTH;
				const x1 = columnX[gap + 1]!;
				const y0 = top(segment) + offset(segment);
				const y1 = end(segment) + offset(segment);
				const curveStart = x0 + leadOut[gap]!;
				const curveEnd = x1 - leadIn[gap]!;
				if (points.length === 0) points.push({ x: x0, y: y0 });
				if (curveStart > x0) points.push({ x: curveStart, y: y0 });
				for (let step = 1; step <= steps; step += 1)
					points.push(curvePoint(curveStart, y0, curveEnd, y1, step / steps));
				if (curveEnd < x1) points.push({ x: x1, y: y1 });
				// A flow passing a column runs straight across it.
				if (segment.to.node === undefined) points.push({ x: x1 + SANKEY_NODE_WIDTH, y: y1 });
			}
			return points.map((point) => ({ x: round(point.x), y: round(point.y) }));
		};
		const bands = diagram.links.map((link, index) => {
			const chain = chains[index]!;
			const width = chain[0]!.width;
			const top = edge(chain, () => 0, sourceTop, targetTop);
			const bottom = edge(chain, () => width, sourceTop, targetTop);
			return {
				index,
				source: link.source,
				target: link.target,
				value: link.value,
				width: round(width),
				color: colorOf.get(link.source)!,
				sourceTop: round(sourceTop(chain[0]!)),
				targetTop: round(targetTop(chain.at(-1)!)),
				points: [...top, ...bottom.toReversed()],
			};
		});

		// Flow values: inside the band on its lead into the target when the band is thick
		// enough; otherwise just above or below it wherever that is clear.
		const placed: SankeyBox[] = nodes.map((node) => node.text.box);
		const bars = nodes.map((node) => ({
			left: node.x,
			top: node.y,
			right: node.x + node.width,
			bottom: node.y + node.height,
		}));
		const outlines = bands.map((band) => ({ band, bounds: polygonBounds(band.points) }));
		const leaders: (readonly [Point, Point])[] = [];
		const clear = (box: SankeyBox, own: number) =>
			!placed.some((other) => sankeyBoxesOverlap(box, other, 2)) &&
			!leaders.some(([from, to]) => segmentMeetsBox(from, to, box)) &&
			!bars.some((bar) => sankeyBoxesOverlap(box, bar, 2)) &&
			!outlines.some(
				({ band, bounds }) => band.index !== own && sankeyBoxMeetsPolygon(box, band.points, bounds),
			);
		let crowdedValues = 0;
		let unplacedValues = 0;
		const texted = bands.map((band): SankeyLayoutBand => {
			const text = flowText[band.index]!;
			const gap = columnOf.get(band.target)! - 1;
			const right = columnX[gap + 1]! - LABEL_GAP;
			const at = (left: number, top: number): SankeyText => ({
				...text,
				fontSize: SANKEY_VALUE_FONT,
				align: "center",
				box: { left, top, right: left + text.width, bottom: top + text.height },
			});
			const inside = at(right - text.width, band.targetTop + (band.width - text.height) / 2);
			if (band.width >= text.height + 2) {
				placed.push(inside.box);
				return { ...band, text: inside };
			}
			const chain = chains[band.index]!;
			const first = chain[0]!;
			const sourceLeft = columnX[first.from.column]! + SANKEY_NODE_WIDTH + LABEL_GAP;
			// Beside the band where it meets its target, then its source, then along its curves.
			const candidates: SankeyText[] = [
				at(right - text.width, band.targetTop - text.height - 1),
				at(right - text.width, band.targetTop + band.width + 1),
				at(sourceLeft, band.sourceTop - text.height - 1),
				at(sourceLeft, band.sourceTop + band.width + 1),
			];
			for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9])
				for (const segment of chain) {
					const g = segment.from.column;
					const x0 = columnX[g]! + SANKEY_NODE_WIDTH + leadOut[g]!;
					const x1 = columnX[g + 1]! - leadIn[g]!;
					const y0 = sourceTop(segment);
					const y1 = targetTop(segment);
					const middle = curvePoint(x0, y0, x1, y1, t);
					const left = middle.x - text.width / 2;
					// The curve climbs or falls monotonically, so its ends bound it over the box.
					const ys = [left, left + text.width].map((px) => curveYAt(x0, y0, x1, y1, px));
					candidates.push(
						at(left, Math.min(...ys) - text.height - 2),
						at(left, Math.max(...ys) + band.width + 2),
					);
				}
			candidates.push(inside);
			const found = candidates.find((candidate) => clear(candidate.box, band.index));
			if (found) {
				placed.push(found.box);
				return { ...band, text: found };
			}
			// Last resort: the nearest clear spot, on a short leader from the band's middle
			// that crosses no label or bar and as few other bands as it can.
			crowdedValues += 1;
			const anchors: Point[] = [];
			for (const t of [0.5, 0.3, 0.7])
				for (const segment of chain) {
					const g = segment.from.column;
					const x0 = columnX[g]! + SANKEY_NODE_WIDTH + leadOut[g]!;
					const x1 = columnX[g + 1]! - leadIn[g]!;
					const point = curvePoint(x0, sourceTop(segment), x1, targetTop(segment), t);
					anchors.push({ x: point.x, y: point.y + band.width / 2 });
				}
			const leaderClear = (from: Point, to: Point) =>
				![...placed, ...bars].some((box) => segmentMeetsBox(from, to, box));
			let best: { text: SankeyText; leader: readonly [Point, Point]; crossed: number } | undefined;
			for (const radius of LEADER_RADII) {
				for (const anchor of anchors)
					for (let step = 0; step < 16; step += 1) {
						const angle = (step * Math.PI) / 8;
						const center = {
							x: anchor.x + radius * Math.cos(angle) * 1.6,
							y: anchor.y + radius * Math.sin(angle),
						};
						const candidate = at(center.x - text.width / 2, center.y - text.height / 2);
						if (!clear(candidate.box, band.index)) continue;
						const end = {
							x: Math.min(Math.max(anchor.x, candidate.box.left), candidate.box.right),
							y: Math.min(Math.max(anchor.y, candidate.box.top - 1), candidate.box.bottom + 1),
						};
						if (!leaderClear(anchor, end)) continue;
						const crossed = outlines.filter(
							({ band: other, bounds }) =>
								other.index !== band.index &&
								segmentMeetsPolygon(anchor, end, other.points, bounds),
						).length;
						if (!best || crossed < best.crossed)
							best = { text: candidate, leader: [anchor, end], crossed };
					}
				if (best) break;
			}
			// Nowhere near: the nearest clear spot anywhere around the diagram, on a grid
			// of bounded size. Once one value in a drawing has none, the drawing reflows
			// or is rejected, so the rest skip this search.
			if (!best && unplacedValues === 0) {
				const extent = [...bars, ...placed, ...outlines.map((outline) => outline.bounds)].reduce(
					(all, box) => ({
						left: Math.min(all.left, box.left),
						top: Math.min(all.top, box.top),
						right: Math.max(all.right, box.right),
						bottom: Math.max(all.bottom, box.bottom),
					}),
				);
				const anchor = anchors[0]!;
				const spots: Point[] = [];
				const spanX = extent.right - extent.left + text.width + 16;
				const spanY = extent.bottom - extent.top + text.height + 16;
				const step = Math.max(8, Math.sqrt((spanX * spanY) / GRID_SPOTS));
				for (let y = extent.top - text.height - 8; y <= extent.bottom + 8; y += step)
					for (let x = extent.left - text.width - 8; x <= extent.right + 8; x += step)
						spots.push({ x, y });
				spots.sort(
					(a, b) =>
						Math.hypot(a.x + text.width / 2 - anchor.x, a.y + text.height / 2 - anchor.y) -
						Math.hypot(b.x + text.width / 2 - anchor.x, b.y + text.height / 2 - anchor.y),
				);
				for (const spot of spots) {
					const candidate = at(spot.x, spot.y);
					if (!clear(candidate.box, band.index)) continue;
					const end = {
						x: Math.min(Math.max(anchor.x, candidate.box.left), candidate.box.right),
						y: Math.min(Math.max(anchor.y, candidate.box.top - 1), candidate.box.bottom + 1),
					};
					if (!leaderClear(anchor, end)) continue;
					best = { text: candidate, leader: [anchor, end], crossed: 0 };
					break;
				}
			}
			if (!best) unplacedValues += 1;
			const chosen = best ?? {
				text: inside,
				leader: undefined,
			};
			placed.push(chosen.text.box);
			if (chosen.leader) leaders.push(chosen.leader);
			return {
				...band,
				text: chosen.text,
				...(chosen.leader
					? {
							leader: [
								{ x: round(chosen.leader[0].x), y: round(chosen.leader[0].y) },
								{ x: round(chosen.leader[1].x), y: round(chosen.leader[1].y) },
							] as const,
						}
					: {}),
			};
		});

		return {
			nodes,
			bands: texted,
			crowdedValues,
			unplacedValues,
			bars: barsHeight,
			height: flowHeight,
			width: fixedWidth + runs.reduce((sum, run) => sum + run, 0),
		};
	};
	// Values that find no clear spot ask for a taller diagram first: thicker bands hold
	// their own values and wider gaps hold the rest. Leaders are the last resort.
	const settle = (spread: number, maxTall: number, maxFlowHeight: number) => {
		let current = scale;
		let settled = draw(current, spread);
		for (let retry = 0; retry < CROWD_RETRIES && settled.crowdedValues > 0; retry += 1) {
			const grown = settled.height + settled.bars * (CROWD_GROWTH - 1);
			if (settled.bars * CROWD_GROWTH > maxFlowHeight || grown > settled.width * maxTall) break;
			const next = draw(current * CROWD_GROWTH, spread);
			if (
				next.unplacedValues > settled.unplacedValues ||
				(next.unplacedValues === settled.unplacedValues &&
					next.crowdedValues >= settled.crowdedValues)
			)
				break;
			current *= CROWD_GROWTH;
			settled = next;
		}
		return settled;
	};
	let drawn = settle(1, CROWD_MAX_TALL, CROWD_MAX_FLOW_HEIGHT);
	// A value with no clear spot anywhere reflows the diagram: wider gaps between the
	// columns and room to grow taller. What still finds none is reported, never hidden.
	if (drawn.unplacedValues > 0) {
		const reflowed = settle(REFLOW_SPREAD, REFLOW_MAX_TALL, REFLOW_MAX_FLOW_HEIGHT);
		if (
			reflowed.unplacedValues < drawn.unplacedValues ||
			(reflowed.unplacedValues === drawn.unplacedValues &&
				reflowed.crowdedValues < drawn.crowdedValues)
		)
			drawn = reflowed;
	}
	return {
		nodes: drawn.nodes,
		bands: drawn.bands,
		columns,
		crossings,
		weightedCrossings,
		work,
		crowdedValues: drawn.crowdedValues,
		unplacedValues: drawn.unplacedValues,
	};
}
