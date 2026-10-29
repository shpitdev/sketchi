import {
	CANVAS_SPEC_VERSION,
	estimateTextWidth,
	quadrantGroupKey,
	quadrantGroups,
	QUADRANT_KEYS,
	QuadrantValidationError,
	SKETCHI_DIAGRAM_PALETTE,
	validateQuadrantDiagram,
	wrapTextToWidth,
	type QuadrantDiagram,
	type QuadrantKey,
} from "@sketchi/diagram-core";

import { CHART_SERIES_COLORS } from "./chart.js";
import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

export const QUADRANT_MARK_ROLE = "quadrant-mark";

/** A quadrant mark keeps its role only while it still reads as one: an unlabeled shape on its chart id. */
export function isStructurallyValidQuadrantMark(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly icon?: unknown;
}): boolean {
	return (
		element.nodeId.startsWith("quadrant:") &&
		element.id === `node:${element.nodeId}` &&
		element.icon === undefined
	);
}

/** The plot's side, in pixels; a crowded chart grows through these until its labels read. */
export const QUADRANT_PLOT_SIZES = [560, 640, 720, 800, 880, 960] as const;
/** A dot's diameter, its surface ring included. */
export const QUADRANT_DOT_SIZE = 12;

const PADDING = 40;
const LINE_HEIGHT = 1.35;
const TITLE_FONT = 20;
const LEGEND_FONT = 14;
const NAME_FONT = 16;
const LABEL_FONT = 14;
/** Labels of a plot too crowded for them at full size. */
const CROWDED_LABEL_FONT = 12;
const AXIS_TITLE_FONT = 14;
const END_FONT = 13;

const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const MUTED_INK = "#4c4639";
const MIDLINE_COLOR = "#a99f8c";
const LEADER_COLOR = "#8c826f";
/** Dots without a group, beside grouped ones. */
const UNGROUPED_COLOR = "#8c826f";

/** Labels wrap to this width at whole words. */
const LABEL_WIDTH = 150;
const AXIS_LABEL_WIDTH = 130;
const END_LABEL_WIDTH = 170;
/** Labels and names keep this far inside the plot's edge. */
const INSET = 6;
const NAME_PAD = 10;
/** A name keeps this far from every dot where it can, leaving room for the dot's label. */
const NAME_HALO = 24;
/** Wrapping a name onto more lines costs as much as sliding it this far along its edge. */
const NAME_WRAP_COST = 40;
/** Clear space between two texts, and between a text and a dot. */
const TEXT_GAP = 3;
const DOT_GAP = 2;
/** Labels keep this far from either divider, which always runs whole. */
const DIVIDER_GAP = 3;
/** The axes run this far outside the plot. */
const AXIS_OFFSET = 14;
const AXIS_TEXT_GAP = 8;
/** The x axis's end labels keep this far apart. */
const END_LABEL_GAP = 16;
/** Leader lines start this far out from the dot, in rings this far apart. */
const LEADER_FIRST = 22;
const LEADER_STEP = 12;
const LEADER_ANGLES = 24;

/**
 * Washes of four categorical hues over the card surface: they tell the
 * quadrants apart without competing with the dots. Order: topLeft, topRight,
 * bottomLeft, bottomRight.
 */
const QUADRANT_HUES: Readonly<Record<QuadrantKey, string>> = {
	topLeft: CHART_SERIES_COLORS[0],
	topRight: CHART_SERIES_COLORS[2],
	bottomLeft: CHART_SERIES_COLORS[3],
	bottomRight: CHART_SERIES_COLORS[4],
};
const WASH = 0.11;

type Layer = "back" | "middle" | "front";

export interface QuadrantBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

interface Measured {
	readonly text: string;
	readonly width: number;
	readonly height: number;
}

function measure(text: string, fontSize: number): Measured {
	return {
		text,
		width: Math.ceil(estimateTextWidth(text, fontSize)),
		height: Math.ceil(text.split("\n").length * fontSize * LINE_HEIGHT),
	};
}

/** Wrap at spaces, never inside a word: the line widens to the widest word. */
function wrapped(text: string, width: number, fontSize: number): Measured {
	const widest = Math.max(
		...text.split(/\s+/u).map((word) => Math.ceil(estimateTextWidth(word, fontSize))),
	);
	return measure(wrapTextToWidth(text, Math.max(width, widest) + 1, fontSize), fontSize);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function boxAt(left: number, top: number, size: Measured): QuadrantBox {
	return { left, top, right: left + size.width, bottom: top + size.height };
}

function overlaps(a: QuadrantBox, b: QuadrantBox, gap = 0): boolean {
	return (
		a.left < b.right + gap &&
		b.left < a.right + gap &&
		a.top < b.bottom + gap &&
		b.top < a.bottom + gap
	);
}

function inside(outer: QuadrantBox, inner: QuadrantBox): boolean {
	return (
		inner.left >= outer.left &&
		inner.top >= outer.top &&
		inner.right <= outer.right &&
		inner.bottom <= outer.bottom
	);
}

/** Whether a segment passes through a box, by Liang–Barsky clipping. */
export function quadrantSegmentHitsBox(
	from: ScenePoint,
	to: ScenePoint,
	box: QuadrantBox,
): boolean {
	if (
		Math.max(from.x, to.x) < box.left ||
		Math.min(from.x, to.x) > box.right ||
		Math.max(from.y, to.y) < box.top ||
		Math.min(from.y, to.y) > box.bottom
	)
		return false;
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
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const t = q / p;
		if (p < 0) low = Math.max(low, t);
		else high = Math.min(high, t);
		if (low > high) return false;
	}
	return high - low > 1e-9;
}

export function quadrantSegmentsCross(
	a: ScenePoint,
	b: ScenePoint,
	c: ScenePoint,
	d: ScenePoint,
): boolean {
	const orient = (p: ScenePoint, q: ScenePoint, r: ScenePoint) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

/** A hue mixed into the card surface. */
function wash(hex: string, surface: string, amount: number): string {
	const channel = (color: string, offset: number) =>
		Number.parseInt(color.slice(offset, offset + 2), 16);
	return `#${[1, 3, 5]
		.map((offset) =>
			Math.round(channel(surface, offset) * (1 - amount) + channel(hex, offset) * amount)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

/** Each quadrant's box within a plot of this size, its origin at the plot's top-left. */
function quadrantBoxes(size: number): Record<QuadrantKey, QuadrantBox> {
	const half = size / 2;
	return {
		topLeft: { left: 0, top: 0, right: half, bottom: half },
		topRight: { left: half, top: 0, right: size, bottom: half },
		bottomLeft: { left: 0, top: half, right: half, bottom: size },
		bottomRight: { left: half, top: half, right: size, bottom: size },
	};
}

/** Where a point sits in a plot of this size. */
export function quadrantPointPosition(
	point: { readonly x: number; readonly y: number },
	plot: QuadrantBox,
): ScenePoint {
	const size = plot.right - plot.left;
	return { x: plot.left + point.x * size, y: plot.top + (1 - point.y) * size };
}

/** Dots closer than this, rim to rim, read as one clump. */
const CLUMP_GAP = 6;
/** Dots this close, rim to rim, form a cluster whose labels a long search stacks in columns. */
const CLUSTER_GAP = 40;
/** A clump this large labels every dot on a leader. */
const CLUMP_LEADERS = 4;
/** A leader spot this many steps of 15° off the way out costs as much as one 9 px farther. */
const LEADER_TURN_COST = 9;
/** Leaders keep their far halves this far apart, so each reads as its own line. */
const LEADER_SPACING = 5;
/** In a plot too crowded for clean leaders, a leader may pass over a dot at this cost. */
const LEADER_OVER_DOT_COST = 120;
/** Leaders reach at most this far; a label farther away no longer reads as its dot's. */
const LEADER_REACH = 300;
/** Spots beside a dot cost their rank; a clump's column, then a leader, cost more. */
const COLUMN_COST = 20;
const LEADER_COST = 30;
/** A spot beside a dot that reads as another dot's waits behind every leader straight away in reach. */
const MISREAD_COST = LEADER_COST + LEADER_REACH;
/** Displacements allowed per point while repairing a crowded placement, among its cheapest spots. */
const REPAIR_STEPS_PER_POINT = 6;
const REPAIR_SPOTS = 240;
/** Spots tried for a swap: this label takes one, and the one label it displaces moves. */
const SWAP_SPOTS = 48;
/** A chart with no more labels than this blocked as it stops growing sets them smaller first. */
const FEW_BLOCKED = 3;
/**
 * The spot checks a chart its first search leaves blocked may spend on the rest, so a chart
 * that can never read fails fast.
 */
const FALLBACK_WORK = 4_000_000;
/** A chart still blocked after every tier repairs with this many times the budget. */
const THOROUGH_SCALE = 4;
/** The grid a last-resort label search steps over the plot on. */
const GRID_STEP = 8;

/**
 * Each dot's clump: dots chained rim to rim within a few pixels, which a reader
 * cannot tell apart. A leader may leave its clump across its neighbors' dots,
 * but crosses no other dot.
 */
export function quadrantDotClumps(
	centers: readonly ScenePoint[],
	gap: number = CLUMP_GAP,
): number[] {
	const parent = centers.map((_, index) => index);
	const find = (index: number): number => {
		while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!;
		return index;
	};
	for (let first = 0; first < centers.length; first += 1)
		for (let second = first + 1; second < centers.length; second += 1) {
			const a = centers[first]!;
			const b = centers[second]!;
			if (Math.hypot(a.x - b.x, a.y - b.y) <= QUADRANT_DOT_SIZE + gap)
				parent[find(second)] = find(first);
		}
	return centers.map((_, index) => find(index));
}

interface PlacedLabel {
	readonly text: Measured;
	readonly box: QuadrantBox;
	/** From the dot's rim to the label, when the label sits away from its dot. */
	readonly leader?: readonly [ScenePoint, ScenePoint];
}

interface QuadrantPlan {
	readonly size: number;
	readonly names: Record<QuadrantKey, { readonly text: Measured; readonly box: QuadrantBox }>;
	readonly labels: readonly PlacedLabel[];
	readonly labelFont: number;
	readonly leaders: number;
	/** Labels no position could hold clear; drawn beside their dot anyway. */
	readonly blocked: number;
	readonly blockedPoints: readonly number[];
	/** Leaders that pass over another clump's dot. */
	readonly overDots: number;
	/** Points in clumps large enough to label on leaders, which a larger plot rarely spreads. */
	readonly clumped: number;
	/** Names no position could keep clear of every dot. */
	readonly covered: number;
}

function dotBox(center: ScenePoint): QuadrantBox {
	const half = QUADRANT_DOT_SIZE / 2;
	return {
		left: center.x - half,
		top: center.y - half,
		right: center.x + half,
		bottom: center.y + half,
	};
}

/**
 * The quadrant's name in its outer corner, or the nearest spot clear of every
 * dot: along the quadrant's outer edge first, then anywhere inside it.
 */
function placeName(
	name: string,
	key: QuadrantKey,
	quadrant: QuadrantBox,
	dots: readonly QuadrantBox[],
	wide: ReadonlySet<number>,
	taken: readonly LabelSpot[],
): { text: Measured; box: QuadrantBox; clear: boolean } {
	const top = key === "topLeft" || key === "topRight";
	const left = key === "topLeft" || key === "bottomLeft";
	const room = {
		left: quadrant.left + NAME_PAD,
		top: quadrant.top + NAME_PAD,
		right: quadrant.right - NAME_PAD,
		bottom: quadrant.bottom - NAME_PAD,
	};
	const candidates: { text: Measured; box: QuadrantBox; score: number }[] = [];
	for (const [lines, width] of [1, 1 / 2, 1 / 3].map(
		(share, at) => [at, (room.right - room.left) * share] as const,
	)) {
		const text = wrapped(name, width, NAME_FONT);
		// A name wider or taller than its quadrant's room fits nowhere at this size.
		if (text.width > room.right - room.left || text.height > room.bottom - room.top) continue;
		const spanX = room.right - room.left - text.width;
		const spanY = room.bottom - room.top - text.height;
		for (let dy = 0; dy <= spanY + 1e-9; dy += Math.max(4, spanY / 40) || 1) {
			for (let dx = 0; dx <= spanX + 1e-9; dx += Math.max(4, spanX / 40) || 1) {
				const x = left ? room.left + dx : room.right - text.width - dx;
				const y = top ? room.top + dy : room.bottom - text.height - dy;
				// Slide along the outer edge before wrapping, and wrap before moving in toward the center.
				candidates.push({
					text,
					box: boxAt(x, y, text),
					score: dx + 3 * dy + NAME_WRAP_COST * lines,
				});
				if (spanX === 0) break;
			}
			if (spanY === 0) break;
		}
	}
	candidates.sort((a, b) => a.score - b.score);
	// A name keeps room around each dot for its label where it can (more around a dot whose
	// label found no room), and clears every dot always.
	const free = (box: QuadrantBox, halo: boolean) =>
		!dots.some((dot, index) =>
			overlaps(box, dot, !halo ? DOT_GAP : wide.has(index) ? 3 * NAME_HALO : NAME_HALO),
		) && !taken.some((spot) => spotsConflict(spot, labelSpot(box, 0)));
	if (!candidates.length) {
		const text = wrapped(name, room.right - room.left, NAME_FONT);
		return { text, box: boxAt(room.left, room.top, text), clear: false };
	}
	const clear =
		candidates.find((candidate) => free(candidate.box, true)) ??
		candidates.find((candidate) => free(candidate.box, false));
	if (clear) return { text: clear.text, box: clear.box, clear: true };
	let fallback: { text: Measured; box: QuadrantBox; hits: number } | undefined;
	for (const candidate of candidates) {
		const hits = dots.filter((dot) => overlaps(candidate.box, dot, DOT_GAP)).length;
		if (!fallback || hits < fallback.hits) fallback = { ...candidate, hits };
	}
	// Clear of every dot, a name keeps its spot even over a clump's column, whose labels yield.
	return { text: fallback!.text, box: fallback!.box, clear: fallback!.hits === 0 };
}

/** Label spots beside a dot, in order of preference: right, left, above, below, then corners. */
function besideDot(center: ScenePoint, text: Measured): QuadrantBox[] {
	const half = QUADRANT_DOT_SIZE / 2;
	const gap = half + 4;
	const corner = half + DOT_GAP + 1;
	const { x, y } = center;
	const { width, height } = text;
	return [
		boxAt(x + gap, y - height / 2, text),
		boxAt(x - gap - width, y - height / 2, text),
		boxAt(x - width / 2, y - half - DOT_GAP - 1 - height, text),
		boxAt(x - width / 2, y + half + DOT_GAP + 1, text),
		boxAt(x + corner, y - corner - height, text),
		boxAt(x - corner - width, y - corner - height, text),
		boxAt(x + corner, y + corner, text),
		boxAt(x - corner - width, y + corner, text),
	];
}

/** How far a point lies from a box; 0 inside it. */
export function quadrantBoxDistance(box: QuadrantBox, point: ScenePoint): number {
	const dx = Math.max(box.left - point.x, 0, point.x - box.right);
	const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
	return Math.hypot(dx, dy);
}

/** A label beside its dot keeps every other dot at least this much farther away. */
export const QUADRANT_NEAREST_MARGIN = 2;

/** How near a dot level with a label, or in line with it, reads as the label's own. */
export const QUADRANT_PAIRING_REACH = 48;

/**
 * The other dot a label beside its own would read as. A reader pairs a label with a dot
 * level with its lines or in line under or over it, so a label off its own dot's row and
 * column misreads when another dot near it sits in one. A slack makes the test more lenient.
 */
export function quadrantMisreadDot(
	box: QuadrantBox,
	index: number,
	centers: readonly (ScenePoint | undefined)[],
	slack = 0,
): number | undefined {
	const own = centers[index];
	const radius = QUADRANT_DOT_SIZE / 2;
	if (
		!own ||
		(own.y + radius > box.top - slack && own.y - radius < box.bottom + slack) ||
		(own.x + radius > box.left - slack && own.x - radius < box.right + slack)
	)
		return undefined;
	// Another dot reads as the label's when its center sits within the label's lines, or under
	// or over the label clear of its ends, which may run past the text a reader sees.
	const level = (point: ScenePoint) => point.y > box.top + slack && point.y < box.bottom - slack;
	const inLine = (point: ScenePoint) =>
		point.x > box.left + radius + slack && point.x < box.right - radius - slack;
	const reach = QUADRANT_PAIRING_REACH - slack;
	const misread = centers.findIndex(
		(other, at) =>
			at !== index &&
			other !== undefined &&
			Math.hypot(other.x - own.x, other.y - own.y) >= 1 &&
			((level(other) && Math.max(box.left - other.x, other.x - box.right) <= reach) ||
				(inLine(other) && Math.max(box.top - other.y, other.y - box.bottom) <= reach)),
	);
	return misread === -1 ? undefined : misread;
}

/** The point on a box's outline nearest a point outside it. */
function nearestOnBox(box: QuadrantBox, point: ScenePoint): ScenePoint {
	return {
		x: Math.min(box.right, Math.max(box.left, point.x)),
		y: Math.min(box.bottom, Math.max(box.top, point.y)),
	};
}

/**
 * Tops for boxes in one column near their preferred centers, in order: none
 * overlaps another, and all stay within [min, max] while there is room.
 */
function stackStarts(
	entries: readonly { readonly preferred: number; readonly size: number }[],
	min: number,
	max: number,
	gap: number,
	/** A band no box may overlap, such as a divider: a box that would is moved past it. */
	band?: { readonly low: number; readonly high: number },
): number[] {
	const across = (start: number, size: number) =>
		band !== undefined && start < band.high && start + size > band.low;
	const starts: number[] = [];
	let floor = min;
	for (const entry of entries) {
		let start = Math.max(entry.preferred - entry.size / 2, floor);
		if (across(start, entry.size)) start = band!.high;
		starts.push(start);
		floor = start + entry.size + gap;
	}
	let limit = max;
	for (let at = entries.length - 1; at >= 0; at -= 1) {
		let start = Math.min(starts[at]!, limit - entries[at]!.size);
		if (across(start, entries[at]!.size)) start = band!.low - entries[at]!.size;
		starts[at] = start;
		limit = start - gap;
	}
	return starts;
}

/** A spot a label may take: beside its dot, or away from it on a leader. */
interface LabelSpot {
	readonly box: QuadrantBox;
	readonly leader?: readonly [ScenePoint, ScenePoint];
	readonly cost: number;
	/** Other clumps' dots its leader passes over, in a plot too crowded for clean leaders. */
	readonly over: number;
	/** The box and its leader together, for a quick test that two spots are far apart. */
	readonly extent: QuadrantBox;
}

function labelSpot(
	box: QuadrantBox,
	cost: number,
	leader?: readonly [ScenePoint, ScenePoint],
	over = 0,
): LabelSpot {
	const xs = [box.left, box.right, ...(leader ? [leader[0].x, leader[1].x] : [])];
	const ys = [box.top, box.bottom, ...(leader ? [leader[0].y, leader[1].y] : [])];
	return {
		box,
		cost,
		over,
		...(leader ? { leader } : {}),
		extent: {
			left: Math.min(...xs),
			top: Math.min(...ys),
			right: Math.max(...xs),
			bottom: Math.max(...ys),
		},
	};
}

function spotsConflict(a: LabelSpot, b: LabelSpot): boolean {
	if (!overlaps(a.extent, b.extent, TEXT_GAP + 1)) return false;
	if (overlaps(a.box, b.box, TEXT_GAP)) return true;
	const padded = (box: QuadrantBox) => ({
		left: box.left - 1,
		top: box.top - 1,
		right: box.right + 1,
		bottom: box.bottom + 1,
	});
	if (a.leader && quadrantSegmentHitsBox(a.leader[0], a.leader[1], padded(b.box))) return true;
	if (b.leader && quadrantSegmentHitsBox(b.leader[0], b.leader[1], padded(a.box))) return true;
	if (!a.leader || !b.leader) return false;
	if (quadrantSegmentsCross(a.leader[0], a.leader[1], b.leader[0], b.leader[1])) return true;
	// Leaders that run alongside each other read as one line. Two may start close together,
	// fanning out of one clump, but their far halves keep apart.
	const trimmed = (leader: readonly [ScenePoint, ScenePoint]) => {
		const [from, to] = leader;
		return [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to] as const;
	};
	const [p, q] = trimmed(a.leader);
	const [r, t] = trimmed(b.leader);
	if (
		Math.max(p.x, q.x) + LEADER_SPACING < Math.min(r.x, t.x) ||
		Math.max(r.x, t.x) + LEADER_SPACING < Math.min(p.x, q.x) ||
		Math.max(p.y, q.y) + LEADER_SPACING < Math.min(r.y, t.y) ||
		Math.max(r.y, t.y) + LEADER_SPACING < Math.min(p.y, q.y)
	)
		return false;
	return segmentDistance(p, q, r, t) < LEADER_SPACING;
}

function pointSegmentDistance(point: ScenePoint, from: ScenePoint, to: ScenePoint): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const t = Math.max(
		0,
		Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy || 1)),
	);
	return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

/** The shortest distance between two segments. */
function segmentDistance(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint): number {
	if (quadrantSegmentsCross(a, b, c, d)) return 0;
	return Math.min(
		pointSegmentDistance(a, c, d),
		pointSegmentDistance(b, c, d),
		pointSegmentDistance(c, a, b),
		pointSegmentDistance(d, a, b),
	);
}

interface PlanOptions {
	/** Points whose labels found no room last time; names keep farther from their dots. */
	readonly crowded?: ReadonlySet<number>;
	/** Leaders may pass over other dots and reach across the plot. */
	readonly relaxed?: boolean;
	readonly labelFont?: number;
	/** Search longer for a crowded chart's last few labels. */
	readonly thorough?: boolean;
	/** The spot checks spent so far, shared across plans; a plan past the limit stops searching. */
	readonly work?: Work;
}

interface Work {
	spent: number;
	limit: number;
}

function planLayout(
	diagram: QuadrantDiagram,
	size: number,
	{
		crowded = new Set(),
		relaxed = false,
		labelFont = LABEL_FONT,
		thorough = false,
		work = { spent: 0, limit: Number.POSITIVE_INFINITY },
	}: PlanOptions = {},
): QuadrantPlan {
	const exhausted = () => work.spent > work.limit;
	const plot = { left: 0, top: 0, right: size, bottom: size };
	const room = {
		left: INSET,
		top: INSET,
		right: size - INSET,
		bottom: size - INSET,
	};
	const centers = diagram.points.map((point) => quadrantPointPosition(point, plot));
	const dots = centers.map(dotBox);
	const clumps = quadrantDotClumps(centers);
	const quadrants = quadrantBoxes(size);
	let nameBoxes: QuadrantBox[] = [];
	const texts = diagram.points.map((point) =>
		wrapped(point.label, (LABEL_WIDTH * labelFont) / LABEL_FONT, labelFont),
	);
	const half = size / 2;
	// The dividers run whole through the plot, so no label may sit across one.
	const crossesDivider = (box: QuadrantBox) =>
		(box.left < half + DIVIDER_GAP && box.right > half - DIVIDER_GAP) ||
		(box.top < half + DIVIDER_GAP && box.bottom > half - DIVIDER_GAP);
	/** Clear of the plot's edge, both dividers, every dot and every quadrant name. */
	const open = (box: QuadrantBox) => {
		work.spent += 1;
		return (
			inside(room, box) &&
			!crossesDivider(box) &&
			!dots.some((dot) => overlaps(box, dot, DOT_GAP)) &&
			!nameBoxes.some((name) => overlaps(box, name, TEXT_GAP))
		);
	};
	/**
	 * A leader from a dot's rim to a point, and how many other clumps' dots it passes over:
	 * none, unless the plot is too crowded for clean leaders. It never crosses a name.
	 */
	const leaderTo = (
		index: number,
		end: ScenePoint,
	): { leader: readonly [ScenePoint, ScenePoint]; over: number } | undefined => {
		const center = centers[index]!;
		const rim = QUADRANT_DOT_SIZE / 2 + 1;
		const length = Math.hypot(end.x - center.x, end.y - center.y);
		if (length <= rim + 4) return undefined;
		const from = {
			x: center.x + ((end.x - center.x) * rim) / length,
			y: center.y + ((end.y - center.y) * rim) / length,
		};
		if (nameBoxes.some((name) => quadrantSegmentHitsBox(from, end, name))) return undefined;
		const over = dots.filter(
			(dot, at) =>
				clumps[at] !== clumps[index] &&
				quadrantSegmentHitsBox(from, end, {
					left: dot.left - 1,
					top: dot.top - 1,
					right: dot.right + 1,
					bottom: dot.bottom + 1,
				}),
		).length;
		return over && !relaxed ? undefined : { leader: [from, end], over };
	};
	// A label beside its dot must sit nearer that dot than any other, or it reads as the other's.
	const nearestOwn = (index: number, box: QuadrantBox) => {
		const own = quadrantBoxDistance(box, centers[index]!);
		return centers.every(
			(other, at) =>
				at === index ||
				Math.hypot(other.x - centers[index]!.x, other.y - centers[index]!.y) < 1 ||
				quadrantBoxDistance(box, other) > own + QUADRANT_NEAREST_MARGIN,
		);
	};
	/** The direction away from the dots crowding a point, nearest ones weighing most. */
	const away = (index: number) => {
		const center = centers[index]!;
		let x = 0;
		let y = 0;
		centers.forEach((other, at) => {
			const distance = Math.hypot(center.x - other.x, center.y - other.y);
			if (at === index || distance < 1e-6) return;
			x += (center.x - other.x) / distance / (distance + 1) ** 2;
			y += (center.y - other.y) / distance / (distance + 1) ** 2;
		});
		return x === 0 && y === 0 ? -Math.PI / 2 : Math.atan2(y, x);
	};
	// A clump of dots a reader cannot tell apart labels them first, in a tidy column on each
	// side (or one side) of the clump, in the dots' top-to-bottom order, on leaders; the
	// quadrant names then find room clear of those columns.
	const members = new Map<number, number[]>();
	clumps.forEach((clump, index) => members.set(clump, [...(members.get(clump) ?? []), index]));
	const assigned: (LabelSpot | undefined)[] = diagram.points.map(() => undefined);
	const columns = new Map<number, LabelSpot>();
	// Searching longer, a looser cluster stacks its labels in columns too.
	const columnGroups = new Map<number, number[]>();
	(thorough ? quadrantDotClumps(centers, CLUSTER_GAP) : clumps).forEach((clump, index) =>
		columnGroups.set(clump, [...(columnGroups.get(clump) ?? []), index]),
	);
	for (const group of columnGroups.values()) {
		if (group.length < CLUMP_LEADERS) continue;
		const column = clumpColumns(
			group,
			centers,
			dots,
			texts,
			room,
			open,
			leaderTo,
			[...columns.values()],
			relaxed,
		);
		for (const [index, spot] of column ?? []) {
			columns.set(index, spot);
			assigned[index] = spot;
		}
	}
	let covered = 0;
	const names = Object.fromEntries(
		(Object.keys(quadrants) as QuadrantKey[]).map((key) => {
			const placed = placeName(diagram.quadrants[key], key, quadrants[key], dots, crowded, [
				...columns.values(),
			]);
			if (!placed.clear) covered += 1;
			return [key, { text: placed.text, box: placed.box }];
		}),
	) as QuadrantPlan["names"];
	nameBoxes = Object.values(names).map((name) => name.box);
	// A name with no room clear of a clump's column keeps its spot; that column's labels find others.
	for (const [index, spot] of columns)
		if (nameBoxes.some((name) => spotsConflict(spot, labelSpot(name, 0)))) {
			columns.delete(index);
			assigned[index] = undefined;
		}
	// Every spot each label may take, cheapest first, none across a divider: beside its dot
	// (rightward first), then on a leader, nearest first and straight away from the crowd.
	// A spot beside the dot that reads as another dot's waits behind the short leaders.
	// Leader spots are found only for a label that needs one.
	const besides = diagram.points.map((_, index) =>
		besideDot(centers[index]!, texts[index]!).flatMap((box, rank) =>
			open(box) && nearestOwn(index, box)
				? [
						labelSpot(
							box,
							rank + (quadrantMisreadDot(box, index, centers) === undefined ? 0 : MISREAD_COST),
						),
					]
				: [],
		),
	);
	const beside = besides.map((spots) => spots.filter((spot) => spot.cost < MISREAD_COST));
	const misread = besides.map((spots) => spots.filter((spot) => spot.cost >= MISREAD_COST));
	const farSpots = (index: number): LabelSpot[] => {
		const center = centers[index]!;
		const text = texts[index]!;
		const start = away(index);
		const far: LabelSpot[] = [];
		for (
			let radius = LEADER_FIRST;
			radius <= (relaxed ? size : LEADER_REACH) && !exhausted();
			radius += LEADER_STEP
		)
			for (let step = 0; step < LEADER_ANGLES; step += 1) {
				const turn = Math.ceil(step / 2) * (step % 2 ? 1 : -1);
				const angle = start + (turn * 2 * Math.PI) / LEADER_ANGLES;
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const anchor = { x: center.x + radius * cos, y: center.y + radius * sin };
				// The box meets the anchor with the side facing the dot, centered on it or flush
				// with one end, so a label can still slip into a narrow band along an edge.
				const lefts =
					cos > 0.38
						? [anchor.x]
						: cos < -0.38
							? [anchor.x - text.width]
							: [anchor.x - text.width / 2, anchor.x, anchor.x - text.width];
				const tops =
					sin > 0.38
						? [anchor.y]
						: sin < -0.38
							? [anchor.y - text.height]
							: [anchor.y - text.height / 2, anchor.y, anchor.y - text.height];
				const cost = LEADER_COST + radius + LEADER_TURN_COST * Math.abs(turn);
				for (const [at, left] of lefts.entries())
					for (const [offset, top] of tops.entries()) {
						const box = boxAt(left, top, text);
						if (!open(box)) continue;
						const route = leaderTo(index, nearestOnBox(box, center));
						if (route)
							far.push(
								labelSpot(
									box,
									cost + (at || offset ? 2 : 0) + LEADER_OVER_DOT_COST * route.over,
									route.leader,
									route.over,
								),
							);
					}
			}
		return far.sort((a, b) => a.cost - b.cost);
	};
	// A clump of dots a reader cannot tell apart offers a tidier spot for each label: a column
	// on each side (or one side) of the clump, in the dots' top-to-bottom order, on leaders.
	const near: LabelSpot[][] = beside.map((list) => [...list]);
	for (const [index, spot] of columns) near[index] = [spot, ...near[index]!];
	const conflict = (a: LabelSpot, b: LabelSpot) => {
		work.spent += 1;
		return spotsConflict(a, b);
	};
	const every: (LabelSpot[] | undefined)[] = [];
	const spotsOf = (index: number) =>
		(every[index] ??= [
			...near[index]!,
			...[...misread[index]!, ...farSpots(index)].sort((a, b) => a.cost - b.cost),
		]);
	const clashes = (index: number, spot: LabelSpot) =>
		assigned.flatMap((other, at) => (at !== index && other && conflict(spot, other) ? [at] : []));
	const clearOf = (index: number, spot: LabelSpot) =>
		assigned.every((other, at) => at === index || !other || !conflict(spot, other));
	const firstClear = (index: number) =>
		near[index]!.find((spot) => clearOf(index, spot)) ??
		spotsOf(index).find((spot) => clearOf(index, spot));
	// Most constrained label first: the one with the fewest clear spots beside its dot.
	const waiting = new Set(diagram.points.flatMap((_, index) => (assigned[index] ? [] : [index])));
	while (waiting.size && !exhausted()) {
		let best: { index: number; count: number } | undefined;
		for (const index of waiting) {
			const count = beside[index]!.filter((spot) => clearOf(index, spot)).length;
			if (!best || count < best.count) best = { index, count };
			if (count === 0) break;
		}
		waiting.delete(best!.index);
		assigned[best!.index] = firstClear(best!.index);
	}
	// A label no clear spot holds takes a spot whose one displaced label moves to a clear spot
	// of its own, when one exists. Otherwise it takes the spot that displaces the fewest
	// others, which then find spots of their own; a label displaced again and again weighs more.
	const evictions = diagram.points.map(() => 0);
	const queue = diagram.points.flatMap((_, index) => (assigned[index] ? [] : [index]));
	for (
		let steps = 0;
		queue.length &&
		!exhausted() &&
		steps < (thorough ? THOROUGH_SCALE : 1) * REPAIR_STEPS_PER_POINT * diagram.points.length;
		steps += 1
	) {
		const index = queue.shift()!;
		const clear = firstClear(index);
		if (clear) {
			assigned[index] = clear;
			continue;
		}
		const reach = thorough ? THOROUGH_SCALE * REPAIR_SPOTS : REPAIR_SPOTS;
		const candidates = spotsOf(index)
			.slice(0, reach)
			.map((spot) => ({
				spot,
				displaced: clashes(index, spot),
			}));
		let swap: { spot: LabelSpot; other: number; moved: LabelSpot } | undefined;
		for (const { spot, displaced } of candidates.slice(
			0,
			thorough ? THOROUGH_SCALE * SWAP_SPOTS : SWAP_SPOTS,
		)) {
			if (exhausted()) break;
			if (displaced.length !== 1) continue;
			const other = displaced[0]!;
			const held = assigned[other];
			assigned[other] = undefined;
			assigned[index] = spot;
			const moved = spotsOf(other)
				.slice(0, reach)
				.find((alternative) => clearOf(other, alternative));
			assigned[index] = undefined;
			assigned[other] = held;
			if (moved) {
				swap = { spot, other, moved };
				break;
			}
		}
		if (swap) {
			assigned[index] = swap.spot;
			assigned[swap.other] = swap.moved;
			continue;
		}
		let choice: { spot: LabelSpot; displaced: number[]; weight: number } | undefined;
		for (const { spot, displaced } of candidates) {
			const weight =
				displaced.reduce((sum, at) => sum + 1000 * (1 + evictions[at]!), 0) + spot.cost;
			if (!choice || weight < choice.weight) choice = { spot, displaced, weight };
		}
		if (!choice) continue;
		for (const at of choice.displaced) {
			assigned[at] = undefined;
			evictions[at] = evictions[at]! + 1;
			queue.push(at);
		}
		assigned[index] = choice.spot;
	}
	// Searching longer, a label still blocked takes the nearest clear spot anywhere in the plot.
	if (thorough)
		for (const index of diagram.points.keys()) {
			if (assigned[index]) continue;
			const center = centers[index]!;
			const text = texts[index]!;
			let best: LabelSpot | undefined;
			for (let top = room.top; top + text.height <= room.bottom && !exhausted(); top += GRID_STEP)
				for (let left = room.left; left + text.width <= room.right; left += GRID_STEP) {
					const box = boxAt(left, top, text);
					const distance = quadrantBoxDistance(box, center);
					if ((best && distance + LEADER_COST >= best.cost) || !open(box)) continue;
					const route = leaderTo(index, nearestOnBox(box, center));
					if (!route) continue;
					const spot = labelSpot(
						box,
						LEADER_COST + distance + LEADER_OVER_DOT_COST * route.over,
						route.leader,
						route.over,
					);
					if (clearOf(index, spot) && (!best || spot.cost < best.cost)) best = spot;
				}
			if (best) assigned[index] = best;
		}
	const blockedPoints = assigned.flatMap((spot, index) => (spot ? [] : [index]));
	const labels = assigned.map((spot, index): PlacedLabel => {
		const text = texts[index]!;
		if (!spot) return { text, box: besideDot(centers[index]!, text)[0]! };
		return spot.leader ? { text, box: spot.box, leader: spot.leader } : { text, box: spot.box };
	});
	return {
		size,
		names,
		labels,
		labelFont,
		leaders: labels.filter((label) => label.leader).length,
		blocked: blockedPoints.length,
		blockedPoints,
		overDots: assigned.filter((spot) => spot && spot.over > 0).length,
		clumped: [...members.values()]
			.filter((group) => group.length >= CLUMP_LEADERS)
			.reduce((sum, group) => sum + group.length, 0),
		covered,
	};
}

/** Columns of a clump's labels beside it, each on a leader, or undefined when none fits clear. */
function clumpColumns(
	group: readonly number[],
	centers: readonly ScenePoint[],
	dots: readonly QuadrantBox[],
	texts: readonly Measured[],
	room: QuadrantBox,
	open: (box: QuadrantBox) => boolean,
	leaderTo: (
		index: number,
		end: ScenePoint,
	) => { leader: readonly [ScenePoint, ScenePoint]; over: number } | undefined,
	taken: readonly LabelSpot[],
	/** Leaders may pass over other clumps' dots. */
	overDots = false,
): Map<number, LabelSpot> | undefined {
	const byX = group.toSorted((a, b) => centers[a]!.x - centers[b]!.x || a - b);
	const divider = (room.top + room.bottom) / 2;
	const left = Math.min(...group.map((index) => dots[index]!.left));
	const right = Math.max(...group.map((index) => dots[index]!.right));
	const east = Math.ceil(byX.length / 2);
	const splits: [readonly number[], readonly number[]][] = [
		[byX.slice(0, byX.length - east), byX.slice(byX.length - east)],
		[[], byX],
		[byX, []],
	];
	for (const run of [16, 28, 44, 64, 96, 140, 200])
		for (const [westward, eastward] of splits) {
			const spots = new Map<number, LabelSpot>();
			let fits = true;
			for (const [side, column] of [
				[-1, westward],
				[1, eastward],
			] as const) {
				if (!column.length) continue;
				const ordered = column.toSorted((a, b) => centers[a]!.y - centers[b]!.y || a - b);
				const slots = () =>
					stackStarts(
						ordered.map((index) => ({ preferred: centers[index]!.y, size: texts[index]!.height })),
						room.top,
						room.bottom,
						TEXT_GAP + 1,
						{ low: divider - DIVIDER_GAP, high: divider + DIVIDER_GAP },
					).map((top, at) => {
						const text = texts[ordered[at]!]!;
						return boxAt(side > 0 ? right + run : left - run - text.width, top, text);
					});
				const end = (box: QuadrantBox) => ({
					x: side > 0 ? box.left : box.right,
					y: (box.top + box.bottom) / 2,
				});
				// Two leaders that cross swap their labels, which shortens both: repeat until none cross.
				for (let pass = 0; pass < 4 * ordered.length; pass += 1) {
					const boxes = slots();
					const crossing = ordered.flatMap((first, at) =>
						ordered
							.slice(at + 1)
							.flatMap((second, offset) =>
								quadrantSegmentsCross(
									centers[first]!,
									end(boxes[at]!),
									centers[second]!,
									end(boxes[at + 1 + offset]!),
								)
									? [[at, at + 1 + offset] as const]
									: [],
							),
					)[0];
					if (!crossing) break;
					const [first, second] = crossing;
					[ordered[first], ordered[second]] = [ordered[second]!, ordered[first]!];
				}
				const boxes = slots();
				for (const [at, index] of ordered.entries()) {
					const box = boxes[at]!;
					const route = open(box) ? leaderTo(index, end(box)) : undefined;
					const spot =
						route && (overDots || !route.over)
							? labelSpot(
									box,
									COLUMN_COST + LEADER_OVER_DOT_COST * route.over,
									route.leader,
									route.over,
								)
							: undefined;
					if (!spot || [...spots.values(), ...taken].some((other) => spotsConflict(spot, other))) {
						fits = false;
						break;
					}
					spots.set(index, spot);
				}
				if (!fits) break;
			}
			if (fits) return spots;
		}
	return undefined;
}

/** The widest single word of a text, which no wrap can break. */
function widestWord(text: string, fontSize: number): number {
	return Math.max(
		...text.split(/\s+/u).map((word) => Math.ceil(estimateTextWidth(word, fontSize))),
	);
}

/**
 * The smallest plot every name's longest word fits in a quadrant of, and whose x axis
 * holds its two end labels side by side; none when even the largest plot cannot.
 */
function minimumPlotSize(diagram: QuadrantDiagram): number | undefined {
	const name = Math.max(
		...QUADRANT_KEYS.map((key) => widestWord(diagram.quadrants[key], NAME_FONT)),
	);
	const ends =
		wrapped(diagram.xAxis.low, END_LABEL_WIDTH, END_FONT).width +
		wrapped(diagram.xAxis.high, END_LABEL_WIDTH, END_FONT).width +
		END_LABEL_GAP;
	return QUADRANT_PLOT_SIZES.find((size) => name <= size / 2 - 2 * NAME_PAD && ends <= size);
}

/**
 * The smallest plot whose labels all sit clear, and beside their dots for all but a few;
 * a chart with no such plot is rejected with a repair hint.
 */
export function planQuadrantLayout(diagram: QuadrantDiagram): QuadrantPlan {
	const minimum = minimumPlotSize(diagram);
	if (minimum === undefined)
		throw new QuadrantValidationError([
			{
				code: "invalid_quadrant_text",
				path: "quadrants",
				message:
					"A quadrant name or the x axis's end labels hold a word too long for the largest plot.",
				hint: "Shorten the longest unbroken word in the quadrant names and the x axis's low and high labels, or break it with a space.",
			},
		]);
	const allowance = Math.max(2, Math.ceil(diagram.points.length * 0.2));
	// A plan is worse with more labels blocked, then more leaders over dots, then more leaders.
	const score = (plan: QuadrantPlan) => [plan.blocked + plan.covered, plan.overDots, plan.leaders];
	const worse = (plan: QuadrantPlan, than: QuadrantPlan) => {
		const [a, b] = [score(plan), score(than)];
		const differ = a.findIndex((value, at) => value !== b[at]);
		return differ !== -1 && a[differ]! > b[differ]!;
	};
	const clean = (plan: QuadrantPlan) => plan.blocked + plan.covered + plan.overDots === 0;
	const done = (plan: QuadrantPlan) => clean(plan) && plan.leaders <= allowance + plan.clumped;
	const work: Work = { spent: 0, limit: Number.POSITIVE_INFINITY };
	let best: QuadrantPlan | undefined;
	/** One plot size's plan, kept when it reads better than the best so far. */
	const attempt = (size: number) => {
		let plan = planLayout(diagram, size, { work });
		// A plot this crowded grows before it retries: names give a blocked label more room
		// and the labels try again, and past that, leaders may pass over other dots.
		const retry = plan.blocked > 0 && plan.blocked <= Math.max(3, diagram.points.length / 4);
		if (retry) {
			const again = planLayout(diagram, size, { crowded: new Set(plan.blockedPoints), work });
			if (!worse(again, plan)) plan = again;
		}
		if (retry && plan.blocked) {
			const again = planLayout(diagram, size, {
				crowded: new Set(plan.blockedPoints),
				relaxed: true,
				work,
			});
			if (!worse(again, plan)) plan = again;
		}
		if (!best || worse(best, plan)) best = plan;
		return plan;
	};
	// The largest plot sets its labels a size smaller, searches longer, and only then lets
	// leaders pass over other dots.
	let shrunk: QuadrantPlan | undefined;
	const shrink = () => {
		const crowded = new Set(best!.blockedPoints);
		for (const options of [
			{ labelFont: CROWDED_LABEL_FONT },
			{ labelFont: CROWDED_LABEL_FONT, thorough: true },
			{ labelFont: CROWDED_LABEL_FONT, relaxed: true },
			{ labelFont: CROWDED_LABEL_FONT, relaxed: true, thorough: true },
		]) {
			if ((best!.blocked === 0 && options.relaxed) || work.spent > work.limit) break;
			const plan = planLayout(diagram, QUADRANT_PLOT_SIZES.at(-1)!, { crowded, work, ...options });
			if (worse(best!, plan)) best = plan;
			if (clean(best!)) break;
		}
		shrunk = best;
	};
	// The cheapest search first: a chart grows until its labels sit clear with few leaders,
	// and stops growing for fewer leaders once two larger plots in a row read no better, or
	// for clear labels once two larger plots in a row block no fewer. With a few labels still
	// blocked, the largest plot then sets them smaller.
	const sizes: readonly number[] = QUADRANT_PLOT_SIZES.filter((size) => size >= minimum);
	let next = 0;
	let previous: number | undefined;
	let stalled = 0;
	while (next < sizes.length) {
		if (best && clean(best) && next - sizes.indexOf(best.size) > 2) break;
		const plan = attempt(sizes[next]!);
		next += 1;
		if (done(plan)) return plan;
		stalled =
			plan.blocked > FEW_BLOCKED && previous !== undefined && plan.blocked >= previous
				? stalled + 1
				: 0;
		previous = plan.blocked;
		if (stalled >= 2) break;
	}
	if (!clean(best!) && best!.blocked + best!.covered <= FEW_BLOCKED) shrink();
	// A chart still blocked tries every size it skipped, then the smaller labels again from
	// the best of those, within a fixed budget of spot checks.
	if (best!.blocked || best!.covered) {
		work.limit = work.spent + FALLBACK_WORK;
		for (; next < sizes.length && work.spent <= work.limit; next += 1) {
			const plan = attempt(sizes[next]!);
			if (done(plan)) return plan;
		}
		if (best !== shrunk) shrink();
	}
	// A chart that still cannot place every label clear is rejected, never drawn unreadable.
	if (best!.blocked || best!.covered)
		throw new QuadrantValidationError([
			{
				code: "quadrant_too_large",
				path: best!.blocked ? `points.[${best!.blockedPoints[0]}]` : "quadrants",
				message: best!.blocked
					? `The labels of ${best!.blocked} points cannot all sit clear of the other labels and dots.`
					: "A quadrant name cannot sit clear of every dot in its quadrant.",
				hint: "Spread the scores of points that nearly coincide, shorten their labels or the quadrant names, or split the chart.",
			},
		]);
	return best!;
}

class SceneBuilder {
	readonly elements: SceneElement[] = [];
	private readonly layers: Record<Layer, string[]> = { back: [], middle: [], front: [] };
	readonly textBoxes: QuadrantBox[] = [];

	constructor(readonly surface: string) {}

	push(element: SceneElement, layer: Layer): void {
		this.elements.push(element);
		this.layers[layer].push(element.id);
	}

	zOrder(): string[] {
		return [...this.layers.back, ...this.layers.middle, ...this.layers.front];
	}

	text(
		id: string,
		value: Measured,
		box: QuadrantBox,
		fontSize: number,
		color: string,
		align: "center" | "left" | "right",
		groupId?: string,
	): void {
		this.push(
			{
				type: "text",
				id,
				x: round((box.left + box.right) / 2),
				y: round((box.top + box.bottom) / 2),
				text: value.text,
				fontSize,
				maxWidth: value.width,
				textAlign: align,
				textColor: color,
				...(groupId ? { groupIds: [groupId] } : {}),
			} satisfies TextSceneElement,
			"front",
		);
		this.textBoxes.push(box);
	}

	line(
		id: string,
		from: ScenePoint,
		to: ScenePoint,
		style: Partial<LineSceneElement>,
		layer: Layer = "middle",
	): void {
		this.push(
			{
				type: "line",
				id,
				points: [
					{ x: round(from.x), y: round(from.y) },
					{ x: round(to.x), y: round(to.y) },
				],
				roughness: 0,
				strokeWidth: 1,
				...style,
			} satisfies LineSceneElement,
			layer,
		);
	}

	mark(
		nodeId: string,
		shape: NodeSceneElement["shape"],
		box: QuadrantBox,
		label: string,
		style: Partial<NodeSceneElement>,
		layer: Layer,
	): void {
		this.push(
			{
				type: "node",
				id: `node:${nodeId}`,
				nodeId,
				rendererRole: QUADRANT_MARK_ROLE,
				shape,
				x: round(box.left),
				y: round(box.top),
				width: round(box.right - box.left),
				height: round(box.bottom - box.top),
				label,
				roughness: 0,
				fillStyle: "solid",
				strokeWidth: 1,
				...style,
			} satisfies NodeSceneElement,
			layer,
		);
	}

	bounds(): QuadrantBox {
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		const include = (box: QuadrantBox) => {
			left = Math.min(left, box.left);
			top = Math.min(top, box.top);
			right = Math.max(right, box.right);
			bottom = Math.max(bottom, box.bottom);
		};
		for (const element of this.elements) {
			if (element.type === "line" || element.type === "arrow")
				for (const point of element.points)
					include({ left: point.x, top: point.y, right: point.x, bottom: point.y });
			else if (element.type === "node")
				include({
					left: element.x,
					top: element.y,
					right: element.x + element.width,
					bottom: element.y + element.height,
				});
		}
		for (const box of this.textBoxes) include(box);
		return { left, top, right, bottom };
	}
}

/** The x axis under the plot and the y axis beside it, each an arrow toward its high end. */
function drawAxes(builder: SceneBuilder, diagram: QuadrantDiagram, size: number): void {
	const axisStyle = {
		strokeColor: MUTED_INK,
		strokeWidth: 2 as const,
		endArrowhead: "arrow" as const,
	};
	const xGroup = "quadrant:axis:x";
	const yGroup = "quadrant:axis:y";
	builder.line(
		xGroup,
		{ x: 0, y: size + AXIS_OFFSET },
		{ x: size, y: size + AXIS_OFFSET },
		{ ...axisStyle, groupIds: [xGroup] },
	);
	builder.line(
		yGroup,
		{ x: -AXIS_OFFSET, y: size },
		{ x: -AXIS_OFFSET, y: 0 },
		{ ...axisStyle, groupIds: [yGroup] },
	);
	// Under the x axis: the low end at the left, the high end at the right (the plot is wide
	// enough for both), and the title between them or on a row of its own.
	const row = size + AXIS_OFFSET + AXIS_TEXT_GAP;
	const low = wrapped(diagram.xAxis.low, END_LABEL_WIDTH, END_FONT);
	const high = wrapped(diagram.xAxis.high, END_LABEL_WIDTH, END_FONT);
	const title = wrapped(diagram.xAxis.title, size, AXIS_TITLE_FONT);
	const lowBox = boxAt(0, row, low);
	const highBox = boxAt(size - high.width, row, high);
	let titleBox = boxAt(size / 2 - title.width / 2, row, title);
	if (overlaps(titleBox, lowBox, END_LABEL_GAP) || overlaps(titleBox, highBox, END_LABEL_GAP))
		titleBox = boxAt(
			size / 2 - title.width / 2,
			Math.max(lowBox.bottom, highBox.bottom) + 4,
			title,
		);
	builder.text(`${xGroup}:low`, low, lowBox, END_FONT, MUTED_INK, "left", xGroup);
	builder.text(`${xGroup}:high`, high, highBox, END_FONT, MUTED_INK, "right", xGroup);
	builder.text(`${xGroup}:title`, title, titleBox, AXIS_TITLE_FONT, INK, "center", xGroup);
	// Left of the y axis: the high end at the top, the low end at the bottom, the title between.
	const edge = -AXIS_OFFSET - AXIS_TEXT_GAP;
	const yHigh = wrapped(diagram.yAxis.high, AXIS_LABEL_WIDTH, END_FONT);
	const yLow = wrapped(diagram.yAxis.low, AXIS_LABEL_WIDTH, END_FONT);
	const yTitle = wrapped(diagram.yAxis.title, AXIS_LABEL_WIDTH, AXIS_TITLE_FONT);
	const yHighBox = boxAt(edge - yHigh.width, 0, yHigh);
	const yLowBox = boxAt(edge - yLow.width, size - yLow.height, yLow);
	const titleTop = Math.min(
		Math.max(size / 2 - yTitle.height / 2, yHighBox.bottom + 12),
		yLowBox.top - 12 - yTitle.height,
	);
	builder.text(`${yGroup}:high`, yHigh, yHighBox, END_FONT, MUTED_INK, "right", yGroup);
	builder.text(`${yGroup}:low`, yLow, yLowBox, END_FONT, MUTED_INK, "right", yGroup);
	builder.text(
		`${yGroup}:title`,
		yTitle,
		boxAt(edge - yTitle.width, titleTop, yTitle),
		AXIS_TITLE_FONT,
		INK,
		"right",
		yGroup,
	);
}

/** Title, then a legend row of groups, left-aligned above everything else. */
function drawHeader(
	builder: SceneBuilder,
	diagram: QuadrantDiagram,
	groups: readonly string[],
	colors: ReadonlyMap<string, string>,
): void {
	const content = builder.bounds();
	const width = Math.max(content.right - content.left, 360);
	let bottom = content.top - 18;
	if (groups.length) {
		const items = groups.map((group, index) => {
			const text = wrapped(group, 200, LEGEND_FONT);
			return { index, group, text, width: 12 + 6 + text.width };
		});
		const rows: (typeof items)[] = [[]];
		let rowWidth = 0;
		for (const item of items) {
			const row = rows.at(-1)!;
			if (row.length && rowWidth + 18 + item.width > width) {
				rows.push([item]);
				rowWidth = item.width;
			} else {
				rowWidth += (row.length ? 18 : 0) + item.width;
				row.push(item);
			}
		}
		const heights = rows.map((row) => Math.max(...row.map((item) => item.text.height)));
		let top = bottom - heights.reduce((sum, height) => sum + height, 0) - (rows.length - 1) * 6;
		bottom = top - 12;
		rows.forEach((row, rowIndex) => {
			const height = heights[rowIndex]!;
			const middle = top + height / 2;
			let left = content.left;
			for (const item of row) {
				const group = `quadrant:legend:${item.index}`;
				const color = colors.get(item.group)!;
				builder.mark(
					`quadrant:key:${item.index}`,
					"ellipse",
					{ left, top: middle - 6, right: left + 12, bottom: middle + 6 },
					item.group,
					{ fillColor: color, strokeColor: builder.surface, strokeWidth: 2, groupIds: [group] },
					"front",
				);
				builder.text(
					`${group}:label`,
					item.text,
					boxAt(left + 18, middle - item.text.height / 2, item.text),
					LEGEND_FONT,
					INK,
					"left",
					group,
				);
				left += item.width + 18;
			}
			top += height + 6;
		});
	}
	const title = wrapped(diagram.title, width, TITLE_FONT);
	builder.text(
		"quadrant:title",
		title,
		boxAt(content.left, bottom - title.height, title),
		TITLE_FONT,
		INK,
		"left",
	);
}

/**
 * Lay out a quadrant chart deterministically: four tinted quadrants on a
 * square plot with their names in their corners, axis arrows carrying their
 * end labels, and every point's dot at its exact position with its label
 * beside it, or on a leader line where the plot is crowded.
 */
export function renderQuadrantDiagram(input: QuadrantDiagram): RenderedDiagramScene {
	const diagram = validateQuadrantDiagram(input);
	const surface = diagram.style.backgroundColor;
	const builder = new SceneBuilder(surface);
	const plan = planQuadrantLayout(diagram);
	const { size } = plan;
	const quadrants = quadrantBoxes(size);
	for (const key of Object.keys(quadrants) as QuadrantKey[]) {
		const tint = wash(QUADRANT_HUES[key], surface, WASH);
		const group = `quadrant:region:${key}`;
		builder.mark(
			group,
			"rectangle",
			quadrants[key],
			diagram.quadrants[key],
			{ fillColor: tint, strokeColor: tint, groupIds: [group] },
			"back",
		);
		const name = plan.names[key];
		builder.text(
			`quadrant:name:${key}`,
			name.text,
			name.box,
			NAME_FONT,
			MUTED_INK,
			key === "topRight" || key === "bottomRight" ? "right" : "left",
			group,
		);
	}
	const midline = { strokeColor: MIDLINE_COLOR };
	builder.line(
		"quadrant:midline:vertical",
		{ x: size / 2, y: 0 },
		{ x: size / 2, y: size },
		midline,
	);
	builder.line(
		"quadrant:midline:horizontal",
		{ x: 0, y: size / 2 },
		{ x: size, y: size / 2 },
		midline,
	);
	drawAxes(builder, diagram, size);
	const groups = quadrantGroups(diagram);
	const colors = new Map(groups.map((group, index) => [group, CHART_SERIES_COLORS[index]!]));
	const groupOf = (name: string | undefined) =>
		name === undefined
			? undefined
			: groups.find((group) => quadrantGroupKey(group) === quadrantGroupKey(name));
	const plot = { left: 0, top: 0, right: size, bottom: size };
	diagram.points.forEach((point, index) => {
		const group = `quadrant:point:${index}`;
		const center = quadrantPointPosition(point, plot);
		const pointGroup = groupOf(point.group);
		const color =
			pointGroup !== undefined
				? colors.get(pointGroup)!
				: groups.length
					? UNGROUPED_COLOR
					: CHART_SERIES_COLORS[0];
		builder.mark(
			group,
			"ellipse",
			dotBox(center),
			point.label,
			{ fillColor: color, strokeColor: surface, strokeWidth: 2, groupIds: [group] },
			"front",
		);
		const label = plan.labels[index]!;
		if (label.leader)
			builder.line(`quadrant:leader:${index}`, label.leader[0], label.leader[1], {
				strokeColor: LEADER_COLOR,
				groupIds: [group],
			});
		builder.text(
			`quadrant:label:${index}`,
			label.text,
			label.box,
			plan.labelFont,
			INK,
			label.box.left >= center.x ? "left" : label.box.right <= center.x ? "right" : "center",
			group,
		);
	});
	drawHeader(builder, diagram, groups, colors);
	const box = builder.bounds();
	const dx = PADDING - box.left;
	const dy = PADDING - box.top;
	const elements = builder.elements.map((element): SceneElement => {
		if (element.type === "line") {
			const [first, second, ...rest] = element.points.map((point) => ({
				x: round(point.x + dx),
				y: round(point.y + dy),
			}));
			return { ...element, points: [first!, second!, ...rest] };
		}
		if (element.type === "arrow") return element;
		return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
	});
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: Math.ceil(box.right - box.left + PADDING * 2),
		height: Math.ceil(box.bottom - box.top + PADDING * 2),
		accentColor: diagram.style.accentColor,
		backgroundColor: diagram.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder: builder.zOrder(),
	};
}
