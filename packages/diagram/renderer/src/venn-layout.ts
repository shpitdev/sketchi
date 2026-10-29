import {
	estimateTextWidth,
	vennRegionKey,
	wrapTextToWidth,
	type VennDiagram,
} from "@sketchi/diagram-core";

export const VENN_ITEM_FONT = 15;
export const VENN_REGION_LABEL_FONT = 17;
export const VENN_COUNT_FONT = 26;
export const VENN_SET_LABEL_FONT = 20;
export const VENN_LINE_HEIGHT = 1.35;
/** Text keeps at least this far inside its region, clear of every outline. */
export const VENN_TEXT_MARGIN = 10;
/** A set's label sits this far outside its circle. */
export const VENN_SET_LABEL_GAP = 10;
/** Items in one region stand this far apart; lines of one item sit flush. */
const ITEM_GAP = 7;
const REGION_LABEL_GAP = 4;
/** Circles never shrink below this, so an empty or sparse diagram still reads. */
const MIN_RADIUS = { 2: 110, 3: 120 } as const;
const MAX_RADIUS = 2_400;
/** Centre distance over radius: the canonical arrangement first, then tighter or looser. */
const SEPARATIONS = [1, 0.9, 1.1, 0.8, 1.2, 0.7, 1.3, 0.6, 1.4] as const;
/** How much a separation away from the canonical one must save in area to win. */
const SEPARATION_PENALTY = 0.4;
/** Item wrap widths tried in each region: natural lines first, then narrower. */
const WRAP_WIDTHS = [Infinity, 220, 170, 130, 100, 75] as const;
/** How much larger a region may grow to keep its lines whole rather than wrap them. */
const WRAP_ALLOWANCE = 0.2;

export interface VennPoint {
	readonly x: number;
	readonly y: number;
}

export interface VennCircle extends VennPoint {
	readonly r: number;
}

export interface VennBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** One line of a region's text, its top relative to the block's top. */
export interface VennTextLine {
	readonly text: string;
	readonly fontSize: number;
	readonly width: number;
	readonly height: number;
	readonly top: number;
}

/** One drawn text of a region: its label, one item (possibly wrapped), or its count. */
export interface VennTextPiece {
	readonly role: "label" | "item" | "count";
	readonly index: number;
	readonly text: string;
	readonly fontSize: number;
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly lines: readonly VennTextLine[];
}

export interface VennBlock {
	readonly pieces: readonly VennTextPiece[];
	readonly lines: readonly VennTextLine[];
	readonly width: number;
	readonly height: number;
}

export interface VennRegionPlan {
	/** Set indexes, ascending. */
	readonly key: readonly number[];
	readonly block: VennBlock;
	/** The block's center. */
	readonly center: VennPoint;
	/** The closest any line comes to an outline it must stay clear of. */
	readonly clearance: number;
}

export interface VennSetLabelPlan {
	readonly text: string;
	readonly width: number;
	readonly height: number;
	readonly box: VennBox;
}

export interface VennLayout {
	readonly radius: number;
	readonly separation: number;
	readonly circles: readonly VennCircle[];
	readonly regions: readonly VennRegionPlan[];
	readonly labels: readonly VennSetLabelPlan[];
	/** Placements tried, for the deterministic work guard. */
	readonly work: number;
}

function measureLines(text: string, fontSize: number, top: number): VennTextLine[] {
	const height = fontSize * VENN_LINE_HEIGHT;
	return text.split("\n").map((line, index) => ({
		text: line,
		fontSize,
		width: Math.ceil(estimateTextWidth(line, fontSize)),
		height,
		top: top + index * height,
	}));
}

/** Whole words only: a word wider than the wrap width keeps its own line. */
function wrapWhole(text: string, width: number, fontSize: number): string {
	return wrapLines(text, width, fontSize).text;
}

/**
 * Wrap each authored line on its own at word boundaries. `whole` is false when
 * a wrap had to split a Latin word; the natural lines are always whole.
 */
function wrapLines(
	text: string,
	width: number,
	fontSize: number,
): { text: string; whole: boolean } {
	let whole = true;
	const lines = text
		.trim()
		.split(/\s*\n\s*/u)
		.map((line) => {
			if (!Number.isFinite(width)) return line;
			const wrapped = wrapTextToWidth(line, width, fontSize);
			if (!breaksBetweenWords(line, wrapped)) whole = false;
			return wrapped;
		});
	return { text: lines.join("\n"), whole };
}

interface RegionContent {
	readonly label?: string;
	readonly items: readonly string[];
	readonly count?: number;
}

function blockFor(content: RegionContent, wrapWidth: number): VennBlock & { whole: boolean } {
	const pieces: VennTextPiece[] = [];
	let top = 0;
	let whole = true;
	const wrap = (text: string, width: number, fontSize: number) => {
		const wrapped = wrapLines(text, width, fontSize);
		whole &&= wrapped.whole;
		return wrapped.text;
	};
	const add = (role: VennTextPiece["role"], index: number, text: string, fontSize: number) => {
		if (pieces.length)
			top += role === "item" && pieces.at(-1)?.role === "item" ? ITEM_GAP : REGION_LABEL_GAP;
		const lines = measureLines(text, fontSize, top);
		const height = lines.length * fontSize * VENN_LINE_HEIGHT;
		pieces.push({
			role,
			index,
			text,
			fontSize,
			width: Math.max(...lines.map((line) => line.width)),
			height,
			top,
			lines,
		});
		top += height;
	};
	if (content.label !== undefined)
		add(
			"label",
			0,
			wrap(content.label, Math.max(wrapWidth, 120), VENN_REGION_LABEL_FONT),
			VENN_REGION_LABEL_FONT,
		);
	if (content.count !== undefined)
		add("count", 0, content.count.toLocaleString("en-US"), VENN_COUNT_FONT);
	content.items.forEach((item, index) =>
		add("item", index, wrap(item, wrapWidth, VENN_ITEM_FONT), VENN_ITEM_FONT),
	);
	const lines = pieces.flatMap((piece) => piece.lines);
	return {
		pieces,
		lines,
		width: Math.max(0, ...lines.map((line) => line.width)),
		height: top,
		whole,
	};
}

const WIDE_GLYPH = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

/** Whether every line break falls at a space, or beside a wide glyph that breaks on its own. */
function breaksBetweenWords(original: string, wrapped: string): boolean {
	const text = original.trim();
	const lines = wrapped.split("\n");
	let at = 0;
	for (const [index, line] of lines.entries()) {
		if (!text.startsWith(line, at)) return false;
		at += line.length;
		if (index === lines.length - 1) break;
		if (text[at] === " ") {
			while (text[at] === " ") at += 1;
			continue;
		}
		if (!WIDE_GLYPH.test(line.at(-1) ?? "") && !WIDE_GLYPH.test(lines[index + 1]?.[0] ?? ""))
			return false;
	}
	return at === text.length;
}

/** The distinct blocks a region's text can take, one per useful wrap width that keeps words whole. */
function blockOptions(content: RegionContent): VennBlock[] {
	const options: VennBlock[] = [];
	const seen = new Set<string>();
	// The natural lines come first and are always whole, so a region always has a block.
	for (const width of WRAP_WIDTHS) {
		const { whole, ...block } = blockFor(content, width);
		if (!whole) continue;
		const signature = block.pieces.map((piece) => piece.text).join("\u0000");
		if (seen.has(signature)) continue;
		seen.add(signature);
		options.push(block);
	}
	return options;
}

/** Unit-radius centres of the symmetric arrangement, centroid at the origin. */
export function vennUnitCentres(count: number, separation: number): VennPoint[] {
	const d = separation;
	if (count === 2)
		return [
			{ x: -d / 2, y: 0 },
			{ x: d / 2, y: 0 },
		];
	const h = (d * Math.sqrt(3)) / 2;
	return [
		{ x: -d / 2, y: -h / 3 },
		{ x: d / 2, y: -h / 3 },
		{ x: 0, y: (2 * h) / 3 },
	];
}

function circlesAt(count: number, separation: number, radius: number): VennCircle[] {
	return vennUnitCentres(count, separation).map((centre) => ({
		x: centre.x * radius,
		y: centre.y * radius,
		r: radius,
	}));
}

/** How far a box's farthest corner sits inside a circle (negative: it pokes out). */
export function insideClearance(box: VennBox, circle: VennCircle): number {
	const dx = Math.max(Math.abs(box.left - circle.x), Math.abs(box.right - circle.x));
	const dy = Math.max(Math.abs(box.top - circle.y), Math.abs(box.bottom - circle.y));
	return circle.r - Math.hypot(dx, dy);
}

/** How far a box stays outside a circle (negative: the circle reaches into it). */
export function outsideClearance(box: VennBox, circle: VennCircle): number {
	const dx = Math.max(box.left - circle.x, 0, circle.x - box.right);
	const dy = Math.max(box.top - circle.y, 0, circle.y - box.bottom);
	return Math.hypot(dx, dy) - circle.r;
}

/** The clearance of a box from a region's outlines: inside its own sets, outside the rest. */
export function regionClearance(
	box: VennBox,
	circles: readonly VennCircle[],
	key: readonly number[],
): number {
	let clearance = Infinity;
	circles.forEach((circle, index) => {
		const value = key.includes(index)
			? insideClearance(box, circle)
			: outsideClearance(box, circle);
		if (value < clearance) clearance = value;
	});
	return clearance;
}

export function lineBox(line: VennTextLine, centre: VennPoint, blockHeight: number): VennBox {
	const top = centre.y - blockHeight / 2 + line.top;
	return {
		left: centre.x - line.width / 2,
		right: centre.x + line.width / 2,
		top,
		bottom: top + line.height,
	};
}

const DIRECTIONS = [
	[1, 0],
	[-1, 0],
	[0, -1],
	[0, 1],
	[Math.SQRT1_2, Math.SQRT1_2],
	[-Math.SQRT1_2, Math.SQRT1_2],
	[Math.SQRT1_2, -Math.SQRT1_2],
	[-Math.SQRT1_2, -Math.SQRT1_2],
] as const;

interface Counter {
	work: number;
}

/** Hill-climb a clearance from a start, halving the step until it settles below half a pixel. */
function climb(
	start: VennPoint,
	initialStep: number,
	clearanceAt: (point: VennPoint) => number,
	counter: Counter,
): { point: VennPoint; clearance: number } {
	let point = start;
	let best = clearanceAt(point);
	let step = initialStep;
	for (let round = 0; step >= 0.5 && round < 400; round += 1) {
		let next: VennPoint | undefined;
		for (const [dx, dy] of DIRECTIONS) {
			const candidate = { x: point.x + dx * step, y: point.y + dy * step };
			const value = clearanceAt(candidate);
			counter.work += 1;
			if (value > best + 1e-9) {
				best = value;
				next = candidate;
			}
		}
		if (next) point = next;
		else step /= 2;
	}
	return { point, clearance: best };
}

/** The point of a region farthest inside it: where a block starts its search. */
function regionPole(
	circles: readonly VennCircle[],
	key: readonly number[],
	counter: Counter,
): VennPoint {
	const inside = key.map((index) => circles[index]!);
	const outside = circles.filter((_, index) => !key.includes(index));
	const mean = (points: readonly VennPoint[]) => ({
		x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
		y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
	});
	const own = mean(inside);
	let start = own;
	if (outside.length) {
		const away = mean(outside);
		const dx = own.x - away.x;
		const dy = own.y - away.y;
		const length = Math.hypot(dx, dy) || 1;
		start = {
			x: own.x + (dx / length) * inside[0]!.r * 0.4,
			y: own.y + (dy / length) * inside[0]!.r * 0.4,
		};
	}
	const radius = circles[0]!.r;
	return climb(
		start,
		radius / 4,
		(point) =>
			regionClearance(
				{ left: point.x, right: point.x, top: point.y, bottom: point.y },
				circles,
				key,
			),
		counter,
	).point;
}

/**
 * Move a point to the middle of the stretch, across and down, where the
 * clearance stays at least `level`: a block with room to spare sits centred in
 * its region instead of wherever the climb stopped on a flat ridge.
 */
function centreInLevel(
	start: VennPoint,
	level: number,
	reach: number,
	clearanceAt: (point: VennPoint) => number,
	counter: Counter,
): VennPoint {
	let point = start;
	const extent = (dx: number, dy: number) => {
		let inside = 0;
		let outside = reach;
		for (let distance = 2; distance <= reach; distance += 2) {
			counter.work += 1;
			if (clearanceAt({ x: point.x + dx * distance, y: point.y + dy * distance }) < level) {
				outside = distance;
				break;
			}
			inside = distance;
		}
		while (outside - inside > 0.25) {
			const mid = (inside + outside) / 2;
			counter.work += 1;
			if (clearanceAt({ x: point.x + dx * mid, y: point.y + dy * mid }) >= level) inside = mid;
			else outside = mid;
		}
		return inside;
	};
	for (let pass = 0; pass < 3; pass += 1) {
		const across = (extent(1, 0) - extent(-1, 0)) / 2;
		point = { x: point.x + across, y: point.y };
		const down = (extent(0, 1) - extent(0, -1)) / 2;
		point = { x: point.x, y: point.y + down };
	}
	return point;
}

function placeBlock(
	block: VennBlock,
	circles: readonly VennCircle[],
	key: readonly number[],
	pole: VennPoint,
	counter: Counter,
	centre = false,
): { center: VennPoint; clearance: number } {
	const clearanceAt = (point: VennPoint) => {
		let clearance = Infinity;
		for (const line of block.lines) {
			const value = regionClearance(lineBox(line, point, block.height), circles, key);
			if (value < clearance) clearance = value;
		}
		return clearance;
	};
	const radius = circles[0]!.r;
	const { point, clearance } = climb(pole, radius / 4, clearanceAt, counter);
	if (!centre || clearance < VENN_TEXT_MARGIN) return { center: point, clearance };
	// Anything within a few pixels (or a sixth of the spare room) of the best reads as centred.
	const level = Math.max(
		VENN_TEXT_MARGIN,
		clearance - Math.max(2, (clearance - VENN_TEXT_MARGIN) / 6),
	);
	const centred = centreInLevel(point, level, radius * 2, clearanceAt, counter);
	return { center: centred, clearance: clearanceAt(centred) };
}

interface RegionFit {
	readonly block: VennBlock;
	readonly center: VennPoint;
	readonly clearance: number;
}

/** The best-placed block a region can take at one size, or none that clears the margin. */
function fitRegion(
	options: readonly VennBlock[],
	circles: readonly VennCircle[],
	key: readonly number[],
	counter: Counter,
	pole: VennPoint,
	centre = false,
): RegionFit | undefined {
	// Options run from the widest wrap down: the first that clears the margin keeps lines whole.
	for (const block of options) {
		const placed = placeBlock(block, circles, key, pole, counter, centre);
		if (placed.clearance >= VENN_TEXT_MARGIN) return { block, ...placed };
	}
	return undefined;
}

interface RegionInput {
	readonly key: readonly number[];
	readonly options: readonly VennBlock[];
}

/** The smallest radius (to 1 px) at which one block clears its region's outlines. */
function blockRadius(
	block: VennBlock,
	key: readonly number[],
	count: number,
	separation: number,
	floor: number,
	ceiling: number,
	counter: Counter,
): number {
	const fits = (radius: number) => {
		const circles = circlesAt(count, separation, radius);
		const pole = regionPole(circles, key, counter);
		return placeBlock(block, circles, key, pole, counter).clearance >= VENN_TEXT_MARGIN;
	};
	if (fits(floor)) return floor;
	let low = floor;
	let high = Math.min(floor * 2, ceiling);
	while (!fits(high)) {
		if (high >= ceiling) return Infinity;
		low = high;
		high = Math.min(high * 2, ceiling);
	}
	while (high - low > 1) {
		const mid = Math.round((low + high) / 2);
		if (fits(mid)) high = mid;
		else low = mid;
	}
	return high;
}

/**
 * The radius a region needs: the smallest at which its widest wrap fits, unless
 * a narrower wrap saves more than a fifth of that, so lines stay whole where
 * the circles barely need to grow for them.
 */
function minimumRadius(
	region: RegionInput,
	count: number,
	separation: number,
	floor: number,
	counter: Counter,
): number {
	let best = Infinity;
	const radii: number[] = [];
	for (const block of region.options) {
		const radius = blockRadius(
			block,
			region.key,
			count,
			separation,
			floor,
			Math.min(best, MAX_RADIUS),
			counter,
		);
		radii.push(radius);
		best = Math.min(best, radius);
		if (radius === floor) break;
	}
	if (!Number.isFinite(best)) return MAX_RADIUS;
	return radii.find((radius) => radius <= best * (1 + WRAP_ALLOWANCE)) ?? best;
}

function unitExtent(count: number, separation: number): { width: number; height: number } {
	return count === 2
		? { width: 2 + separation, height: 2 }
		: { width: 2 + separation, height: 2 + (separation * Math.sqrt(3)) / 2 };
}

/** The regions with text to draw. In a diagram of items, a count of 0 is an empty region and draws nothing. */
function contentFor(diagram: VennDiagram): RegionInput[] {
	const regions: RegionInput[] = [];
	// A diagram that lists items and no positive count holds no data in a 0; one of counts does.
	const itemized = diagram.regions.some((region) => (region.items?.length ?? 0) > 0);
	const counted = diagram.regions.some((region) => (region.count ?? 0) > 0);
	for (const region of diagram.regions) {
		const items = region.items ?? [];
		const count = region.count === 0 && itemized && !counted ? undefined : region.count;
		if (region.label === undefined && count === undefined && items.length === 0) continue;
		regions.push({
			key: vennRegionKey(diagram, region),
			options: blockOptions({
				...(region.label === undefined ? {} : { label: region.label }),
				items,
				...(count === undefined ? {} : { count }),
			}),
		});
	}
	return regions;
}

function setLabels(
	diagram: VennDiagram,
	circles: readonly VennCircle[],
	radius: number,
	counter: Counter,
): VennSetLabelPlan[] {
	const width = Math.max(radius * 1.6, 180);
	const measured = diagram.sets.map((set) => {
		const text = wrapWhole(set.label, width, VENN_SET_LABEL_FONT);
		const lines = measureLines(text, VENN_SET_LABEL_FONT, 0);
		return {
			text,
			width: Math.max(...lines.map((line) => line.width)),
			height: lines.length * VENN_SET_LABEL_FONT * VENN_LINE_HEIGHT,
		};
	});
	// The upper two sets label above their circles, a third below its own, each
	// over the part only it covers, so a label never reads as an overlap's.
	const top = Math.min(...circles.map((circle) => circle.y - circle.r));
	const centres = measured.map((label, index) => {
		const circle = circles[index]!;
		const own = regionPole(circles, [index], counter);
		return index === 2
			? { x: own.x, top: circle.y + circle.r + VENN_SET_LABEL_GAP }
			: { x: own.x, top: top - VENN_SET_LABEL_GAP - label.height };
	});
	// Labels above keep apart: each stays on its own side of the middle when they would meet.
	const [first, second] = measured;
	if (first && second) {
		const gap = 16;
		const firstRight = centres[0]!.x + first.width / 2;
		const secondLeft = centres[1]!.x - second.width / 2;
		if (firstRight > -gap / 2) centres[0] = { ...centres[0]!, x: -gap / 2 - first.width / 2 };
		if (secondLeft < gap / 2) centres[1] = { ...centres[1]!, x: gap / 2 + second.width / 2 };
	}
	return measured.map((label, index) => {
		const { x, top } = centres[index]!;
		return {
			...label,
			box: {
				left: x - label.width / 2,
				right: x + label.width / 2,
				top,
				bottom: top + label.height,
			},
		};
	});
}

/**
 * Lay out a Venn diagram: the canonical symmetric arrangement, at the smallest
 * radius and the separation that let every region's text sit inside its
 * region, clear of every outline, at a readable size.
 */
export function layoutVennDiagram(diagram: VennDiagram): VennLayout {
	const count = diagram.sets.length;
	const floor: number = count === 2 ? MIN_RADIUS[2] : MIN_RADIUS[3];
	const regions = contentFor(diagram);
	const counter: Counter = { work: 0 };
	let chosen = { separation: 1, radius: floor, score: Infinity };
	for (const separation of SEPARATIONS) {
		let radius = floor;
		for (const region of regions)
			radius = Math.max(radius, minimumRadius(region, count, separation, radius, counter));
		// The diagram's width (its larger side), with a cost for leaving the canonical arrangement.
		const score =
			radius *
			unitExtent(count, separation).width *
			(1 + SEPARATION_PENALTY * Math.abs(separation - 1));
		if (score < chosen.score - 1e-6) chosen = { separation, radius, score };
	}
	const circles = circlesAt(count, chosen.separation, chosen.radius);
	const placed = regions.map((region): VennRegionPlan => {
		const fit = fitRegion(
			region.options,
			circles,
			region.key,
			counter,
			regionPole(circles, region.key, counter),
			true,
		);
		// minimumRadius guarantees a fit; fall back to the first wrap at the pole otherwise.
		const block = fit?.block ?? region.options[0]!;
		return {
			key: region.key,
			block,
			center: fit?.center ?? regionPole(circles, region.key, counter),
			clearance: fit?.clearance ?? -Infinity,
		};
	});
	return {
		radius: chosen.radius,
		separation: chosen.separation,
		circles,
		regions: placed,
		labels: setLabels(diagram, circles, chosen.radius, counter),
		work: counter.work,
	};
}
