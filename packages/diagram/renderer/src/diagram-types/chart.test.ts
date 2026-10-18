import {
	CANVAS_LIMITS,
	chartFixture,
	estimateTextWidth,
	getCanvasValidationIssues,
	parseChartDiagram,
	type ChartDiagram,
	type CanvasPoint,
} from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { chartBarOrientation, renderChartDiagram } from "../chart.js";
import { readChartMarks } from "../chart-readout.js";
import { formatValue, piePercentages, unitParts } from "../chart-scale.js";
import { renderDiagram } from "../diagram.js";
import type { RenderedDiagramScene, SceneElement } from "../scene.js";

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

function read(scene: RenderedDiagramScene): Readout {
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

/** Every layout invariant a chart must hold, whatever its data. */
/** Value-bearing text: bar and point values, data-table cells and pie labels. */
const VALUE_TEXT = /^chart:(value|table|slice-label):/u;

/**
 * Every authored number, category, series name and axis title is drawn as
 * text, formatted as the renderer formats it: nothing is left to subtraction.
 */
function expectDrawnData(diagram: ChartDiagram, scene: RenderedDiagramScene): void {
	const texts = scene.elements.filter((element): element is TextElement => element.type === "text");
	const drawn = texts.map((element) => element.text.replace(/\n/gu, " "));
	const counts = new Map<string, number>();
	for (const element of texts.filter((entry) => VALUE_TEXT.test(entry.id)))
		for (const line of element.text.split("\n"))
			for (const segment of line.split(" · ")) counts.set(segment, (counts.get(segment) ?? 0) + 1);
	const parts = unitParts(diagram.unit);
	for (const series of diagram.series)
		for (const value of series.values) {
			const text = formatValue(value, parts);
			const left = counts.get(text) ?? 0;
			expect(left, `${diagram.id}: value ${text} is not drawn`).toBeGreaterThan(0);
			counts.set(text, left - 1);
		}
	const names = [
		...diagram.categories,
		...diagram.series.flatMap((series) => (series.name ? [series.name] : [])),
		...(diagram.categoryAxisTitle ? [diagram.categoryAxisTitle] : []),
		...(diagram.valueAxisTitle ? [diagram.valueAxisTitle] : []),
	];
	for (const name of names)
		expect(
			drawn.some((text) => text.toLowerCase().includes(name.replace(/\s+/gu, " ").toLowerCase())),
			`${diagram.id}: "${name}" is not drawn`,
		).toBe(true);
}

function expectReadableChart(diagram: ChartDiagram): RenderedDiagramScene {
	const scene = renderChartDiagram(diagram);
	const label = `${diagram.id}`;
	expectDrawnData(diagram, scene);
	expect(getCanvasValidationIssues(scene), label).toEqual([]);
	expect(scene.elements.length, label).toBeLessThanOrEqual(CANVAS_LIMITS.maxElements);
	expect(renderChartDiagram(diagram), label).toEqual(scene);
	const readout = read(scene);
	// No text overlaps another, and none leaves the scene.
	readout.texts.forEach(({ element, box }, index) => {
		expect(
			box.left >= 0 && box.top >= 0 && box.right <= scene.width && box.bottom <= scene.height,
			`${label}: ${element.id} clipped`,
		).toBe(true);
		for (const other of readout.texts.slice(index + 1))
			expect(overlaps(box, other.box), `${label}: ${element.id} overlaps ${other.element.id}`).toBe(
				false,
			);
	});
	// Text sits fully inside a bar or clear of it, and clear of every marker and legend key.
	for (const { element, box } of readout.texts) {
		for (const bar of readout.bars) {
			const barBox = nodeBox(bar.element);
			expect(
				!overlaps(box, barBox) || contains(barBox, box),
				`${label}: ${element.id} cuts bar ${bar.element.id}`,
			).toBe(true);
		}
		for (const mark of [...readout.markers, ...readout.keys])
			expect(overlaps(box, nodeBox(mark)), `${label}: ${element.id} covers ${mark.id}`).toBe(false);
	}
	// No line runs through text: series lines, leaders, gridlines, the baseline and the axis.
	for (const line of readout.lines) {
		if (/^chart:(legend|table-key):/u.test(line.id)) continue;
		for (const { element, box } of readout.texts)
			for (let index = 1; index < line.points.length; index += 1)
				expect(
					segmentHitsBox(line.points[index - 1]!, line.points[index]!, box),
					`${label}: ${line.id} crosses ${element.id}`,
				).toBe(false);
	}
	if (diagram.kind !== "pie") {
		expect(
			readout.texts.some((text) => text.element.id === "chart:tick:0"),
			label,
		).toBe(true);
		expect(readout.keys.length, label).toBe(diagram.series.length > 1 ? diagram.series.length : 0);
	}
	if (diagram.kind === "bar") expectProportionalBars(diagram, scene, readout);
	if (diagram.kind === "pie") expectPieAngles(diagram, scene, readout);
	if (diagram.kind === "bar" || diagram.kind === "pie") {
		// Every category is named once, its words whole.
		diagram.categories.forEach((category, index) => {
			const id = diagram.kind === "pie" ? `chart:slice-label:${index}` : `chart:category:${index}`;
			const text = readout.texts.find((entry) => entry.element.id === id)?.element.text;
			expect(text, `${label}: ${id}`).toBeDefined();
			const words = text!.replace(/\n/gu, " ");
			expect(words.startsWith(category.replace(/\s+/gu, " ")), `${label}: ${id} "${words}"`).toBe(
				true,
			);
		});
	}
	return scene;
}

function expectProportionalBars(
	diagram: ChartDiagram,
	scene: RenderedDiagramScene,
	readout: Readout,
): void {
	const vertical = chartBarOrientation(diagram) === "vertical";
	const rates = readout.bars.map(({ element, category, series }) => {
		const value = Math.abs(diagram.series[series]!.values[category]!);
		const length = vertical ? element.height : element.width;
		return { rate: length / value, length, value };
	});
	if (rates.length === 0) return;
	const reference = rates.toSorted((a, b) => b.length - a.length)[0]!.rate;
	for (const { rate, length, value } of rates)
		expect(
			Math.abs(rate * value - reference * value),
			`${diagram.id}: bar of ${value} drawn ${length}`,
		).toBeLessThan(0.6);
	// Unstacked bars all grow from the zero baseline.
	const baseline = scene.elements.find(
		(element): element is LineElement => element.id === "chart:baseline",
	);
	expect(baseline, diagram.id).toBeDefined();
	if (diagram.stacked && diagram.series.length > 1) return;
	const zero = vertical ? baseline!.points[0].y : baseline!.points[0].x;
	for (const { element } of readout.bars) {
		const ends = vertical
			? [element.y, element.y + element.height]
			: [element.x, element.x + element.width];
		expect(
			Math.min(...ends.map((end) => Math.abs(end - zero))),
			`${diagram.id}: ${element.id} off baseline`,
		).toBeLessThan(0.02);
	}
}

function expectPieAngles(
	diagram: ChartDiagram,
	scene: RenderedDiagramScene,
	readout: Readout,
): void {
	const values = diagram.series[0]!.values;
	const total = values.reduce((sum, value) => sum + value, 0);
	const all = readout.slices.flatMap(({ element }) => polygonPoints(element));
	const xs = all.map((point) => point.x);
	const ys = all.map((point) => point.y);
	const center = {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
	};
	const radius = (Math.max(...xs) - Math.min(...xs)) / 2;
	const marks = readChartMarks(scene).slices;
	let sum = 0;
	for (const { element, index } of readout.slices) {
		const degrees = marks.find((mark) => mark.index === index)!.degrees;
		const expected = (values[index]! / total) * 360;
		expect(Math.abs(degrees - expected), `${diagram.id}: slice ${index}`).toBeLessThan(0.05);
		sum += degrees;
		// Each label states value ÷ total at the chart's precision.
		const label = readout.texts.find((text) => text.element.id === `chart:slice-label:${index}`)!;
		const stated = /(<)?(\d+(?:\.\d+)?)%/u.exec(label.element.text.split("\n").at(-1)!)!;
		const { decimals } = piePercentages(values);
		if (!stated[1])
			expect(
				Math.abs(Number(stated[2]) - expected / 3.6),
				`${diagram.id}: label ${index}`,
			).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-9);
		// Labels inside a slice sit inside its polygon; outside labels stay off the pie.
		const box = readout.texts.find((text) => text.element.id === `chart:slice-label:${index}`)!.box;
		const inside = corners(box).every((corner) => insidePolygon(corner, polygonPoints(element)));
		if (!inside)
			expect(
				corners(box).every(
					(corner) => Math.hypot(corner.x - center.x, corner.y - center.y) > radius,
				),
				`${diagram.id}: label ${index} half inside`,
			).toBe(true);
	}
	// Leaders stay off the pie and never cross one another.
	const leaders = readout.lines.filter((line) => line.id.startsWith("chart:leader:"));
	const owner = (id: string) => id.split(":")[2];
	for (const [index, leader] of leaders.entries()) {
		const [from, to] = leader.points;
		for (let step = 0; step <= 40; step += 1) {
			const x = from.x + ((to.x - from.x) * step) / 40;
			const y = from.y + ((to.y - from.y) * step) / 40;
			expect(
				Math.hypot(x - center.x, y - center.y),
				`${diagram.id}: ${leader.id} enters the pie`,
			).toBeGreaterThan(radius);
		}
		for (const other of leaders.slice(index + 1))
			if (owner(other.id) !== owner(leader.id))
				expect(
					segmentsCross(from, to, other.points[0], other.points[1]),
					`${diagram.id}: ${leader.id} crosses ${other.id}`,
				).toBe(false);
	}
	const drawn = values.filter((value) => (value / total) * 2 * Math.PI > 0.0035);
	const missing = values.reduce(
		(gap, value) => gap + ((value / total) * 2 * Math.PI <= 0.0035 ? (value / total) * 360 : 0),
		0,
	);
	expect(readout.slices.length).toBe(drawn.length);
	expect(Math.abs(sum + missing - 360), diagram.id).toBeLessThan(0.05);
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
	});
}

const chart = (
	input: Partial<ChartDiagram> & Pick<ChartDiagram, "kind" | "categories" | "series">,
) => parseChartDiagram({ id: "chart", title: "Chart", type: "chart", ...input });

describe("native chart layout", () => {
	it("renders the fixture into a valid deterministic scene through renderDiagram", () => {
		const scene = renderDiagram(chartFixture);
		expect(scene.diagramId).toBe("quarterly-revenue-chart");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(renderDiagram(chartFixture)).toEqual(scene);
	});

	it("draws grouped columns from a zero baseline with values on their caps and a legend", () => {
		const diagram = chart({
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
		const scene = expectReadableChart(diagram);
		const texts = new Map(read(scene).texts.map(({ element }) => [element.id, element.text]));
		expect(chartBarOrientation(diagram)).toBe("vertical");
		expect(texts.get("chart:value:3:1")).toBe("$72M");
		expect(texts.get("chart:legend:1:label")).toBe("2026");
		expect(texts.get("chart:value-axis-title")).toBe("Revenue");
		expect(texts.get("chart:category-axis-title")).toBe("Quarter");
		const ticks = [...texts].filter(([id]) => id.startsWith("chart:tick:")).map(([, text]) => text);
		expect(ticks).toEqual(["$0", "$20M", "$40M", "$60M", "$80M"]);
	});

	it("stacks positive and negative segments apart and labels each stack's totals", () => {
		const diagram = chart({
			kind: "bar",
			stacked: true,
			categories: ["North", "South"],
			series: [
				{ name: "Gain", values: [30, 12] },
				{ name: "Loss", values: [-10, -25] },
				{ name: "Fees", values: [5, 4] },
			],
		});
		const scene = expectReadableChart(diagram);
		const texts = new Map(read(scene).texts.map(({ element }) => [element.id, element.text]));
		expect(texts.get("chart:total:0")).toBe("35");
		expect(texts.get("chart:total-negative:1")).toBe("-25");
		const bars = read(scene).bars;
		const gain = bars.find((bar) => bar.category === 0 && bar.series === 0)!.element;
		const fees = bars.find((bar) => bar.category === 0 && bar.series === 2)!.element;
		const loss = bars.find((bar) => bar.category === 0 && bar.series === 1)!.element;
		// Fees stack on top of the gain; the loss hangs below the baseline.
		expect(fees.y + fees.height).toBeCloseTo(gain.y, 1);
		expect(loss.y).toBeCloseTo(gain.y + gain.height, 1);
	});

	it("turns bars horizontal when category names cannot fit under columns, unless told otherwise", () => {
		const categories = [
			"Enterprise analytics platform",
			"Professional services and onboarding",
			"Marketplace integrations",
		];
		const auto = chart({
			kind: "bar",
			categories,
			series: [{ values: [4.2, 1.9, 1.1] }],
			unit: "$M",
		});
		expect(chartBarOrientation(auto)).toBe("horizontal");
		expectReadableChart(auto);
		const forced = chart({
			kind: "bar",
			orientation: "vertical",
			categories,
			series: [{ values: [4.2, 1.9, 1.1] }],
		});
		expect(chartBarOrientation(forced)).toBe("vertical");
		const scene = expectReadableChart(forced);
		const label = read(scene).texts.find((text) => text.element.id === "chart:category:1")!.element
			.text;
		expect(label.split("\n").length).toBeGreaterThan(1);
	});

	it("draws lines with a distinct marker shape per series", () => {
		const diagram = chart({
			kind: "line",
			categories: ["W1", "W2", "W3", "W4"],
			series: Array.from({ length: 6 }, (_, index) => ({
				name: `S${index}`,
				values: [1, 3, 2, 4].map((value) => value + index),
			})),
		});
		const scene = expectReadableChart(diagram);
		const markers = read(scene).markers;
		const signature = (series: number) => {
			const marker = markers.find((element) => element.nodeId === `chart:point:0:${series}`)!;
			return `${marker.shape}:${JSON.stringify(marker.points ?? [])}:${marker.fillColor === "#fffdf8"}`;
		};
		expect(new Set(Array.from({ length: 6 }, (_, series) => signature(series))).size).toBe(6);
	});

	it("labels a single line's points clear of the line, crossing zero", () => {
		const diagram = chart({
			kind: "line",
			categories: ["2019", "2020", "2021", "2022", "2023", "2024"],
			series: [{ name: "Anomaly", values: [-0.4, -0.1, 0.2, -0.2, 0.5, 0.8] }],
			unit: "°C",
		});
		const scene = expectReadableChart(diagram);
		const values = read(scene).texts.filter((text) => text.element.id.startsWith("chart:value:"));
		expect(values.map((text) => text.element.text)).toEqual([
			"-0.4°C",
			"-0.1°C",
			"0.2°C",
			"-0.2°C",
			"0.5°C",
			"0.8°C",
		]);
	});

	it("names every line category and tables values that cannot sit on the points", () => {
		const categories = Array.from({ length: 36 }, (_, index) => `Month ${index + 1}`);
		const diagram = chart({
			kind: "line",
			categories,
			series: [
				{ name: "Teams", values: categories.map((_, index) => index) },
				{ name: "Seats", values: categories.map((_, index) => 2 * index) },
			],
		});
		const scene = expectReadableChart(diagram);
		const texts = read(scene).texts;
		expect(texts.filter((text) => text.element.id.startsWith("chart:category:"))).toHaveLength(36);
		expect(texts.find((text) => text.element.id === "chart:table:35:1")?.element.text).toBe("70");
	});

	it("holds a stacked value inside its segment whenever the text fits", () => {
		const scene = expectReadableChart(
			chart({
				kind: "bar",
				stacked: true,
				categories: ["Mon", "Tue", "Wed", "Thu", "Fri"],
				series: [
					{ name: "Email", values: [30, 42, 38, 45, 28] },
					{ name: "Chat", values: [55, 61, 58, 70, 49] },
					{ name: "Phone", values: [12, 15, 9, 18, 11] },
				],
			}),
		);
		const readout = read(scene);
		const segment = readout.bars.find((bar) => bar.category === 2 && bar.series === 2)!.element;
		const label = readout.texts.find((text) => text.element.id === "chart:value:2:2")!;
		expect(label.element.text).toBe("9");
		expect(contains(nodeBox(segment), label.box)).toBe(true);
		expect(readout.lines.some((line) => line.id.startsWith("chart:leader:"))).toBe(false);
	});

	it("labels a stacked sliver beside the bar on a leader, clear of the total", () => {
		const scene = expectReadableChart(
			chart({
				kind: "bar",
				stacked: true,
				categories: ["Mon", "Wed"],
				series: [
					{ name: "Email", values: [30, 38] },
					{ name: "Chat", values: [55, 58] },
					{ name: "Phone", values: [12, 2] },
				],
			}),
		);
		const readout = read(scene);
		const segment = readout.bars.find((bar) => bar.category === 1 && bar.series === 2)!.element;
		const label = readout.texts.find((text) => text.element.id === "chart:value:1:2")!;
		const total = readout.texts.find((text) => text.element.id === "chart:total:1")!;
		expect(label.element.text).toBe("2");
		expect(label.box.left).toBeGreaterThan(segment.x + segment.width);
		expect(label.box.left).toBeGreaterThan(total.box.right);
		expect(readout.lines.some((line) => line.id === "chart:leader:1:2:a")).toBe(true);
	});

	it("labels a horizontal stacked sliver in a row under its bar", () => {
		const scene = expectReadableChart(
			chart({
				kind: "bar",
				stacked: true,
				orientation: "horizontal",
				categories: ["North", "South"],
				series: [
					{ name: "Gain", values: [300, 280] },
					{ name: "Fees", values: [3, 120] },
				],
			}),
		);
		const readout = read(scene);
		const segment = readout.bars.find((bar) => bar.category === 0 && bar.series === 1)!.element;
		const label = readout.texts.find((text) => text.element.id === "chart:value:0:1")!;
		expect(label.box.top).toBeGreaterThan(segment.y + segment.height);
		expect(readout.lines.some((line) => line.id === "chart:leader:0:1:b")).toBe(true);
	});

	it("names a lone series the titles do not already name", () => {
		const scene = expectReadableChart(
			chart({
				kind: "bar",
				categories: ["A", "B"],
				series: [{ name: "Median latency", values: [1, 2] }],
			}),
		);
		expect(read(scene).texts.some((text) => text.element.text === "Median latency")).toBe(true);
	});

	it("labels pie slices with shares that total 100%, moving thin slices outside on leaders", () => {
		const diagram = chart({
			kind: "pie",
			categories: ["Dominant", "Tiny one", "Tiny two", "Tiny three", "Tiny four"],
			series: [{ values: [960, 10, 12, 8, 10] }],
		});
		const scene = expectReadableChart(diagram);
		const readout = read(scene);
		const label = (index: number) =>
			readout.texts.find((text) => text.element.id === `chart:slice-label:${index}`)!.element.text;
		expect(label(0)).toBe("Dominant\n96% · 960");
		expect(label(2)).toBe("Tiny two\n1.2% · 12");
		for (const index of [1, 2, 3, 4])
			expect(readout.lines.some((line) => line.id === `chart:leader:${index}:b`)).toBe(true);
		expect(readout.lines.some((line) => line.id === "chart:leader:0:b")).toBe(false);
	});

	it("splits a run of thin slices near the top across both sides of the pie", () => {
		const scene = expectReadableChart(
			chart({
				kind: "pie",
				categories: ["Compute", "Storage", "Networking", "Support", "Licenses"],
				series: [{ values: [920, 40, 22, 11, 7] }],
				unit: "$k",
			}),
		);
		const labels = read(scene).texts.filter((text) =>
			text.element.id.startsWith("chart:slice-label:"),
		);
		const slices = read(scene).slices.flatMap(({ element }) =>
			polygonPoints(element).map((point) => point.x),
		);
		const centerX = (Math.min(...slices) + Math.max(...slices)) / 2;
		const outside = labels.filter((label) => label.element.id !== "chart:slice-label:0");
		expect(outside.some((label) => label.box.left > centerX)).toBe(true);
		expect(outside.some((label) => label.box.right < centerX)).toBe(true);
	});

	it("draws donut slices as rings and shows percent data without repeating values", () => {
		const diagram = chart({
			kind: "pie",
			donut: true,
			categories: ["Chrome", "Safari", "Other"],
			series: [{ values: [64, 19, 17] }],
			unit: "%",
		});
		const scene = expectReadableChart(diagram);
		const readout = read(scene);
		const chrome = polygonPoints(readout.slices[0]!.element);
		const xs = readout.slices.flatMap(({ element }) =>
			polygonPoints(element).map((point) => point.x),
		);
		const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
		const ys = readout.slices.flatMap(({ element }) =>
			polygonPoints(element).map((point) => point.y),
		);
		const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
		expect(insidePolygon({ x: centerX, y: centerY }, chrome)).toBe(false);
		expect(
			readout.texts.find((text) => text.element.id === "chart:slice-label:0")!.element.text,
		).toBe("Chrome\n64%");
	});

	it("never labels a tiny nonzero bar as zero", () => {
		const diagram = chart({
			kind: "bar",
			categories: ["A", "B"],
			series: [{ values: [0.00001, 0.00002] }],
			unit: "s",
		});
		const scene = expectReadableChart(diagram);
		const values = read(scene).texts.filter((text) => text.element.id.startsWith("chart:value:"));
		expect(values.map((text) => text.element.text)).toEqual(["0.00001 s", "0.00002 s"]);
	});

	it("keeps pie values and units unless the data is in percent", () => {
		const dollars = expectReadableChart(
			chart({
				kind: "pie",
				categories: ["Rent", "Food"],
				series: [{ values: [40, 60] }],
				unit: "$",
			}),
		);
		const labels = read(dollars).texts.filter((text) =>
			text.element.id.startsWith("chart:slice-label:"),
		);
		expect(labels.map((text) => text.element.text.split("\n").at(-1))).toEqual([
			"40% · $40",
			"60% · $60",
		]);
		const percent = expectReadableChart(
			chart({
				kind: "pie",
				categories: ["Rent", "Food"],
				series: [{ values: [40, 60] }],
				unit: "%",
			}),
		);
		const shares = read(percent).texts.filter((text) =>
			text.element.id.startsWith("chart:slice-label:"),
		);
		expect(shares.map((text) => text.element.text.split("\n").at(-1))).toEqual(["40%", "60%"]);
	});

	it("draws a single full slice and zero slices", () => {
		expectReadableChart(
			chart({ kind: "pie", categories: ["All", "None"], series: [{ values: [5, 0] }] }),
		);
		expectReadableChart(
			chart({ kind: "pie", donut: true, categories: ["All"], series: [{ values: [1] }] }),
		);
	});

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
	] as const)("lays out %s readably", (_, input) => {
		expectReadableChart(chart(input as never));
	});

	it("keeps every invariant across a seeded fuzz of kinds, sizes, labels and value ranges", () => {
		for (let seed = 1; seed <= 300; seed += 1) expectReadableChart(fuzzChart(seed));
	});
});
