// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import {
	estimateTextWidth,
	getCanvasValidationIssues,
	type CanvasPoint,
	type CanvasElement as SceneElement,
	type CanvasSpec,
} from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { parseChartDiagram, type ChartDiagram } from "../document.js";

import { readChartMarks } from "../readout.js";
import { chartBarOrientation, renderChartDiagram } from "../render.js";
import { formatValue, niceScale, PIE_MAX_DECIMALS, piePercentages, unitParts } from "../scale.js";

interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

type TextElement = Extract<SceneElement, { type: "text" }>;
type NodeElement = Extract<SceneElement, { type: "node" }>;
type LineElement = Extract<SceneElement, { type: "line" }>;

function textBox(element: TextElement): Box {
	const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
	const height = element.text.split("\n").length * element.fontSize * 1.35;
	return {
		left: element.x - width / 2,
		top: element.y - height / 2,
		right: element.x + width / 2,
		bottom: element.y + height / 2,
	};
}

function nodeBox(element: NodeElement): Box {
	return {
		left: element.x,
		top: element.y,
		right: element.x + element.width,
		bottom: element.y + element.height,
	};
}

/** Strict overlap: boxes that only touch along an edge do not overlap. */
function overlaps(a: Box, b: Box, slack = 0.5): boolean {
	return (
		a.left < b.right - slack &&
		b.left < a.right - slack &&
		a.top < b.bottom - slack &&
		b.top < a.bottom - slack
	);
}

function contains(outer: Box, inner: Box): boolean {
	return (
		inner.left >= outer.left - 0.5 &&
		inner.right <= outer.right + 0.5 &&
		inner.top >= outer.top - 0.5 &&
		inner.bottom <= outer.bottom + 0.5
	);
}

function segmentHitsBox(from: CanvasPoint, to: CanvasPoint, box: Box): boolean {
	// Sample densely; every segment here is short relative to the 0.5px resolution we need.
	const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.5));
	for (let step = 0; step <= steps; step += 1) {
		const x = from.x + ((to.x - from.x) * step) / steps;
		const y = from.y + ((to.y - from.y) * step) / steps;
		if (x > box.left + 0.5 && x < box.right - 0.5 && y > box.top + 0.5 && y < box.bottom - 0.5)
			return true;
	}
	return false;
}

function segmentsCross(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint): boolean {
	const orient = (p: CanvasPoint, q: CanvasPoint, r: CanvasPoint) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

function polygonPoints(element: NodeElement): CanvasPoint[] {
	return (element.points ?? []).map((point) => ({
		x: element.x + point.x,
		y: element.y + point.y,
	}));
}

function insidePolygon(point: CanvasPoint, polygon: readonly CanvasPoint[]): boolean {
	let inside = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const a = polygon[index]!;
		const b = polygon[previous]!;
		if (
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
		)
			inside = !inside;
	}
	return inside;
}

const corners = (box: Box): CanvasPoint[] => [
	{ x: box.left, y: box.top },
	{ x: box.right, y: box.top },
	{ x: box.right, y: box.bottom },
	{ x: box.left, y: box.bottom },
];

interface Readout {
	readonly texts: { element: TextElement; box: Box }[];
	readonly bars: { element: NodeElement; category: number; series: number }[];
	readonly slices: { element: NodeElement; index: number }[];
	readonly markers: NodeElement[];
	readonly keys: NodeElement[];
	readonly lines: LineElement[];
}

function read(scene: CanvasSpec): Readout {
	const texts = scene.elements.flatMap((element) =>
		element.type === "text" ? [{ element, box: textBox(element) }] : [],
	);
	const nodes = scene.elements.filter((element): element is NodeElement => element.type === "node");
	return {
		texts,
		bars: nodes.flatMap((element) => {
			const match = /^chart:bar:(\d+):(\d+)$/u.exec(element.nodeId);
			return match ? [{ element, category: Number(match[1]), series: Number(match[2]) }] : [];
		}),
		slices: nodes.flatMap((element) => {
			const match = /^chart:slice:(\d+)$/u.exec(element.nodeId);
			return match ? [{ element, index: Number(match[1]) }] : [];
		}),
		markers: nodes.filter((element) => element.nodeId.startsWith("chart:point:")),
		keys: nodes.filter((element) => element.nodeId.startsWith("chart:key:")),
		lines: scene.elements.filter((element): element is LineElement => element.type === "line"),
	};
}

/** Value-bearing text: bar and point values, data-table cells and pie labels. */
const VALUE_TEXT = /^chart:(value|table|slice-label):/u;

/**
 * Every authored number, category, series name and axis title is drawn as
 * text, formatted as the renderer formats it: nothing is left to subtraction.
 */
function drawnDataProblems(diagram: ChartDiagram, scene: CanvasSpec): string[] {
	const problems: string[] = [];
	const texts = scene.elements.filter((element): element is TextElement => element.type === "text");
	const drawn = texts.map((element) => element.text.replace(/\n/gu, " ").toLowerCase());
	const counts = new Map<string, number>();
	for (const element of texts.filter((entry) => VALUE_TEXT.test(entry.id)))
		for (const line of element.text.split("\n"))
			for (const segment of line.split(" · ")) counts.set(segment, (counts.get(segment) ?? 0) + 1);
	const parts = unitParts(diagram.unit);
	for (const series of diagram.series)
		for (const value of series.values) {
			const text = formatValue(value, parts);
			const left = counts.get(text) ?? 0;
			if (left === 0) problems.push(`data-not-drawn: value ${text}`);
			counts.set(text, left - 1);
		}
	const names = [
		...diagram.categories,
		...diagram.series.flatMap((series) => (series.name ? [series.name] : [])),
		...(diagram.categoryAxisTitle ? [diagram.categoryAxisTitle] : []),
		...(diagram.valueAxisTitle ? [diagram.valueAxisTitle] : []),
	];
	for (const name of names)
		if (!drawn.some((text) => text.includes(name.replace(/\s+/gu, " ").toLowerCase())))
			problems.push(`data-not-drawn: "${name}"`);
	return problems;
}

/** Every layout promise a chart makes, read from its scene alone. Each problem starts with its kind. */
function chartProblems(diagram: ChartDiagram, scene: CanvasSpec): string[] {
	const problems = drawnDataProblems(diagram, scene);
	const readout = read(scene);
	readout.texts.forEach(({ element, box }, index) => {
		if (box.left < 0 || box.top < 0 || box.right > scene.width || box.bottom > scene.height)
			problems.push(`text-clipped: ${element.id}`);
		for (const other of readout.texts.slice(index + 1))
			if (overlaps(box, other.box))
				problems.push(`text-overlap: ${element.id} overlaps ${other.element.id}`);
	});
	// Text sits fully inside a bar or clear of it, and clear of every marker and legend key.
	for (const { element, box } of readout.texts) {
		for (const bar of readout.bars) {
			const barBox = nodeBox(bar.element);
			if (overlaps(box, barBox) && !contains(barBox, box))
				problems.push(`text-cuts-bar: ${element.id} cuts ${bar.element.id}`);
		}
		for (const mark of [...readout.markers, ...readout.keys])
			if (overlaps(box, nodeBox(mark)))
				problems.push(`text-covers-mark: ${element.id} covers ${mark.id}`);
	}
	// No line runs through text: series lines, leaders, gridlines, the baseline and the axis.
	for (const line of readout.lines) {
		if (/^chart:(legend|table-key):/u.test(line.id)) continue;
		for (const { element, box } of readout.texts)
			for (let index = 1; index < line.points.length; index += 1)
				if (segmentHitsBox(line.points[index - 1]!, line.points[index]!, box))
					problems.push(`line-crosses-text: ${line.id} crosses ${element.id}`);
	}
	if (diagram.kind !== "pie") {
		if (!readout.texts.some((text) => text.element.id === "chart:tick:0"))
			problems.push("no-zero-tick");
		const keys = diagram.series.length > 1 ? diagram.series.length : 0;
		if (readout.keys.length !== keys)
			problems.push(`legend-keys: ${readout.keys.length} of ${keys}`);
	}
	if (diagram.kind === "bar") problems.push(...barProblems(diagram, scene, readout));
	if (diagram.kind === "pie") problems.push(...pieProblems(diagram, scene, readout));
	if (diagram.kind === "bar" || diagram.kind === "pie")
		// Every category is named once, its words whole.
		diagram.categories.forEach((category, index) => {
			const id = diagram.kind === "pie" ? `chart:slice-label:${index}` : `chart:category:${index}`;
			const words = readout.texts
				.find((entry) => entry.element.id === id)
				?.element.text.replace(/\n/gu, " ");
			if (!words?.startsWith(category.replace(/\s+/gu, " ")))
				problems.push(`category-name: ${id} "${words}"`);
		});
	return problems;
}

function barProblems(diagram: ChartDiagram, scene: CanvasSpec, readout: Readout): string[] {
	const problems: string[] = [];
	const vertical = chartBarOrientation(diagram) === "vertical";
	const rates = readout.bars.map(({ element, category, series }) => {
		const value = Math.abs(diagram.series[series]!.values[category]!);
		const length = vertical ? element.height : element.width;
		return { rate: length / value, length, value };
	});
	if (rates.length === 0) return problems;
	const reference = rates.toSorted((a, b) => b.length - a.length)[0]!.rate;
	for (const { rate, length, value } of rates)
		if (!(Math.abs(rate * value - reference * value) < 0.6))
			problems.push(`bar-length: bar of ${value} drawn ${length}`);
	// Unstacked bars all grow from the zero baseline.
	const baseline = scene.elements.find(
		(element): element is LineElement => element.id === "chart:baseline",
	);
	if (!baseline) return [...problems, "no-baseline"];
	if (diagram.stacked && diagram.series.length > 1) return problems;
	const zero = vertical ? baseline.points[0].y : baseline.points[0].x;
	for (const { element } of readout.bars) {
		const ends = vertical
			? [element.y, element.y + element.height]
			: [element.x, element.x + element.width];
		if (Math.min(...ends.map((end) => Math.abs(end - zero))) >= 0.02)
			problems.push(`bar-off-baseline: ${element.id}`);
	}
	return problems;
}

function pieGeometry(readout: Readout) {
	const all = readout.slices.flatMap(({ element }) => polygonPoints(element));
	const xs = all.map((point) => point.x);
	const ys = all.map((point) => point.y);
	return {
		center: {
			x: (Math.min(...xs) + Math.max(...xs)) / 2,
			y: (Math.min(...ys) + Math.max(...ys)) / 2,
		},
		radius: (Math.max(...xs) - Math.min(...xs)) / 2,
	};
}

function pieProblems(diagram: ChartDiagram, scene: CanvasSpec, readout: Readout): string[] {
	const problems: string[] = [];
	const values = diagram.series[0]!.values;
	const total = values.reduce((sum, value) => sum + value, 0);
	const { center, radius } = pieGeometry(readout);
	const marks = readChartMarks(scene).slices;
	const { decimals } = piePercentages(values);
	let sum = 0;
	for (const { element, index } of readout.slices) {
		const degrees = marks.find((mark) => mark.index === index)!.degrees;
		const expected = (values[index]! / total) * 360;
		if (!(Math.abs(degrees - expected) < 0.05))
			problems.push(`slice-angle: slice ${index} spans ${degrees}° not ${expected}°`);
		sum += degrees;
		const label = readout.texts.find((text) => text.element.id === `chart:slice-label:${index}`);
		if (!label) continue;
		// Each label states value ÷ total at the chart's precision.
		const stated = /(<)?(\d+(?:\.\d+)?)%/u.exec(label.element.text.split("\n").at(-1)!);
		if (
			!stated ||
			(!stated[1] && Math.abs(Number(stated[2]) - expected / 3.6) > 0.5 * 10 ** -decimals + 1e-9)
		)
			problems.push(`slice-share: label ${index} "${label.element.text}"`);
		// Labels inside a slice sit inside its polygon; outside labels stay off the pie.
		const inside = corners(label.box).every((corner) =>
			insidePolygon(corner, polygonPoints(element)),
		);
		const outside = corners(label.box).every(
			(corner) => Math.hypot(corner.x - center.x, corner.y - center.y) > radius,
		);
		if (!inside && !outside) problems.push(`label-straddles-pie: label ${index}`);
	}
	// Leaders stay off the pie and never cross one another.
	const leaders = readout.lines.filter((line) => line.id.startsWith("chart:leader:"));
	const owner = (id: string) => id.split(":")[2];
	for (const [index, leader] of leaders.entries()) {
		const [from, to] = leader.points;
		for (let step = 0; step <= 40; step += 1) {
			const x = from.x + ((to.x - from.x) * step) / 40;
			const y = from.y + ((to.y - from.y) * step) / 40;
			if (Math.hypot(x - center.x, y - center.y) <= radius) {
				problems.push(`leader-enters-pie: ${leader.id}`);
				break;
			}
		}
		for (const other of leaders.slice(index + 1))
			if (
				owner(other.id) !== owner(leader.id) &&
				segmentsCross(from, to, other.points[0], other.points[1])
			)
				problems.push(`leaders-cross: ${leader.id} crosses ${other.id}`);
	}
	// Slices too thin to draw are left out, and only those.
	const visible = (value: number) => (value / total) * 2 * Math.PI > 0.0035;
	const drawn = values.filter(visible).length;
	const missing = values.reduce(
		(gap, value) => gap + (visible(value) ? 0 : (value / total) * 360),
		0,
	);
	if (readout.slices.length !== drawn)
		problems.push(`slice-count: ${readout.slices.length} of ${drawn}`);
	if (!(Math.abs(sum + missing - 360) < 0.05)) problems.push(`slices-total: ${sum + missing}°`);
	return problems;
}

/** Render a chart and require a valid canvas, a valid export and no layout problem. */
function expectReadableChart(diagram: ChartDiagram): CanvasSpec {
	const scene = renderChartDiagram(diagram);
	expect(getCanvasValidationIssues(scene), diagram.id).toEqual([]);
	expect(validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues, diagram.id).toEqual([]);
	expect(chartProblems(diagram, scene), diagram.id).toEqual([]);
	return scene;
}
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = [
	"North",
	"API",
	"revenue",
	"Q1",
	"onboarding",
	"Internationalization",
	"Telecommunications",
	"self-serve",
	"EMEA",
	"platform",
	"a",
	"cloud",
	"retention",
	"2026",
];
const UNITS = [undefined, "$", "$M", "%", "ms", "k", "users", "°C", "€bn"];

function fuzzChart(seed: number): ChartDiagram {
	const next = random(seed);
	const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
	const kind = pick(["bar", "bar", "line", "pie"] as const);
	const series = kind === "pie" ? 1 : 1 + Math.floor(next() * (next() < 0.5 ? 2 : 6));
	const maxCategories = kind === "pie" ? 8 : Math.min(40, Math.floor(120 / series));
	const count =
		1 + Math.floor(next() * (next() < 0.6 ? Math.min(8, maxCategories) : maxCategories));
	const used = new Set<string>();
	const categories = Array.from({ length: count }, (_, index) => {
		const words = Array.from({ length: 1 + Math.floor(next() * (next() < 0.7 ? 2 : 6)) }, () =>
			pick(WORDS),
		);
		let name = words.join(" ");
		if (used.has(name.toLowerCase())) name = `${name} ${index + 1}`;
		used.add(name.toLowerCase());
		return name;
	});
	const mode = pick(["small", "large", "mixed", "negative", "decimal", "zero", "tiny"] as const);
	const value = () => {
		if (kind === "pie")
			return mode === "tiny" && next() < 0.5 ? next() * 2 : Math.round(next() * 1000);
		switch (mode) {
			case "small":
				return Math.round(next() * 100);
			case "large":
				return Math.round(next() * 10 ** (6 + Math.floor(next() * 4)));
			case "mixed":
				return Math.round((next() * 2 - 1) * 500);
			case "negative":
				return -Math.round(next() * 80) - 1;
			case "decimal":
				return Math.round(next() * 1000) / 100;
			case "zero":
				return next() < 0.7 ? 0 : 5;
			case "tiny":
				return Math.round(next() * 1000) / 1e4;
		}
	};
	const values = () => Array.from({ length: count }, value);
	const seriesList = Array.from({ length: series }, (_, index) => ({
		name: series > 1 || next() < 0.5 ? `${pick(WORDS)} ${index + 1}` : undefined,
		values: values(),
	})).map(({ name, values }) => (name ? { name, values } : { values }));
	if (kind === "pie" && !seriesList[0]!.values.some((entry) => entry > 0))
		seriesList[0]!.values[0] = 1;
	const unit = pick(UNITS);
	return parseChartDiagram({
		id: `fuzz-${seed}`,
		title:
			next() < 0.2
				? "A long chart title that keeps going to test how the header wraps"
				: `Chart ${seed}`,
		type: "chart",
		kind,
		categories,
		series: seriesList,
		...(unit ? { unit } : {}),
		...(kind !== "pie" && next() < 0.5
			? { valueAxisTitle: pick(WORDS), categoryAxisTitle: pick(WORDS) }
			: {}),
		...(kind === "bar" && next() < 0.4 ? { stacked: true } : {}),
		...(kind === "bar" && next() < 0.3
			? { orientation: pick(["vertical", "horizontal"] as const) }
			: {}),
		...(kind === "pie" && next() < 0.5 ? { donut: true } : {}),
	}).pipe(Result.getOrThrow);
}

const chart = (
	input: Partial<ChartDiagram> & Pick<ChartDiagram, "kind" | "categories" | "series">,
) =>
	parseChartDiagram({ id: "chart", title: "Chart", type: "chart", ...input }).pipe(
		Result.getOrThrow,
	);

type SceneEdit = (element: SceneElement) => SceneElement | undefined;

/** The scene with each matching element replaced, or removed where the edit returns undefined. */
function edit(scene: CanvasSpec, id: string, change: SceneEdit): CanvasSpec {
	const matches = (element: SceneElement) =>
		element.id === id || (element.type === "node" && element.nodeId === id);
	if (!scene.elements.some(matches)) throw new Error(`no element ${id}`);
	return {
		...scene,
		elements: scene.elements.flatMap((element) => {
			if (!matches(element)) return [element];
			const changed = change(element);
			return changed ? [changed] : [];
		}),
	};
}

const remove: SceneEdit = () => undefined;
const moveTo =
	(x: number, y: number): SceneEdit =>
	(element) =>
		({ ...element, x, y }) as SceneElement;
const retext =
	(text: string): SceneEdit =>
	(element) =>
		({ ...element, text }) as SceneElement;

function find<T extends SceneElement["type"]>(scene: CanvasSpec, id: string, type: T) {
	const element = scene.elements.find(
		(entry) => entry.id === id || (entry.type === "node" && entry.nodeId === id),
	);
	if (element?.type !== type) throw new Error(`no ${type} ${id}`);
	return element as Extract<SceneElement, { type: T }>;
}

const grouped = chart({
	kind: "bar",
	categories: ["Q1", "Q2", "Q3", "Q4"],
	series: [
		{ name: "2025", values: [42, 51, 47, 63] },
		{ name: "2026", values: [48, 57, 61, 72] },
	],
	unit: "$M",
	valueAxisTitle: "Revenue",
	categoryAxisTitle: "Quarter",
});
const pie = chart({
	kind: "pie",
	categories: ["Dominant", "Tiny one", "Tiny two", "Tiny three", "Tiny four"],
	series: [{ values: [960, 10, 12, 8, 10] }],
});

/** One deliberately broken scene per problem kind the chart oracle reports. */
const broken: Record<string, [ChartDiagram, (scene: CanvasSpec) => CanvasSpec]> = {
	"data-not-drawn": [grouped, (scene) => edit(scene, "chart:value:3:1", retext("$73M"))],
	"text-clipped": [grouped, (scene) => edit(scene, "chart:value-axis-title", moveTo(-40, 100))],
	"text-overlap": [
		grouped,
		(scene) => {
			const { x, y } = find(scene, "chart:category:0", "text");
			return edit(scene, "chart:category:1", moveTo(x, y));
		},
	],
	"text-cuts-bar": [
		grouped,
		(scene) => {
			const bar = find(scene, "chart:bar:0:0", "node");
			return edit(scene, "chart:value:0:0", moveTo(bar.x + bar.width / 2, bar.y));
		},
	],
	"text-covers-mark": [
		grouped,
		(scene) => {
			const key = scene.elements.find(
				(element) => element.type === "node" && element.nodeId.startsWith("chart:key:"),
			) as NodeElement;
			return edit(
				scene,
				"chart:category-axis-title",
				moveTo(key.x + key.width / 2, key.y + key.height / 2),
			);
		},
	],
	"line-crosses-text": [
		grouped,
		(scene) => {
			const { x, y } = find(scene, "chart:category-axis-title", "text");
			return edit(
				scene,
				"chart:baseline",
				(line) =>
					({
						...line,
						points: [
							{ x: x - 40, y },
							{ x: x + 40, y },
						],
					}) as SceneElement,
			);
		},
	],
	"no-zero-tick": [grouped, (scene) => edit(scene, "chart:tick:0", remove)],
	"legend-keys": [
		grouped,
		(scene) => {
			const key = scene.elements.find(
				(element) => element.type === "node" && element.nodeId.startsWith("chart:key:"),
			)!;
			return edit(scene, key.id, remove);
		},
	],
	"bar-length": [
		grouped,
		(scene) =>
			edit(scene, "chart:bar:3:1", (bar) => ({
				...(bar as NodeElement),
				y: (bar as NodeElement).y + (bar as NodeElement).height / 2,
				height: (bar as NodeElement).height / 2,
			})),
	],
	"no-baseline": [grouped, (scene) => edit(scene, "chart:baseline", remove)],
	"bar-off-baseline": [
		grouped,
		(scene) =>
			edit(scene, "chart:bar:0:0", (bar) => ({
				...(bar as NodeElement),
				y: (bar as NodeElement).y - 5,
			})),
	],
	"category-name": [grouped, (scene) => edit(scene, "chart:category:0", retext("Q"))],
	"slice-angle": [
		pie,
		(scene) =>
			edit(scene, "chart:slice:2", (slice) => {
				const { center, radius } = pieGeometry(read(scene));
				const points = (slice as NodeElement).points!;
				const lastRim = points.findLastIndex(
					(point) =>
						Math.hypot(slice.x + point.x - center.x, slice.y + point.y - center.y) > radius * 0.99,
				);
				return { ...(slice as NodeElement), points: points.toSpliced(lastRim, 1) };
			}),
	],
	"slice-share": [
		pie,
		(scene) => edit(scene, "chart:slice-label:0", retext("Dominant\n50% · 960")),
	],
	"label-straddles-pie": [
		pie,
		(scene) => {
			const { center, radius } = pieGeometry(read(scene));
			return edit(scene, "chart:slice-label:0", moveTo(center.x + radius, center.y));
		},
	],
	"leader-enters-pie": [
		pie,
		(scene) => {
			const { center } = pieGeometry(read(scene));
			return edit(
				scene,
				"chart:leader:1:b",
				(line) =>
					({
						...line,
						points: [(line as LineElement).points[0], center],
					}) as SceneElement,
			);
		},
	],
	"leaders-cross": [
		pie,
		(scene) => {
			const { center, radius } = pieGeometry(read(scene));
			const x = center.x + radius + 20;
			const leader =
				(from: CanvasPoint, to: CanvasPoint): SceneEdit =>
				(line) =>
					({ ...line, points: [from, to] }) as SceneElement;
			return edit(
				edit(
					scene,
					"chart:leader:1:b",
					leader({ x, y: center.y - 30 }, { x: x + 60, y: center.y + 30 }),
				),
				"chart:leader:2:b",
				leader({ x, y: center.y + 30 }, { x: x + 60, y: center.y - 30 }),
			);
		},
	],
	"slice-count": [pie, (scene) => edit(scene, "chart:slice:4", remove)],
	"slices-total": [pie, (scene) => edit(scene, "chart:slice:4", remove)],
};

describe("chart oracle", () => {
	it.each(Object.entries(broken))("reports %s on a broken scene", (kind, [diagram, breakScene]) => {
		const scene = renderChartDiagram(diagram);
		expect(chartProblems(diagram, scene)).toEqual([]);
		expect(
			chartProblems(diagram, breakScene(scene)).map((problem) => problem.split(":")[0]),
		).toContain(kind);
	});
});

describe("chart layout", () => {
	it.each([
		[
			"all-negative grouped bars",
			{
				kind: "bar",
				categories: ["North", "South", "East", "West"],
				series: [
					{ name: "2025", values: [-12, -30, -7, -18] },
					{ name: "2026", values: [-9, -22, -11, -14] },
				],
			},
		],
		[
			"twenty columns",
			{
				kind: "bar",
				categories: Array.from({ length: 20 }, (_, i) => `C${i + 1}`),
				series: [{ values: Array.from({ length: 20 }, (_, i) => (i * 7) % 23) }],
			},
		],
		[
			"very long labels",
			{
				kind: "bar",
				categories: [
					"A very long category label about onboarding and activation",
					"Another extremely verbose category label",
					"Short",
				],
				series: [{ values: [120, 80, 30] }],
			},
		],
		[
			"all-zero lines",
			{
				kind: "line",
				categories: ["A", "B", "C"],
				series: [
					{ name: "x", values: [0, 0, 0] },
					{ name: "y", values: [0, 0, 0] },
				],
			},
		],
		["one category", { kind: "bar", categories: ["Only"], series: [{ values: [3] }] }],
		[
			"huge values",
			{
				kind: "bar",
				categories: ["A", "B"],
				series: [{ values: [1_234_567_890, 987_654_321] }],
				unit: "$",
			},
		],
		[
			"a full slice beside a zero slice",
			{ kind: "pie", categories: ["All", "None"], series: [{ values: [5, 0] }] },
		],
		[
			"a lone donut slice",
			{ kind: "pie", donut: true, categories: ["All"], series: [{ values: [1] }] },
		],
	] as const)("lays out %s readably", (_, input) => {
		expectReadableChart(chart(input as never));
	});

	it("keeps every invariant across a seeded fuzz of kinds, sizes, labels and value ranges", () => {
		const seeds = Number(process.env["CHART_FUZZ_SEEDS"] ?? 12);
		for (let seed = 1; seed <= seeds; seed += 1) expectReadableChart(fuzzChart(seed));
		// Seeds 1–12 cover every kind, but decimal values first appear at seed 27.
		if (seeds < 27) expectReadableChart(fuzzChart(27));
	});
});

/** Whether a step is 1, 2 or 5 × 10^n. */
function isNiceStep(step: number): boolean {
	const exponent = Math.floor(Math.log10(step) + 1e-9);
	const mantissa = Number((step / 10 ** exponent).toPrecision(6));
	return [1, 2, 5].includes(mantissa);
}

describe("chart scales", () => {
	it("picks 1/2/5 × 10^n steps whose ticks cover the data, across a fuzz of ranges", () => {
		const next = random(424);
		for (let run = 0; run < 2000; run += 1) {
			const magnitude = 10 ** Math.floor(next() * 14 - 6);
			const a = (next() * 2 - 1) * magnitude;
			const b = next() < 0.2 ? a : (next() * 2 - 1) * magnitude;
			const scale = niceScale(Math.min(a, b), Math.max(a, b));
			expect(isNiceStep(scale.step), `${a}..${b} step ${scale.step}`).toBe(true);
			expect(scale.min).toBeLessThanOrEqual(Math.min(a, b) + 1e-12 * magnitude);
			expect(scale.max).toBeGreaterThanOrEqual(Math.max(a, b) - 1e-12 * magnitude);
			expect(scale.ticks.length - 1).toBeGreaterThanOrEqual(1);
			expect(scale.ticks.length - 1).toBeLessThanOrEqual(8);
			scale.ticks.forEach((tick, index) => {
				expect(tick).toBeCloseTo(scale.min + index * scale.step, 9);
				expect(Math.abs(tick / scale.step - Math.round(tick / scale.step))).toBeLessThan(1e-6);
			});
		}
	});

	it("labels each slice with its own rounded share, never one label for two different values", () => {
		const next = random(7);
		for (let run = 0; run < 2000; run += 1) {
			const count = 1 + Math.floor(next() * 8);
			const values = Array.from({ length: count }, () =>
				next() < 0.2 ? next() * 0.01 : Math.round(next() * 1000),
			);
			if (!values.some((value) => value > 0)) continue;
			const { labels, shares, decimals } = piePercentages(values);
			expect(decimals).toBeLessThanOrEqual(PIE_MAX_DECIMALS);
			labels.forEach((label, index) => {
				const value = values[index]!;
				if (label.startsWith("<")) {
					expect(value).toBeGreaterThan(0);
					expect(decimals).toBe(PIE_MAX_DECIMALS);
					return;
				}
				// The label is value ÷ total at the precision the chart shows.
				expect(Math.abs(Number.parseFloat(label) - shares[index]!)).toBeLessThanOrEqual(
					0.5 * 10 ** -decimals + 1e-9,
				);
				if (value > 0) expect(Number.parseFloat(label)).toBeGreaterThan(0);
				if (decimals < PIE_MAX_DECIMALS)
					values.forEach((other, later) => {
						if (later > index && other !== value) expect(labels[later]).not.toBe(label);
					});
			});
			if (shares.some((share) => share > 0 && share < 10)) expect(decimals).toBeGreaterThan(0);
		}
	});
});
