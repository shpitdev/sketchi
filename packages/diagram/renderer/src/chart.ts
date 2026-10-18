import {
	CANVAS_SPEC_VERSION,
	estimateTextWidth,
	SKETCHI_DIAGRAM_PALETTE,
	validateChartDiagram,
	wrapTextToWidth,
	type ChartDiagram,
	type ChartOrientation,
} from "@sketchi/diagram-core";

import {
	extendScale,
	formatTick,
	formatValue,
	niceScale,
	piePercentages,
	unitParts,
	valueDecimals,
	valueDomain,
	type UnitParts,
	type ValueScale,
} from "./chart-scale.js";
import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	ScenePoint,
	TextSceneElement,
} from "./scene.js";

export const CHART_MARK_ROLE = "chart-mark";

/** A chart mark keeps its role only while it still reads as one: an unlabeled shape on its chart id. */
export function isStructurallyValidChartMark(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly icon?: unknown;
}): boolean {
	return (
		element.nodeId.startsWith("chart:") &&
		element.id === `node:${element.nodeId}` &&
		element.icon === undefined
	);
}

/**
 * Categorical series colors in fixed order. Every adjacent pair stays apart
 * for common color-vision deficiencies on the card surface; series also carry
 * a legend, direct labels or marker shapes, so color never works alone.
 */
export const CHART_SERIES_COLORS = [
	"#2a78d6",
	"#eb6834",
	"#1baf7a",
	"#eda100",
	"#e87ba4",
	"#008300",
	"#6250d6",
	"#e34948",
] as const;

const PADDING = 40;
const LINE_HEIGHT = 1.35;
const TITLE_FONT = 20;
const LEGEND_FONT = 14;
const AXIS_TITLE_FONT = 14;
const TICK_FONT = 13;
const CATEGORY_FONT = 14;
const VALUE_FONT = 12;
const SLICE_FONT = 14;

const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const MUTED_INK = "#4c4639";
const GRID_COLOR = "#e6dfd2";
const BASELINE_COLOR = "#8c826f";

/** Vertical plot height for columns, and line charts. */
const COLUMN_PLOT_HEIGHT = 300;
const LINE_PLOT_HEIGHT = 280;
/** Horizontal bars run this far at full scale. */
const BAR_PLOT_WIDTH = 480;
/** Column bands spread toward this plot width, and auto orientation turns past the cap. */
const COLUMN_TARGET_WIDTH = 720;
const COLUMN_MAX_WIDTH = 960;
const MIN_PLOT_WIDTH = 320;
const BAR_GAP = 2;
const LABEL_GAP = 4;
/** A stacked segment's outside label starts this far past its stack's widest part. */
const LEADER_RUN = 10;
/** A column label wraps to at most this many lines before the bars turn horizontal. */
const COLUMN_LABEL_LINES = 2;
const CATEGORY_LABEL_MAX_WIDTH = 220;
const PIE_RADIUS = 150;
const DONUT_RATIO = 0.58;
const PIE_LABEL_WIDTH = 160;
const PIE_ARC_STEP = (3 * Math.PI) / 180;
/** Outside labels this close to vertical may move to the other column to balance the sides. */
const PIE_SWAP_ANGLE = (20 * Math.PI) / 180;
/** A full slice stops this far (radians) short of closing on its own first point. */
const FULL_SLICE_GAP = 1e-4;

type Layer = "back" | "middle" | "front";

interface Box {
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

/** Wrap at word boundaries; words stay whole even when wider than the line. */
function wrapped(text: string, width: number, fontSize: number): Measured {
	return measure(wrapTextToWidth(text, Math.max(1, width), fontSize), fontSize);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function overlaps(a: Box, b: Box, gap = 0): boolean {
	return (
		a.left < b.right + gap &&
		b.left < a.right + gap &&
		a.top < b.bottom + gap &&
		b.top < a.bottom + gap
	);
}

/**
 * Starts for labels on one line (a column or a row) near their preferred
 * centers, in input order: none overlaps another, and all stay in [min, max]
 * while there is room.
 */
function stackLabels(
	entries: readonly { readonly preferred: number; readonly size: number }[],
	min: number,
	max: number,
	gap: number,
): number[] {
	const order = entries
		.map((_, index) => index)
		.toSorted((a, b) => entries[a]!.preferred - entries[b]!.preferred);
	const starts: number[] = Array.from({ length: entries.length }, () => 0);
	let floor = min;
	for (const index of order) {
		const entry = entries[index]!;
		const start = Math.max(entry.preferred - entry.size / 2, floor);
		starts[index] = start;
		floor = start + entry.size + gap;
	}
	let limit = max;
	for (const index of order.toReversed()) {
		const entry = entries[index]!;
		const start = Math.min(starts[index]!, limit - entry.size);
		starts[index] = start;
		limit = start - gap;
	}
	return starts;
}

/** Relative luminance, for choosing ink or white text on a fill. */
function luminance(hex: string): number {
	const channel = (offset: number) => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Ink or white, whichever contrasts more with the fill. */
function textOn(fill: string): string {
	const background = luminance(fill);
	return contrast(background, luminance(INK)) >= contrast(background, 1) ? INK : "#ffffff";
}

/** Pies need one color per slice; seven slices skip violet, which sits too close to blue at the seam. */
export function chartColors(count: number, ring: boolean): string[] {
	const colors: string[] = [...CHART_SERIES_COLORS.slice(0, count)];
	if (ring && count === 7) colors[6] = CHART_SERIES_COLORS[7];
	return colors;
}

class SceneBuilder {
	readonly elements: SceneElement[] = [];
	private readonly layers: Record<Layer, string[]> = { back: [], middle: [], front: [] };
	/** Every text box drawn, for collision-free placement. */
	readonly textBoxes: { id: string; box: Box }[] = [];

	constructor(readonly surface: string) {}

	push(element: SceneElement, layer: Layer): void {
		this.elements.push(element);
		this.layers[layer].push(element.id);
	}

	zOrder(): string[] {
		return [...this.layers.back, ...this.layers.middle, ...this.layers.front];
	}

	/**
	 * Break axis-aligned rules wherever they would run behind text, so no gridline,
	 * baseline or axis ever crosses a label. Each kept stretch keeps the rule's style.
	 */
	breakRulesUnderText(isRule: (id: string) => boolean, clearance = 2): void {
		const boxes = this.textBoxes.map((entry) => entry.box);
		const replaced = new Map<string, LineSceneElement[]>();
		for (const element of this.elements) {
			if (element.type !== "line" || !isRule(element.id) || element.points.length !== 2) continue;
			const [a, b] = element.points;
			const horizontal = Math.abs(a.y - b.y) < 0.01;
			if (!horizontal && Math.abs(a.x - b.x) >= 0.01) continue;
			const fixed = horizontal ? a.y : a.x;
			const start = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
			const end = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
			const blocked = boxes
				.filter((box) =>
					horizontal
						? box.top - clearance < fixed && fixed < box.bottom + clearance
						: box.left - clearance < fixed && fixed < box.right + clearance,
				)
				.map((box) =>
					horizontal
						? [box.left - clearance, box.right + clearance]
						: [box.top - clearance, box.bottom + clearance],
				)
				.filter(([low, high]) => high! > start && low! < end)
				.toSorted((left, right) => left[0]! - right[0]!);
			if (!blocked.length) continue;
			const pieces: [number, number][] = [];
			let cursor = start;
			for (const [low, high] of blocked) {
				if (low! > cursor) pieces.push([cursor, Math.min(low!, end)]);
				cursor = Math.max(cursor, high!);
			}
			if (cursor < end) pieces.push([cursor, end]);
			replaced.set(
				element.id,
				pieces
					.filter(([low, high]) => high - low >= 1)
					.map(([low, high], index) => ({
						...element,
						id: index === 0 ? element.id : `${element.id}:${index}`,
						points: horizontal
							? [
									{ x: round(low), y: fixed },
									{ x: round(high), y: fixed },
								]
							: [
									{ x: fixed, y: round(low) },
									{ x: fixed, y: round(high) },
								],
					})),
			);
		}
		if (!replaced.size) return;
		const elements = this.elements.flatMap((element) => replaced.get(element.id) ?? [element]);
		this.elements.splice(0, this.elements.length, ...elements);
		for (const layer of Object.values(this.layers)) {
			const ids = layer.flatMap((id) => replaced.get(id)?.map((element) => element.id) ?? [id]);
			layer.splice(0, layer.length, ...ids);
		}
	}

	/** Text whose box spans [left, left + width] × [top, top + height]. */
	text(
		id: string,
		value: Measured,
		left: number,
		top: number,
		fontSize: number,
		color: string,
		align: "center" | "left" | "right" = "center",
		extra: Partial<TextSceneElement> = {},
	): Box {
		const box = { left, top, right: left + value.width, bottom: top + value.height };
		this.push(
			{
				type: "text",
				id,
				x: round(left + value.width / 2),
				y: round(top + value.height / 2),
				text: value.text,
				fontSize,
				maxWidth: value.width,
				textAlign: align,
				textColor: color,
				...extra,
			} satisfies TextSceneElement,
			"front",
		);
		this.textBoxes.push({ id, box });
		return box;
	}

	line(
		id: string,
		from: ScenePoint,
		to: ScenePoint,
		style: Partial<LineSceneElement>,
		layer: Layer = "back",
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
		box: { x: number; y: number; width: number; height: number },
		label: string,
		style: Partial<NodeSceneElement>,
		layer: Layer = "middle",
	): void {
		this.push(
			{
				type: "node",
				id: `node:${nodeId}`,
				nodeId,
				rendererRole: CHART_MARK_ROLE,
				shape,
				x: round(box.x),
				y: round(box.y),
				width: round(Math.max(box.width, 0.5)),
				height: round(Math.max(box.height, 0.5)),
				label,
				roughness: 0,
				fillStyle: "solid",
				strokeWidth: 1,
				...style,
			} satisfies NodeSceneElement,
			layer,
		);
	}

	polygon(
		nodeId: string,
		points: readonly ScenePoint[],
		label: string,
		style: Partial<NodeSceneElement>,
		layer: Layer = "middle",
	): void {
		const xs = points.map((point) => point.x);
		const ys = points.map((point) => point.y);
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		const relative = points.map((point) => ({ x: round(point.x - x), y: round(point.y - y) }));
		this.push(
			{
				type: "node",
				id: `node:${nodeId}`,
				nodeId,
				rendererRole: CHART_MARK_ROLE,
				shape: "polygon",
				points: [relative[0]!, relative[1]!, relative[2]!, ...relative.slice(3)],
				x: round(x),
				y: round(y),
				width: round(Math.max(Math.max(...xs) - x, 0.5)),
				height: round(Math.max(Math.max(...ys) - y, 0.5)),
				label,
				roughness: 0,
				fillStyle: "solid",
				strokeWidth: 1,
				...style,
			} satisfies NodeSceneElement,
			layer,
		);
	}

	bounds(): Box {
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		const include = (x0: number, y0: number, x1: number, y1: number) => {
			left = Math.min(left, x0);
			top = Math.min(top, y0);
			right = Math.max(right, x1);
			bottom = Math.max(bottom, y1);
		};
		for (const element of this.elements) {
			if (element.type === "line" || element.type === "arrow") {
				for (const point of element.points) include(point.x, point.y, point.x, point.y);
			} else if (element.type === "text") {
				const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
				const height = element.text.split("\n").length * element.fontSize * LINE_HEIGHT;
				include(
					element.x - width / 2,
					element.y - height / 2,
					element.x + width / 2,
					element.y + height / 2,
				);
			} else {
				include(element.x, element.y, element.x + element.width, element.y + element.height);
			}
		}
		return { left, top, right, bottom };
	}
}

interface Header {
	readonly legend?: "bar" | "line";
	readonly colors: readonly string[];
}

/** Title, then a legend row for multi-series charts, left-aligned above the plot. */
function drawHeader(builder: SceneBuilder, diagram: ChartDiagram, header: Header): void {
	const content = builder.bounds();
	const width = Math.max(content.right - content.left, MIN_PLOT_WIDTH);
	let bottom = content.top - 16;
	if (header.legend && diagram.series.length > 1) {
		const items = diagram.series.map((series, index) => {
			const text = wrapped(series.name ?? `Series ${index + 1}`, 200, LEGEND_FONT);
			const keyWidth = header.legend === "line" ? 26 : 12;
			return { index, text, keyWidth, width: keyWidth + 6 + text.width };
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
		const rowHeights = rows.map((row) => Math.max(...row.map((item) => item.text.height)));
		let top = bottom - rowHeights.reduce((sum, height) => sum + height, 0) - (rows.length - 1) * 6;
		bottom = top - 12;
		rows.forEach((row, rowIndex) => {
			const height = rowHeights[rowIndex]!;
			const centerY = top + height / 2;
			let left = content.left;
			for (const item of row) {
				const color = header.colors[item.index]!;
				const group = { groupIds: [`chart:legend:${item.index}`] };
				if (header.legend === "line") {
					builder.line(
						`chart:legend:${item.index}:line`,
						{ x: left, y: centerY },
						{ x: left + item.keyWidth, y: centerY },
						{ strokeColor: color, strokeWidth: 2, ...group },
						"middle",
					);
					drawMarker(
						builder,
						`chart:key:${item.index}`,
						item.index,
						left + item.keyWidth / 2,
						centerY,
						color,
						item.text.text,
						group,
					);
				} else {
					builder.mark(
						`chart:key:${item.index}`,
						"rectangle",
						{ x: left, y: centerY - 6, width: 12, height: 12 },
						item.text.text,
						{ fillColor: color, strokeColor: color, ...group },
					);
				}
				builder.text(
					`chart:legend:${item.index}:label`,
					item.text,
					left + item.keyWidth + 6,
					centerY - item.text.height / 2,
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
	// A lone series has no legend; its name shows under the title unless a title already says it.
	const lone = diagram.series.length === 1 ? diagram.series[0]?.name : undefined;
	const said = (text: string | undefined) =>
		text?.toLowerCase().includes(lone!.toLowerCase()) === true;
	if (lone && !said(diagram.title) && !said(diagram.valueAxisTitle)) {
		const subtitle = wrapped(lone, Math.max(width, 360), LEGEND_FONT);
		builder.text(
			"chart:subtitle",
			subtitle,
			content.left,
			bottom - subtitle.height,
			LEGEND_FONT,
			MUTED_INK,
			"left",
		);
		bottom -= subtitle.height + 6;
	}
	const title = wrapped(diagram.title, Math.max(width, 360), TITLE_FONT);
	builder.text("chart:title", title, content.left, bottom - title.height, TITLE_FONT, INK, "left");
}

/** Six marker shapes, so series stay apart without color. */
function drawMarker(
	builder: SceneBuilder,
	nodeId: string,
	series: number,
	x: number,
	y: number,
	color: string,
	label: string,
	extra: Partial<NodeSceneElement> = {},
): Box {
	const ring = {
		strokeColor: builder.surface,
		strokeWidth: 1 as const,
		fillColor: color,
		...extra,
	};
	const shape = series % 6;
	if (shape === 3 || shape === 5) {
		const half = 6.5;
		const up = shape === 3;
		const points = up
			? [
					{ x, y: y - half },
					{ x: x + half, y: y + half * 0.8 },
					{ x: x - half, y: y + half * 0.8 },
				]
			: [
					{ x: x - half, y: y - half * 0.8 },
					{ x: x + half, y: y - half * 0.8 },
					{ x, y: y + half },
				];
		builder.polygon(nodeId, points, label, ring, "front");
		return { left: x - half, top: y - half, right: x + half, bottom: y + half };
	}
	const size = shape === 2 ? 13 : shape === 1 ? 10 : 11;
	const box = { x: x - size / 2, y: y - size / 2, width: size, height: size };
	builder.mark(
		nodeId,
		shape === 1 ? "rectangle" : shape === 2 ? "diamond" : "ellipse",
		box,
		label,
		shape === 4
			? { strokeColor: color, strokeWidth: 2, fillColor: builder.surface, ...extra }
			: ring,
		"front",
	);
	return { left: box.x, top: box.y, right: box.x + size, bottom: box.y + size };
}

function seriesName(diagram: ChartDiagram, index: number): string {
	return diagram.series[index]?.name ?? diagram.title;
}

interface ValueAxis {
	readonly scale: ValueScale;
	readonly labels: readonly Measured[];
}

function valueAxis(scale: ValueScale, parts: UnitParts): ValueAxis {
	return {
		scale,
		labels: scale.ticks.map((tick) => measure(formatTick(tick, scale, parts), TICK_FONT)),
	};
}

interface BarLabel {
	readonly text: Measured;
	readonly value: number;
}

interface BarPlan {
	readonly diagram: ChartDiagram;
	readonly stacked: boolean;
	readonly parts: UnitParts;
	readonly colors: readonly string[];
	/** Per category, per series: the authored value and its label. */
	readonly labels: readonly (readonly BarLabel[])[];
	/** Stacked totals per category: positive and negative sums. */
	readonly totals: readonly { readonly up?: BarLabel; readonly down?: BarLabel }[];
	readonly domain: { readonly low: number; readonly high: number };
}

function barPlan(diagram: ChartDiagram): BarPlan {
	const stacked = diagram.stacked === true && diagram.series.length > 1;
	const parts = unitParts(diagram.unit);
	const decimals = Math.max(
		...diagram.series.flatMap((series) => series.values.map(valueDecimals)),
	);
	const labels = diagram.categories.map((_, category) =>
		diagram.series.map((series) => {
			const value = series.values[category]!;
			return { value, text: measure(formatValue(value, parts), VALUE_FONT) };
		}),
	);
	const totals = diagram.categories.map((_, category) => {
		const values = diagram.series.map((series) => series.values[category]!);
		const up = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
		const down = values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
		const label = (value: number) => ({
			value,
			text: measure(formatValue(Number(value.toFixed(decimals)), parts, decimals), VALUE_FONT),
		});
		return {
			...(up > 0 || down === 0 ? { up: label(up) } : {}),
			...(down < 0 ? { down: label(down) } : {}),
		};
	});
	const extents = stacked
		? totals.flatMap((total) => [total.up?.value ?? 0, total.down?.value ?? 0])
		: diagram.series.flatMap((series) => series.values);
	return {
		diagram,
		stacked,
		parts,
		colors: chartColors(diagram.series.length, false),
		labels,
		totals,
		domain: valueDomain(extents, true),
	};
}

/** The smallest band (≥ `min`) that wraps every category to `lines` lines with whole words. */
function bandForLabels(
	categories: readonly string[],
	min: number,
	lines: number,
	cap: number,
): number {
	let band = min;
	for (const category of categories) {
		const words = Math.max(
			...category.split(/\s+/u).map((word) => measure(word, CATEGORY_FONT).width),
		);
		let candidate = Math.max(band, words + 10);
		while (
			candidate < cap &&
			wrapped(category, candidate - 10, CATEGORY_FONT).text.split("\n").length > lines
		)
			candidate += 4;
		band = Math.max(band, candidate);
	}
	return band;
}

/** Columns unless their category names cannot fit under them. */
export function chartBarOrientation(diagram: ChartDiagram): ChartOrientation {
	if (diagram.orientation) return diagram.orientation;
	const plan = barPlan(diagram);
	const group = columnGroup(plan);
	const band = bandForLabels(diagram.categories, group.band, COLUMN_LABEL_LINES, 161);
	return band > 160 || band * diagram.categories.length > COLUMN_MAX_WIDTH
		? "horizontal"
		: "vertical";
}

interface ColumnGroup {
	readonly bars: number;
	readonly thickness: number;
	readonly band: number;
}

/** Bar thickness and band for columns, widening bars until every value label fits. */
function columnGroup(plan: BarPlan): ColumnGroup {
	const bars = plan.stacked ? 1 : plan.diagram.series.length;
	const n = plan.diagram.categories.length;
	const spread = Math.min(96, COLUMN_TARGET_WIDTH / n);
	// Many categories take thinner bars before the chart turns or widens.
	const base =
		bars === 1
			? Math.max(16, Math.min(44, Math.round(spread * 0.6)))
			: Math.max(10, Math.round(Math.min(64, spread * 0.75) / bars));
	const valueWidth = Math.max(
		...(plan.stacked
			? plan.totals.flatMap((total) => [total.up?.text.width ?? 0, total.down?.text.width ?? 0])
			: plan.labels.flat().map((label) => label.text.width)),
	);
	const groupWidth = (thickness: number) => bars * thickness + (bars - 1) * BAR_GAP;
	if (bars === 1)
		return { bars, thickness: base, band: Math.max(groupWidth(base) + 20, spread, valueWidth + 8) };
	const thickness = Math.max(base, valueWidth + 2);
	return { bars, thickness, band: Math.max(groupWidth(thickness) + 16, spread) };
}

/** Grow the scale a step wherever a value label would leave the plot. */
function scaleWithRoom(
	domain: { low: number; high: number },
	extentPx: number,
	needAbove: (scale: ValueScale, perUnit: number) => boolean,
	needBelow: (scale: ValueScale, perUnit: number) => boolean,
	target = 5,
): ValueScale {
	let scale = niceScale(domain.low, domain.high, target);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const perUnit = extentPx / (scale.max - scale.min);
		const above = needAbove(scale, perUnit);
		const below = needBelow(scale, perUnit);
		if (!above && !below) break;
		scale = extendScale(scale, below, above);
	}
	return scale;
}

function drawColumns(builder: SceneBuilder, plan: BarPlan): void {
	const { diagram, stacked, colors } = plan;
	const n = diagram.categories.length;
	const group = columnGroup(plan);
	const forced = diagram.orientation === "vertical";
	const height = COLUMN_PLOT_HEIGHT;
	const labelRoom = measure("0", VALUE_FONT).height + LABEL_GAP + 2;
	const upExtents = (category: number) =>
		stacked
			? (plan.totals[category]!.up?.value ?? 0)
			: Math.max(0, ...plan.labels[category]!.map((label) => label.value));
	const downExtents = (category: number) =>
		stacked
			? (plan.totals[category]!.down?.value ?? 0)
			: Math.min(0, ...plan.labels[category]!.map((label) => label.value));
	const hasUp = (category: number) =>
		stacked
			? plan.totals[category]!.up !== undefined
			: plan.labels[category]!.some((label) => label.value >= 0);
	const hasDown = (category: number) =>
		stacked
			? plan.totals[category]!.down !== undefined
			: plan.labels[category]!.some((label) => label.value < 0);
	const categories = diagram.categories.map((_, index) => index);
	let scale = scaleWithRoom(
		plan.domain,
		height,
		(candidate, perUnit) =>
			categories.some((c) => hasUp(c) && (candidate.max - upExtents(c)) * perUnit < labelRoom),
		(candidate, perUnit) =>
			categories.some((c) => hasDown(c) && (downExtents(c) - candidate.min) * perUnit < labelRoom),
	);
	// Stacked segments in pixels. A value fits inside when its text box does; any other sits
	// beside the stack, and the scale grows a step until those labels have room on their side
	// of zero.
	const segmentsAt = (candidate: ValueScale) => {
		const unit = height / (candidate.max - candidate.min);
		const y = (value: number) => (candidate.max - value) * unit;
		return diagram.categories.map((_, c) => {
			let up = 0;
			let down = 0;
			return diagram.series.map((_, s) => {
				const { value, text } = plan.labels[c]![s]!;
				const from = value >= 0 ? up : down;
				const to = from + value;
				if (value >= 0) up = to;
				else down = to;
				// A sliver too thin to draw keeps half a pixel, anchored where the bar starts.
				let top = y(Math.max(from, to));
				let bottom = y(Math.min(from, to));
				if (bottom - top < 0.5) {
					if (value >= 0) top = bottom - 0.5;
					else bottom = top + 0.5;
				}
				const inside = bottom - top >= text.height + 1 && text.width + 6 <= group.thickness;
				return { s, value, text, top, bottom, inside };
			});
		});
	};
	for (let attempt = 0; stacked && attempt < 6; attempt += 1) {
		const candidate = segmentsAt(scale);
		const zero = (scale.max / (scale.max - scale.min)) * height;
		const need = (positive: boolean) =>
			Math.max(
				0,
				...candidate.map((stack) =>
					stack
						.filter((segment) => !segment.inside && segment.value >= 0 === positive)
						.reduce((sum, segment) => sum + segment.text.height + 2, 0),
				),
			);
		const above = need(true) > 0 && need(true) > zero - 2;
		const below = need(false) > 0 && need(false) > height - zero - 2;
		if (!above && !below) break;
		scale = extendScale(scale, below, above);
	}
	const perUnit = height / (scale.max - scale.min);
	const yOf = (value: number) => (scale.max - value) * perUnit;
	const segments = segmentsAt(scale);
	/** Half the widest of a stack and its totals: outside labels start past it. */
	const stackHalf = (c: number) =>
		Math.max(
			group.thickness,
			plan.totals[c]!.up?.text.width ?? 0,
			plan.totals[c]!.down?.text.width ?? 0,
		) / 2;
	const outsideWidth = stacked
		? Math.max(
				0,
				...segments.flat().flatMap((segment) => (segment.inside ? [] : [segment.text.width])),
			)
		: 0;
	const band = Math.max(
		bandForLabels(
			diagram.categories,
			group.band,
			forced ? 3 : COLUMN_LABEL_LINES,
			forced ? 200 : 161,
		),
		MIN_PLOT_WIDTH / n,
		outsideWidth > 0
			? 2 * Math.max(...categories.map(stackHalf)) + LEADER_RUN + outsideWidth + 6
			: 0,
	);
	const axis = valueAxis(scale, plan.parts);
	const tickWidth = Math.max(...axis.labels.map((label) => label.width));
	const plotLeft = 0;
	const plotRight = band * n;
	scale.ticks.forEach((tick, index) => {
		const y = yOf(tick);
		const label = axis.labels[index]!;
		builder.line(
			`chart:grid:${index}`,
			{ x: plotLeft, y },
			{ x: plotRight, y },
			{ strokeColor: GRID_COLOR },
		);
		builder.text(
			`chart:tick:${index}`,
			label,
			plotLeft - 8 - label.width,
			y - label.height / 2,
			TICK_FONT,
			MUTED_INK,
			"right",
		);
	});
	const zeroY = yOf(0);
	builder.line(
		"chart:baseline",
		{ x: plotLeft, y: zeroY },
		{ x: plotRight, y: zeroY },
		{ strokeColor: BASELINE_COLOR, strokeWidth: 2 },
		"middle",
	);
	const groupWidth = group.bars * group.thickness + (group.bars - 1) * BAR_GAP;
	let labelsBottom = height;
	diagram.categories.forEach((category, c) => {
		const center = plotLeft + band * (c + 0.5);
		const groupLeft = center - groupWidth / 2;
		const name = wrapped(category, band - 10, CATEGORY_FONT);
		const box = builder.text(
			`chart:category:${c}`,
			name,
			center - name.width / 2,
			height + 8,
			CATEGORY_FONT,
			INK,
		);
		labelsBottom = Math.max(labelsBottom, box.bottom);
		diagram.series.forEach((series, s) => {
			const { value, text } = plan.labels[c]![s]!;
			const color = colors[s]!;
			const id = `chart:bar:${c}:${s}`;
			const groupIds = { groupIds: [stacked ? `chart:stack:${c}` : id] };
			const left = stacked ? groupLeft : groupLeft + s * (group.thickness + BAR_GAP);
			let top: number;
			let bottom: number;
			if (stacked) ({ top, bottom } = segments[c]![s]!);
			else {
				top = yOf(Math.max(0, value));
				bottom = yOf(Math.min(0, value));
				if (bottom - top < 0.5) {
					if (value >= 0) top = bottom - 0.5;
					else bottom = top + 0.5;
				}
			}
			const label = `${category} · ${seriesName(diagram, s)}: ${text.text}`;
			if (value !== 0)
				builder.mark(
					id,
					"rectangle",
					{ x: left, y: top, width: group.thickness, height: bottom - top },
					label,
					stacked
						? { fillColor: color, strokeColor: builder.surface, strokeWidth: 2, ...groupIds }
						: { fillColor: color, strokeColor: color, ...groupIds },
				);
			if (stacked) {
				// Segment values sit inside when they fit; the rest go beside the stack.
				if (segments[c]![s]!.inside)
					builder.text(
						`chart:value:${c}:${s}`,
						text,
						left + (group.thickness - text.width) / 2,
						(top + bottom - text.height) / 2,
						VALUE_FONT,
						textOn(color),
						"center",
						groupIds,
					);
				return;
			}
			const labelTop = value >= 0 ? top - LABEL_GAP - text.height : bottom + LABEL_GAP;
			builder.text(
				`chart:value:${c}:${s}`,
				text,
				left + (group.thickness - text.width) / 2,
				labelTop,
				VALUE_FONT,
				MUTED_INK,
				"center",
				groupIds,
			);
		});
		if (stacked) {
			// Outside labels stack in a column past the stack and its totals, each on an
			// elbow leader from its segment: none crosses the total or a neighbouring band.
			// Labels keep to their own side of the bold zero baseline.
			const outside = segments[c]!.filter((segment) => !segment.inside);
			const columnLeft = center + stackHalf(c) + LEADER_RUN;
			const tops = new Map<(typeof outside)[number], number>();
			for (const positive of [true, false]) {
				const side = outside.filter((segment) => segment.value >= 0 === positive);
				stackLabels(
					side.map((segment) => ({
						preferred: (segment.top + segment.bottom) / 2,
						size: segment.text.height,
					})),
					positive ? 0 : zeroY + 2,
					positive ? zeroY - 2 : height,
					2,
				).forEach((top, index) => tops.set(side[index]!, top));
			}
			const groupIds = { groupIds: [`chart:stack:${c}`] };
			outside.forEach((segment) => {
				const top = tops.get(segment)!;
				const segmentY = (segment.top + segment.bottom) / 2;
				const leader = { strokeColor: MUTED_INK, ...groupIds };
				builder.line(
					`chart:leader:${c}:${segment.s}:a`,
					{ x: groupLeft + group.thickness + 1, y: segmentY },
					{ x: columnLeft - 4, y: segmentY },
					leader,
					"middle",
				);
				builder.line(
					`chart:leader:${c}:${segment.s}:b`,
					{ x: columnLeft - 4, y: segmentY },
					{ x: columnLeft - 1, y: top + segment.text.height / 2 },
					leader,
					"middle",
				);
				builder.text(
					`chart:value:${c}:${segment.s}`,
					segment.text,
					columnLeft,
					top,
					VALUE_FONT,
					MUTED_INK,
					"left",
					groupIds,
				);
			});
		}
		if (stacked) {
			const totals = plan.totals[c]!;
			const groupIds = { groupIds: [`chart:stack:${c}`] };
			if (totals.up)
				builder.text(
					`chart:total:${c}`,
					totals.up.text,
					center - totals.up.text.width / 2,
					yOf(totals.up.value) - LABEL_GAP - totals.up.text.height,
					VALUE_FONT,
					INK,
					"center",
					groupIds,
				);
			if (totals.down)
				builder.text(
					`chart:total-negative:${c}`,
					totals.down.text,
					center - totals.down.text.width / 2,
					yOf(totals.down.value) + LABEL_GAP,
					VALUE_FONT,
					INK,
					"center",
					groupIds,
				);
		}
	});
	if (diagram.valueAxisTitle) {
		const title = wrapped(
			diagram.valueAxisTitle,
			Math.max(plotRight + tickWidth, 200),
			AXIS_TITLE_FONT,
		);
		const topTick = axis.labels[axis.labels.length - 1]!;
		builder.text(
			"chart:value-axis-title",
			title,
			plotLeft - 8 - tickWidth,
			-topTick.height / 2 - 8 - title.height,
			AXIS_TITLE_FONT,
			MUTED_INK,
			"left",
		);
	}
	if (diagram.categoryAxisTitle) {
		const title = wrapped(diagram.categoryAxisTitle, Math.max(plotRight, 200), AXIS_TITLE_FONT);
		builder.text(
			"chart:category-axis-title",
			title,
			(plotLeft + plotRight - title.width) / 2,
			labelsBottom + 12,
			AXIS_TITLE_FONT,
			MUTED_INK,
		);
	}
}

function drawHorizontalBars(builder: SceneBuilder, plan: BarPlan): void {
	const { diagram, stacked, colors } = plan;
	const bars = stacked ? 1 : diagram.series.length;
	const valueHeight = measure("0", VALUE_FONT).height;
	// Grouped bars stay tall enough for the value beside each one.
	const thickness = bars === 1 ? 24 : Math.max(valueHeight - 2, Math.round(44 / bars));
	const groupHeight = bars * thickness + (bars - 1) * BAR_GAP;
	const natural = Math.max(
		...diagram.categories.map((category) => measure(category, CATEGORY_FONT).width),
	);
	const nameWidth = Math.min(CATEGORY_LABEL_MAX_WIDTH, natural);
	const names = diagram.categories.map((category) => wrapped(category, nameWidth, CATEGORY_FONT));
	const width = BAR_PLOT_WIDTH;
	// Every label that sits past a bar's end, with the value that end reaches.
	const endLabels = stacked
		? plan.totals.flatMap((total) => [total.up, total.down].filter((label) => label !== undefined))
		: plan.labels.flat();
	const widest = (side: "up" | "down") => (scale: ValueScale, perUnit: number) =>
		endLabels.some((label) => {
			if ((side === "up") !== label.value >= 0) return false;
			const room =
				side === "up" ? (scale.max - label.value) * perUnit : (label.value - scale.min) * perUnit;
			return room < label.text.width + LABEL_GAP + 4;
		});
	// Tick labels must clear each other along the bottom; fewer intervals when they do not.
	let scale = scaleWithRoom(plan.domain, width, widest("up"), widest("down"));
	for (let target = 4; target >= 2; target -= 1) {
		const axis = valueAxis(scale, plan.parts);
		const spacing = (width / (scale.max - scale.min)) * scale.step;
		if (spacing >= Math.max(...axis.labels.map((label) => label.width)) + 12) break;
		scale = scaleWithRoom(plan.domain, width, widest("up"), widest("down"), target);
	}
	// Stacked segments in pixels. A value fits inside when its text box does; any other sits in
	// a row below the stack, and the scale grows a step until negative labels fit left of zero.
	const segmentsAt = (candidate: ValueScale) => {
		const unit = width / (candidate.max - candidate.min);
		const x = (value: number) => (value - candidate.min) * unit;
		return diagram.categories.map((_, c) => {
			let up = 0;
			let down = 0;
			return diagram.series.map((_, s) => {
				const { value, text } = plan.labels[c]![s]!;
				const from = value >= 0 ? up : down;
				const to = from + value;
				if (value >= 0) up = to;
				else down = to;
				let left = x(Math.min(from, to));
				let right = x(Math.max(from, to));
				if (right - left < 0.5) {
					if (value >= 0) right = left + 0.5;
					else left = right - 0.5;
				}
				const inside = right - left >= text.width + 6 && thickness >= text.height + 1;
				return { s, value, text, left, right, inside };
			});
		});
	};
	for (let attempt = 0; stacked && attempt < 6; attempt += 1) {
		const zero = (-scale.min / (scale.max - scale.min)) * width;
		const need = Math.max(
			0,
			...segmentsAt(scale).map((stack) =>
				stack
					.filter((segment) => !segment.inside && segment.value < 0)
					.reduce((sum, segment) => sum + segment.text.width + 6, 0),
			),
		);
		if (need === 0 || need <= zero - 2) break;
		scale = extendScale(scale, true, false);
	}
	const perUnit = width / (scale.max - scale.min);
	const xOf = (value: number) => (value - scale.min) * perUnit;
	const segments = segmentsAt(scale);
	const rowSpace =
		stacked && segments.flat().some((segment) => !segment.inside) ? valueHeight + 10 : 0;
	const band = Math.max(groupHeight + 14, ...names.map((name) => name.height + 8)) + rowSpace;
	const axis = valueAxis(scale, plan.parts);
	const plotBottom = band * diagram.categories.length;
	scale.ticks.forEach((tick, index) => {
		const x = xOf(tick);
		const label = axis.labels[index]!;
		builder.line(
			`chart:grid:${index}`,
			{ x, y: 0 },
			{ x, y: plotBottom },
			{ strokeColor: GRID_COLOR },
		);
		builder.text(
			`chart:tick:${index}`,
			label,
			x - label.width / 2,
			plotBottom + 6,
			TICK_FONT,
			MUTED_INK,
		);
	});
	const zeroX = xOf(0);
	builder.line(
		"chart:baseline",
		{ x: zeroX, y: 0 },
		{ x: zeroX, y: plotBottom },
		{ strokeColor: BASELINE_COLOR, strokeWidth: 2 },
		"middle",
	);
	diagram.categories.forEach((category, c) => {
		// Bars center in the band above any row of outside labels.
		const center = band * c + (band - rowSpace) / 2;
		const name = names[c]!;
		builder.text(
			`chart:category:${c}`,
			name,
			-10 - name.width,
			center - name.height / 2,
			CATEGORY_FONT,
			INK,
			"right",
		);
		const groupTop = center - groupHeight / 2;
		diagram.series.forEach((series, s) => {
			const { value, text } = plan.labels[c]![s]!;
			const color = colors[s]!;
			const id = `chart:bar:${c}:${s}`;
			const groupIds = { groupIds: [stacked ? `chart:stack:${c}` : id] };
			const top = stacked ? groupTop : groupTop + s * (thickness + BAR_GAP);
			let left: number;
			let right: number;
			if (stacked) ({ left, right } = segments[c]![s]!);
			else {
				left = xOf(Math.min(0, value));
				right = xOf(Math.max(0, value));
				if (right - left < 0.5) {
					if (value >= 0) right = left + 0.5;
					else left = right - 0.5;
				}
			}
			const label = `${category} · ${seriesName(diagram, s)}: ${text.text}`;
			if (value !== 0)
				builder.mark(
					id,
					"rectangle",
					{ x: left, y: top, width: right - left, height: thickness },
					label,
					stacked
						? { fillColor: color, strokeColor: builder.surface, strokeWidth: 2, ...groupIds }
						: { fillColor: color, strokeColor: color, ...groupIds },
				);
			if (stacked) {
				if (segments[c]![s]!.inside)
					builder.text(
						`chart:value:${c}:${s}`,
						text,
						(left + right - text.width) / 2,
						top + (thickness - text.height) / 2,
						VALUE_FONT,
						textOn(color),
						"center",
						groupIds,
					);
				return;
			}
			const labelLeft = value >= 0 ? right + LABEL_GAP : left - LABEL_GAP - text.width;
			builder.text(
				`chart:value:${c}:${s}`,
				text,
				labelLeft,
				top + (thickness - text.height) / 2,
				VALUE_FONT,
				MUTED_INK,
				value >= 0 ? "left" : "right",
				groupIds,
			);
		});
		if (stacked) {
			const totals = plan.totals[c]!;
			const groupIds = { groupIds: [`chart:stack:${c}`] };
			if (totals.up)
				builder.text(
					`chart:total:${c}`,
					totals.up.text,
					xOf(totals.up.value) + LABEL_GAP,
					center - totals.up.text.height / 2,
					VALUE_FONT,
					INK,
					"left",
					groupIds,
				);
			if (totals.down)
				builder.text(
					`chart:total-negative:${c}`,
					totals.down.text,
					xOf(totals.down.value) - LABEL_GAP - totals.down.text.width,
					center - totals.down.text.height / 2,
					VALUE_FONT,
					INK,
					"right",
					groupIds,
				);
			// Outside labels line up in a row under the stack, each on an elbow leader.
			// Labels keep to their own side of the bold zero baseline.
			const outside = segments[c]!.filter((segment) => !segment.inside);
			const barsBottom = groupTop + groupHeight;
			const rowTop = barsBottom + 7;
			const lefts = new Map<(typeof outside)[number], number>();
			for (const positive of [true, false]) {
				const side = outside.filter((segment) => segment.value >= 0 === positive);
				stackLabels(
					side.map((segment) => ({
						preferred: (segment.left + segment.right) / 2,
						size: segment.text.width,
					})),
					positive ? zeroX + 2 : 0,
					positive ? Infinity : zeroX - 2,
					6,
				).forEach((left, index) => lefts.set(side[index]!, left));
			}
			outside.forEach((segment) => {
				const left = lefts.get(segment)!;
				const segmentX = (segment.left + segment.right) / 2;
				const leader = { strokeColor: MUTED_INK, ...groupIds };
				builder.line(
					`chart:leader:${c}:${segment.s}:a`,
					{ x: segmentX, y: barsBottom + 1 },
					{ x: segmentX, y: barsBottom + 3 },
					leader,
					"middle",
				);
				builder.line(
					`chart:leader:${c}:${segment.s}:b`,
					{ x: segmentX, y: barsBottom + 3 },
					{ x: left + segment.text.width / 2, y: rowTop - 1 },
					leader,
					"middle",
				);
				builder.text(
					`chart:value:${c}:${segment.s}`,
					segment.text,
					left,
					rowTop,
					VALUE_FONT,
					MUTED_INK,
					"center",
					groupIds,
				);
			});
		}
	});
	const tickHeight = axis.labels[0]!.height;
	if (diagram.valueAxisTitle) {
		const title = wrapped(diagram.valueAxisTitle, Math.max(width, 200), AXIS_TITLE_FONT);
		builder.text(
			"chart:value-axis-title",
			title,
			(width - title.width) / 2,
			plotBottom + 6 + tickHeight + 10,
			AXIS_TITLE_FONT,
			MUTED_INK,
		);
	}
	if (diagram.categoryAxisTitle) {
		const title = wrapped(diagram.categoryAxisTitle, Math.max(nameWidth, 160), AXIS_TITLE_FONT);
		builder.text(
			"chart:category-axis-title",
			title,
			-10 - title.width,
			-8 - title.height,
			AXIS_TITLE_FONT,
			MUTED_INK,
			"right",
		);
	}
}

interface Segment {
	readonly from: ScenePoint;
	readonly to: ScenePoint;
}

function segmentHitsBox(segment: Segment, box: Box): boolean {
	const { from, to } = segment;
	const inside = (point: ScenePoint) =>
		point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
	if (inside(from) || inside(to)) return true;
	const cross = (a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint) => {
		const orient = (p: ScenePoint, q: ScenePoint, r: ScenePoint) =>
			(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
		const o1 = orient(a, b, c);
		const o2 = orient(a, b, d);
		const o3 = orient(c, d, a);
		const o4 = orient(c, d, b);
		return o1 * o2 < 0 && o3 * o4 < 0;
	};
	const corners = [
		{ x: box.left, y: box.top },
		{ x: box.right, y: box.top },
		{ x: box.right, y: box.bottom },
		{ x: box.left, y: box.bottom },
	];
	return corners.some((corner, index) => cross(from, to, corner, corners[(index + 1) % 4]!));
}

const POINT_LABEL_LIMIT = 16;

function drawLines(builder: SceneBuilder, diagram: ChartDiagram): void {
	const n = diagram.categories.length;
	const parts = unitParts(diagram.unit);
	const colors = chartColors(diagram.series.length, false);
	// Every category is named: points spread until each name wraps to two lines.
	let band = bandForLabels(
		diagram.categories,
		Math.max(Math.min(COLUMN_TARGET_WIDTH / n, 120), 36, MIN_PLOT_WIDTH / n),
		2,
		400,
	);
	const height = LINE_PLOT_HEIGHT;
	const values = diagram.series.flatMap((series) => series.values);
	const xOf = (index: number) => band * (index + 0.5);
	const valueLabels =
		diagram.series.length === 1 && n <= POINT_LABEL_LIMIT
			? diagram.series[0]!.values.map((value) => measure(formatValue(value, parts), VALUE_FONT))
			: undefined;
	/** Place every point label clear of every line, marker and other label, or none. */
	const placeLabels = (
		yOf: (value: number) => number,
		top: number,
		bottom: number,
	): Box[] | undefined => {
		if (!valueLabels) return undefined;
		const series = diagram.series[0]!.values;
		const points = series.map((value, index) => ({ x: xOf(index), y: yOf(value) }));
		const segments = diagram.series.flatMap((entry) =>
			entry.values.slice(1).map((value, index) => ({
				from: { x: xOf(index), y: yOf(entry.values[index]!) },
				to: { x: xOf(index + 1), y: yOf(value) },
			})),
		);
		// The zero baseline is a bold rule; labels keep clear of it like any line.
		if (scale.min < 0 && scale.max > 0)
			segments.push({ from: { x: 0, y: yOf(0) }, to: { x: band * n, y: yOf(0) } });
		const markers = points.map((point) => ({
			left: point.x - 7,
			top: point.y - 7,
			right: point.x + 7,
			bottom: point.y + 7,
		}));
		const placed: Box[] = [];
		for (const [index, point] of points.entries()) {
			const label = valueLabels[index]!;
			const before = series[index - 1];
			const after = series[index + 1];
			const value = series[index]!;
			const rising =
				(before === undefined || before <= value) && (after === undefined || after >= value);
			const falling =
				(before === undefined || before >= value) && (after === undefined || after <= value);
			const peak =
				(before === undefined || before <= value) && (after === undefined || after <= value);
			const w = label.width;
			const h = label.height;
			const at = (dx: number, dy: number): Box => ({
				left: point.x + dx - w / 2,
				top: point.y + dy - h / 2,
				right: point.x + dx + w / 2,
				bottom: point.y + dy + h / 2,
			});
			// Diagonal spots clear the point's own marker; the far spots clear steep segments.
			const above = at(0, -(10 + h / 2));
			const below = at(0, 10 + h / 2);
			const farAbove = at(0, -(22 + h / 2));
			const farBelow = at(0, 22 + h / 2);
			const aboveLeft = at(-(w / 2 + 10), -(4 + h / 2));
			const aboveRight = at(w / 2 + 10, -(4 + h / 2));
			const belowLeft = at(-(w / 2 + 10), 4 + h / 2);
			const belowRight = at(w / 2 + 10, 4 + h / 2);
			const order = peak
				? [above, aboveLeft, aboveRight, farAbove, below, farBelow]
				: rising && !falling
					? [aboveLeft, belowRight, above, below, farAbove, farBelow]
					: falling && !rising
						? [aboveRight, belowLeft, above, below, farAbove, farBelow]
						: [below, belowLeft, belowRight, farBelow, above, farAbove];
			const choice = order.find(
				(box) =>
					box.top >= top &&
					box.bottom <= bottom &&
					box.left >= 0 &&
					box.right <= band * n &&
					!segments.some((segment) =>
						segmentHitsBox(segment, {
							left: box.left - 2,
							top: box.top - 2,
							right: box.right + 2,
							bottom: box.bottom + 2,
						}),
					) &&
					!markers.some((marker) => overlaps(marker, box, 2)) &&
					!placed.some((other) => overlaps(other, box, 3)),
			);
			if (!choice) return undefined;
			placed.push(choice);
		}
		return placed;
	};
	const domain = valueDomain(values, false);
	let scale = niceScale(domain.low, domain.high);
	// Each label takes its preferred clear spot; the scale grows a step wherever that spot
	// leaves the plot, rather than pushing a peak's label under its point.
	let labelBoxes: Box[] | undefined;
	for (let attempt = 0; attempt < 3 && valueLabels; attempt += 1) {
		const perUnit = height / (scale.max - scale.min);
		const yOf = (value: number) => (scale.max - value) * perUnit;
		const preferred = placeLabels(yOf, -Infinity, Infinity);
		if (!preferred) break;
		const above = preferred.some((box) => box.top < 0);
		const below = preferred.some((box) => box.bottom > height);
		if (!above && !below) {
			labelBoxes = preferred;
			break;
		}
		if (attempt === 2) labelBoxes = placeLabels(yOf, 0, height);
		else scale = extendScale(scale, below, above);
	}
	// Values that cannot sit on their points go in a table under the axis, one row per series.
	const table = labelBoxes
		? undefined
		: diagram.series.map((series) =>
				series.values.map((value) => measure(formatValue(value, parts), VALUE_FONT)),
			);
	if (table) band = Math.max(band, ...table.flat().map((cell) => cell.width + 8));
	const perUnit = height / (scale.max - scale.min);
	const yOf = (value: number) => (scale.max - value) * perUnit;
	const axis = valueAxis(scale, parts);
	const tickWidth = Math.max(...axis.labels.map((label) => label.width));
	const plotRight = band * n;
	scale.ticks.forEach((tick, index) => {
		const y = yOf(tick);
		const label = axis.labels[index]!;
		builder.line(
			`chart:grid:${index}`,
			{ x: 0, y },
			{ x: plotRight, y },
			{ strokeColor: GRID_COLOR },
		);
		builder.text(
			`chart:tick:${index}`,
			label,
			-8 - label.width,
			y - label.height / 2,
			TICK_FONT,
			MUTED_INK,
			"right",
		);
	});
	if (scale.min < 0 && scale.max > 0)
		builder.line(
			"chart:baseline",
			{ x: 0, y: yOf(0) },
			{ x: plotRight, y: yOf(0) },
			{ strokeColor: BASELINE_COLOR, strokeWidth: 2 },
			"middle",
		);
	builder.line(
		"chart:axis",
		{ x: 0, y: height },
		{ x: plotRight, y: height },
		{ strokeColor: BASELINE_COLOR },
		"middle",
	);
	let labelsBottom = height;
	diagram.categories.forEach((category, c) => {
		const x = xOf(c);
		builder.line(
			`chart:category-tick:${c}`,
			{ x, y: height },
			{ x, y: height + 5 },
			{ strokeColor: BASELINE_COLOR },
			"middle",
		);
		const name = wrapped(category, band - 10, CATEGORY_FONT);
		const box = builder.text(
			`chart:category:${c}`,
			name,
			x - name.width / 2,
			height + 9,
			CATEGORY_FONT,
			INK,
		);
		labelsBottom = Math.max(labelsBottom, box.bottom);
	});
	diagram.series.forEach((series, s) => {
		const color = colors[s]!;
		const group = { groupIds: [`chart:series:${s}`] };
		series.values
			.slice(1)
			.forEach((value, index) =>
				builder.line(
					`chart:line:${s}:${index + 1}`,
					{ x: xOf(index), y: yOf(series.values[index]!) },
					{ x: xOf(index + 1), y: yOf(value) },
					{ strokeColor: color, strokeWidth: 2, ...group },
					"middle",
				),
			);
		series.values.forEach((value, c) => {
			const text = formatValue(value, parts);
			drawMarker(
				builder,
				`chart:point:${c}:${s}`,
				s,
				xOf(c),
				yOf(value),
				color,
				`${diagram.categories[c]} · ${seriesName(diagram, s)}: ${text}`,
				group,
			);
		});
	});
	if (table) {
		let rowTop = labelsBottom + 12;
		const names = diagram.series.map((series) =>
			series.name ? wrapped(series.name, 200, VALUE_FONT) : undefined,
		);
		// Keys line up in one column, each series name left-aligned after its key.
		const nameColumn = Math.max(0, ...names.map((name) => (name ? name.width + 6 : 0)));
		const keyRight = -10 - nameColumn;
		table.forEach((cells, s) => {
			const series = diagram.series[s]!;
			const color = colors[s]!;
			const group = { groupIds: [`chart:table:${s}`] };
			const name = names[s];
			const rowHeight = Math.max(cells[0]!.height, name?.height ?? 0);
			const centerY = rowTop + rowHeight / 2;
			builder.line(
				`chart:table-key:${s}:line`,
				{ x: keyRight - 22, y: centerY },
				{ x: keyRight, y: centerY },
				{ strokeColor: color, strokeWidth: 2, ...group },
				"middle",
			);
			drawMarker(
				builder,
				`chart:table-key:${s}`,
				s,
				keyRight - 11,
				centerY,
				color,
				series.name ?? diagram.title,
				group,
			);
			if (name)
				builder.text(
					`chart:table-name:${s}`,
					name,
					keyRight + 6,
					rowTop + (rowHeight - name.height) / 2,
					VALUE_FONT,
					INK,
					"left",
					group,
				);
			cells.forEach((cell, c) =>
				builder.text(
					`chart:table:${c}:${s}`,
					cell,
					xOf(c) - cell.width / 2,
					rowTop + (rowHeight - cell.height) / 2,
					VALUE_FONT,
					MUTED_INK,
					"center",
					group,
				),
			);
			rowTop += rowHeight + 4;
		});
		labelsBottom = rowTop - 4;
	}
	labelBoxes?.forEach((box, c) =>
		builder.text(
			`chart:value:${c}:0`,
			valueLabels![c]!,
			box.left,
			box.top,
			VALUE_FONT,
			MUTED_INK,
			"center",
			{ groupIds: ["chart:series:0"] },
		),
	);
	if (diagram.valueAxisTitle) {
		const title = wrapped(
			diagram.valueAxisTitle,
			Math.max(plotRight + tickWidth, 200),
			AXIS_TITLE_FONT,
		);
		const topTick = axis.labels[axis.labels.length - 1]!;
		builder.text(
			"chart:value-axis-title",
			title,
			-8 - tickWidth,
			-topTick.height / 2 - 8 - title.height,
			AXIS_TITLE_FONT,
			MUTED_INK,
			"left",
		);
	}
	if (diagram.categoryAxisTitle) {
		const title = wrapped(diagram.categoryAxisTitle, Math.max(plotRight, 200), AXIS_TITLE_FONT);
		builder.text(
			"chart:category-axis-title",
			title,
			(plotRight - title.width) / 2,
			labelsBottom + 12,
			AXIS_TITLE_FONT,
			MUTED_INK,
		);
	}
}

interface Slice {
	readonly index: number;
	readonly start: number;
	readonly end: number;
	readonly mid: number;
}

function arcPoints(radius: number, start: number, end: number): ScenePoint[] {
	const steps = Math.max(1, Math.ceil(Math.abs(end - start) / PIE_ARC_STEP));
	return Array.from({ length: steps + 1 }, (_, step) => {
		const angle = start + ((end - start) * step) / steps;
		return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
	});
}

function distanceToRay(point: ScenePoint, angle: number, length: number): number {
	const dx = Math.cos(angle);
	const dy = Math.sin(angle);
	const along = Math.max(0, Math.min(length, point.x * dx + point.y * dy));
	return Math.hypot(point.x - along * dx, point.y - along * dy);
}

/** Whether a box sits inside a slice, at least `margin` from every edge. */
function boxInSlice(box: Box, slice: Slice, inner: number, outer: number, margin: number): boolean {
	const span = slice.end - slice.start;
	const corners = [
		{ x: box.left, y: box.top },
		{ x: box.right, y: box.top },
		{ x: box.right, y: box.bottom },
		{ x: box.left, y: box.bottom },
	];
	return corners.every((corner) => {
		const radius = Math.hypot(corner.x, corner.y);
		if (radius > outer - margin || radius < inner + margin) return false;
		if (span >= 2 * Math.PI - 1e-9) return true;
		let angle = Math.atan2(corner.y, corner.x) - slice.start;
		angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
		return (
			angle <= span &&
			distanceToRay(corner, slice.start, outer) >= margin &&
			distanceToRay(corner, slice.end, outer) >= margin
		);
	});
}

function drawPie(builder: SceneBuilder, diagram: ChartDiagram): void {
	const values = diagram.series[0]!.values;
	const parts = unitParts(diagram.unit);
	const colors = chartColors(values.length, true);
	const { labels: percentages, shares } = piePercentages(values);
	// Percent data reads as its share only when the share states the very value; otherwise
	// the authored value shows beside it.
	const percent = diagram.unit?.trim() === "%";
	const outer = PIE_RADIUS;
	const inner = diagram.donut ? PIE_RADIUS * DONUT_RATIO : 0;
	let cursor = -Math.PI / 2;
	const slices: Slice[] = values.map((value, index) => {
		const span = (shares[index]! / 100) * 2 * Math.PI;
		const slice = { index, start: cursor, end: cursor + span, mid: cursor + span / 2 };
		cursor += span;
		return slice;
	});
	const outside: { slice: Slice; text: Measured; side: 1 | -1; preferred: number }[] = [];
	for (const slice of slices) {
		const color = colors[slice.index]!;
		const category = diagram.categories[slice.index]!;
		const value = values[slice.index]!;
		const valueText = formatValue(value, parts);
		const share = percentages[slice.index]!;
		const group = { groupIds: [`chart:slice:${slice.index}`] };
		const span = slice.end - slice.start;
		if (span > 0.0035) {
			const full = span >= 2 * Math.PI - 1e-9;
			const outerArc = arcPoints(outer, slice.start, full ? slice.end - FULL_SLICE_GAP : slice.end);
			const points =
				inner > 0
					? [
							...outerArc,
							...arcPoints(inner, full ? slice.end - FULL_SLICE_GAP : slice.end, slice.start),
						]
					: full
						? outerArc
						: [{ x: 0, y: 0 }, ...outerArc];
			builder.polygon(
				`chart:slice:${slice.index}`,
				points,
				`${category}: ${share} (${valueText})`,
				{
					fillColor: color,
					strokeColor: builder.surface,
					strokeWidth: 2,
					...group,
				},
			);
		}
		const line = percent && share === valueText ? share : `${share} · ${valueText}`;
		const insideText = measure(
			`${wrapTextToWidth(category, 110, SLICE_FONT)}\n${line}`,
			SLICE_FONT,
		);
		const radius = inner > 0 ? (inner + outer) / 2 : outer * 0.6;
		const cx = radius * Math.cos(slice.mid);
		const cy = radius * Math.sin(slice.mid);
		const box = {
			left: cx - insideText.width / 2,
			top: cy - insideText.height / 2,
			right: cx + insideText.width / 2,
			bottom: cy + insideText.height / 2,
		};
		if (span > 0.0035 && boxInSlice(box, slice, inner, outer, 6)) {
			builder.text(
				`chart:slice-label:${slice.index}`,
				insideText,
				box.left,
				box.top,
				SLICE_FONT,
				textOn(color),
				"center",
				group,
			);
			continue;
		}
		const text = measure(
			`${wrapTextToWidth(category, PIE_LABEL_WIDTH, SLICE_FONT)}\n${line}`,
			SLICE_FONT,
		);
		const side = Math.cos(slice.mid) >= -1e-9 ? 1 : -1;
		outside.push({ slice, text, side, preferred: (outer + 16) * Math.sin(slice.mid) });
	}
	// A label within 20° of straight up or down may take either side, so a run of thin slices
	// near the top or bottom splits across both columns. Only the fuller side gives labels away,
	// nearest the vertical first; their leaders stay farther out than the pie's rim.
	const count = (side: 1 | -1) => outside.filter((entry) => entry.side === side).length;
	const nearVertical = (entry: (typeof outside)[number]) => Math.abs(Math.cos(entry.slice.mid));
	for (const entry of outside
		.filter((candidate) => nearVertical(candidate) < Math.sin(PIE_SWAP_ANGLE))
		.toSorted((a, b) => nearVertical(a) - nearVertical(b)))
		if (count(entry.side) - 1 > count(entry.side === 1 ? -1 : 1))
			entry.side = entry.side === 1 ? -1 : 1;
	/** How far round from its column's level a label's slice sits, past the vertical for swapped ones. */
	const sweep = (entry: (typeof outside)[number]) =>
		Math.atan2(Math.abs(Math.sin(entry.slice.mid)), entry.side * Math.cos(entry.slice.mid));
	// Labels above the pie's equator stack upward and those below stack downward, in sweep order,
	// so every leader runs outward from its slice: none crosses the pie, another leader or a label.
	for (const side of [1, -1] as const) {
		const entries = outside.filter((entry) => entry.side === side);
		const upper = entries
			.filter((entry) => entry.preferred < 0)
			.toSorted((a, b) => sweep(a) - sweep(b));
		const lower = entries
			.filter((entry) => entry.preferred >= 0)
			.toSorted((a, b) => sweep(a) - sweep(b));
		const tops = new Map<(typeof entries)[number], number>();
		let ceiling = Infinity;
		for (const entry of upper) {
			const top = Math.min(
				entry.preferred - entry.text.height / 2,
				ceiling - 6 - entry.text.height,
			);
			tops.set(entry, top);
			ceiling = top;
		}
		let floor = upper.length
			? Math.max(...upper.map((entry) => tops.get(entry)! + entry.text.height)) + 6
			: -Infinity;
		for (const entry of lower) {
			const top = Math.max(entry.preferred - entry.text.height / 2, floor);
			tops.set(entry, top);
			floor = top + entry.text.height + 6;
		}
		const column = [...upper, ...lower];
		column.forEach((entry) => {
			const top = tops.get(entry)!;
			const centerY = top + entry.text.height / 2;
			const columnX = side * (outer + 30);
			const left = side > 0 ? columnX : columnX - entry.text.width;
			const group = { groupIds: [`chart:slice:${entry.slice.index}`] };
			const anchor = {
				x: (outer + 2) * Math.cos(entry.slice.mid),
				y: (outer + 2) * Math.sin(entry.slice.mid),
			};
			const elbow = {
				x: (outer + 14) * Math.cos(entry.slice.mid),
				y: (outer + 14) * Math.sin(entry.slice.mid),
			};
			builder.line(
				`chart:leader:${entry.slice.index}:a`,
				anchor,
				elbow,
				{ strokeColor: MUTED_INK, ...group },
				"middle",
			);
			builder.line(
				`chart:leader:${entry.slice.index}:b`,
				elbow,
				{ x: columnX - side * 4, y: centerY },
				{ strokeColor: MUTED_INK, ...group },
				"middle",
			);
			builder.text(
				`chart:slice-label:${entry.slice.index}`,
				entry.text,
				left,
				top,
				SLICE_FONT,
				INK,
				side > 0 ? "left" : "right",
				group,
			);
		});
	}
}

/** Lay out a chart deterministically: axes, marks, labels and legend. */
export function renderChartDiagram(input: ChartDiagram): RenderedDiagramScene {
	const diagram = validateChartDiagram(input);
	const builder = new SceneBuilder(diagram.style.backgroundColor);
	if (diagram.kind === "pie") {
		drawPie(builder, diagram);
		drawHeader(builder, diagram, { colors: [] });
	} else if (diagram.kind === "line") {
		drawLines(builder, diagram);
		drawHeader(builder, diagram, {
			legend: "line",
			colors: chartColors(diagram.series.length, false),
		});
	} else {
		const plan = barPlan(diagram);
		if (chartBarOrientation(diagram) === "horizontal") drawHorizontalBars(builder, plan);
		else drawColumns(builder, plan);
		drawHeader(builder, diagram, { legend: "bar", colors: plan.colors });
	}
	builder.breakRulesUnderText(
		(id) =>
			id.startsWith("chart:grid:") ||
			id.startsWith("chart:category-tick:") ||
			id === "chart:baseline" ||
			id === "chart:axis",
	);
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
