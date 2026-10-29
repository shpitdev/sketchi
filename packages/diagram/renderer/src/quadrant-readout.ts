import {
	estimateTextWidth,
	QUADRANT_KEYS,
	type QuadrantDiagram,
	type QuadrantKey,
} from "@sketchi/diagram-core";

import {
	QUADRANT_NEAREST_MARGIN,
	quadrantMisreadDot,
	quadrantBoxDistance,
	quadrantDotClumps,
	quadrantPointPosition,
	quadrantSegmentHitsBox,
	quadrantSegmentsCross,
	type QuadrantBox,
} from "./quadrant.js";
import type { RenderedDiagramScene, SceneElement, ScenePoint } from "./scene.js";

type NodeElement = Extract<SceneElement, { type: "node" }>;
type TextElement = Extract<SceneElement, { type: "text" }>;
type LineElement = Extract<SceneElement, { type: "line" }>;

export interface QuadrantReadout {
	/** The square the four quadrant tints cover. */
	readonly plot: QuadrantBox | undefined;
	readonly regions: Partial<Record<QuadrantKey, QuadrantBox>>;
	readonly dots: readonly {
		readonly index: number;
		readonly center: ScenePoint;
		readonly box: QuadrantBox;
	}[];
	readonly labels: readonly {
		readonly index: number;
		readonly text: string;
		readonly box: QuadrantBox;
	}[];
	readonly names: readonly {
		readonly key: QuadrantKey;
		readonly text: string;
		readonly box: QuadrantBox;
	}[];
	readonly leaders: readonly {
		readonly index: number;
		readonly from: ScenePoint;
		readonly to: ScenePoint;
	}[];
	readonly texts: readonly {
		readonly id: string;
		readonly text: string;
		readonly box: QuadrantBox;
	}[];
	/** Midline pieces and axes. */
	readonly rules: readonly {
		readonly id: string;
		readonly from: ScenePoint;
		readonly to: ScenePoint;
	}[];
}

function textBox(element: TextElement): QuadrantBox {
	const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
	const height = element.text.split("\n").length * element.fontSize * 1.35;
	return {
		left: element.x - width / 2,
		top: element.y - height / 2,
		right: element.x + width / 2,
		bottom: element.y + height / 2,
	};
}

function nodeBox(element: NodeElement): QuadrantBox {
	return {
		left: element.x,
		top: element.y,
		right: element.x + element.width,
		bottom: element.y + element.height,
	};
}

/** Read a rendered quadrant chart's plot, dots, labels, names and leaders back from its scene. */
export function readQuadrantScene(scene: RenderedDiagramScene): QuadrantReadout {
	const nodes = scene.elements.filter((element): element is NodeElement => element.type === "node");
	const texts = scene.elements.filter((element): element is TextElement => element.type === "text");
	const lines = scene.elements.filter((element): element is LineElement => element.type === "line");
	const regions: Partial<Record<QuadrantKey, QuadrantBox>> = {};
	for (const key of QUADRANT_KEYS) {
		const region = nodes.find((node) => node.nodeId === `quadrant:region:${key}`);
		if (region) regions[key] = nodeBox(region);
	}
	const boxes = Object.values(regions);
	const plot = boxes.length
		? {
				left: Math.min(...boxes.map((box) => box.left)),
				top: Math.min(...boxes.map((box) => box.top)),
				right: Math.max(...boxes.map((box) => box.right)),
				bottom: Math.max(...boxes.map((box) => box.bottom)),
			}
		: undefined;
	const indexed = <T>(id: string, prefix: string, value: (index: number) => T): T[] => {
		const match = new RegExp(`^${prefix}(\\d+)$`, "u").exec(id);
		return match ? [value(Number(match[1]))] : [];
	};
	return {
		plot,
		regions,
		dots: nodes.flatMap((node) =>
			indexed(node.nodeId, "quadrant:point:", (index) => {
				const box = nodeBox(node);
				return {
					index,
					box,
					center: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
				};
			}),
		),
		labels: texts.flatMap((text) =>
			indexed(text.id, "quadrant:label:", (index) => ({
				index,
				text: text.text,
				box: textBox(text),
			})),
		),
		names: texts.flatMap((text) => {
			const key = QUADRANT_KEYS.find((candidate) => text.id === `quadrant:name:${candidate}`);
			return key ? [{ key, text: text.text, box: textBox(text) }] : [];
		}),
		leaders: lines.flatMap((line) =>
			indexed(line.id, "quadrant:leader:", (index) => ({
				index,
				from: line.points[0],
				to: line.points.at(-1)!,
			})),
		),
		texts: texts.map((text) => ({ id: text.id, text: text.text, box: textBox(text) })),
		rules: lines
			.filter(
				(line) =>
					line.id.startsWith("quadrant:midline:") || /^quadrant:axis:[xy](:\d+)?$/u.test(line.id),
			)
			.map((line) => ({ id: line.id, from: line.points[0], to: line.points.at(-1)! })),
	};
}

export interface QuadrantLayoutIssue {
	readonly code:
		| "missing-plot"
		| "missing-point"
		| "dot-position"
		| "label-outside-plot"
		| "text-overlap"
		| "label-over-dot"
		| "detached-label"
		| "misread-label"
		| "name-over-dot"
		| "name-outside-quadrant"
		| "leader-crossing"
		| "leader-over-dot"
		| "rule-crosses-text"
		| "broken-divider"
		| "broken-word"
		| "wide-aspect";
	readonly message: string;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
/** Whether a segment's ends reach both ends of a span, in either order. */
const covers = (a: number, b: number, low: number, high: number) =>
	Math.min(a, b) <= low + 0.5 && Math.max(a, b) >= high - 0.5;

/** A box shrunk by a slack, so boxes that only touch never count as overlapping. */
function shrink(box: QuadrantBox, slack: number): QuadrantBox {
	return {
		left: box.left + slack,
		top: box.top + slack,
		right: box.right - slack,
		bottom: box.bottom - slack,
	};
}

function overlap(a: QuadrantBox, b: QuadrantBox, slack = 0.5): boolean {
	return (
		a.left < b.right - slack &&
		b.left < a.right - slack &&
		a.top < b.bottom - slack &&
		b.top < a.bottom - slack
	);
}

function contains(outer: QuadrantBox, inner: QuadrantBox, slack = 0.5): boolean {
	return (
		inner.left >= outer.left - slack &&
		inner.right <= outer.right + slack &&
		inner.top >= outer.top - slack &&
		inner.bottom <= outer.bottom + slack
	);
}

/** Whether every Latin word of a label stays whole on one of its drawn lines. */
function wordsWhole(label: string, drawn: string): boolean {
	const tokens = new Set(drawn.split(/\s+/u));
	return label
		.split(/\s+/u)
		.filter((word) => word.length > 0 && /^[\p{Script=Latin}\p{N}\p{P}\p{S}]+$/u.test(word))
		.every((word) => tokens.has(word));
}

/** The widest a chart may read before it stops fitting a page or a screen. */
export const QUADRANT_MAX_ASPECT = 2.45;

/**
 * Everything that would make a rendered quadrant chart misread: a dot off its
 * exact position, a label outside the plot, over another text or a dot, a
 * leader or rule through text, a broken word, or a name over a dot.
 */
export function quadrantLayoutIssues(
	scene: RenderedDiagramScene,
	diagram: Pick<QuadrantDiagram, "points">,
): QuadrantLayoutIssue[] {
	const readout = readQuadrantScene(scene);
	const issues: QuadrantLayoutIssue[] = [];
	const { plot } = readout;
	if (!plot) return [{ code: "missing-plot", message: "The chart draws no quadrants." }];
	diagram.points.forEach((point, index) => {
		const dot = readout.dots.find((entry) => entry.index === index);
		const label = readout.labels.find((entry) => entry.index === index);
		if (!dot || !label) {
			issues.push({
				code: "missing-point",
				message: `Point ${index} ("${point.label}") has no ${dot ? "label" : "dot"}.`,
			});
			return;
		}
		const expected = quadrantPointPosition(point, plot);
		const off = Math.hypot(dot.center.x - expected.x, dot.center.y - expected.y);
		if (off > 0.02)
			issues.push({
				code: "dot-position",
				message: `Point "${point.label}" sits ${off.toFixed(2)} px from (${point.x}, ${point.y}).`,
			});
		if (!contains(plot, label.box))
			issues.push({
				code: "label-outside-plot",
				message: `The label of "${point.label}" leaves the plot.`,
			});
		if (!wordsWhole(point.label, label.text))
			issues.push({
				code: "broken-word",
				message: `The label of "${point.label}" breaks a word: ${JSON.stringify(label.text)}.`,
			});
	});
	const { texts } = readout;
	for (let first = 0; first < texts.length; first += 1)
		for (let second = first + 1; second < texts.length; second += 1)
			if (overlap(texts[first]!.box, texts[second]!.box))
				issues.push({
					code: "text-overlap",
					message: `${texts[first]!.id} overlaps ${texts[second]!.id}.`,
				});
	for (const dot of readout.dots) {
		for (const label of readout.labels)
			if (overlap(label.box, dot.box))
				issues.push({
					code: "label-over-dot",
					message: `The label of point ${label.index} covers the dot of point ${dot.index}.`,
				});
		for (const name of readout.names)
			if (overlap(name.box, dot.box))
				issues.push({
					code: "name-over-dot",
					message: `The ${name.key} name covers the dot of point ${dot.index}.`,
				});
	}
	// A label without a leader sits nearer its own dot than any other dot elsewhere.
	for (const label of readout.labels) {
		if (readout.leaders.some((leader) => leader.index === label.index)) continue;
		const own = readout.dots.find((dot) => dot.index === label.index);
		if (!own) continue;
		const distance = quadrantBoxDistance(label.box, own.center);
		const nearer = readout.dots.find(
			(dot) =>
				dot.index !== label.index &&
				Math.hypot(dot.center.x - own.center.x, dot.center.y - own.center.y) >= 1 &&
				quadrantBoxDistance(label.box, dot.center) <= distance + QUADRANT_NEAREST_MARGIN - 0.5,
		);
		if (nearer)
			issues.push({
				code: "detached-label",
				message: `The label of point ${label.index} sits as near the dot of point ${nearer.index} as its own.`,
			});
	}
	// Nor does it line up with a near dot that is not its own while off its own dot's row and column.
	const centers = diagram.points.map(
		(_, index) => readout.dots.find((dot) => dot.index === index)?.center,
	);
	for (const label of readout.labels) {
		if (readout.leaders.some((leader) => leader.index === label.index)) continue;
		const misread = quadrantMisreadDot(label.box, label.index, centers, 0.5);
		if (misread !== undefined)
			issues.push({
				code: "misread-label",
				message: `The label of point ${label.index} lines up with the dot of point ${misread}, not its own.`,
			});
	}
	for (const name of readout.names) {
		const region = readout.regions[name.key];
		if (region && !contains(region, name.box))
			issues.push({
				code: "name-outside-quadrant",
				message: `The ${name.key} name leaves its quadrant.`,
			});
	}
	const clumps = quadrantDotClumps(
		readout.dots.toSorted((a, b) => a.index - b.index).map((dot) => dot.center),
	);
	readout.leaders.forEach((leader, at) => {
		const hit = (box: QuadrantBox) =>
			quadrantSegmentHitsBox(leader.from, leader.to, shrink(box, 0.5));
		for (const text of texts)
			if (text.id !== `quadrant:label:${leader.index}` && hit(text.box))
				issues.push({
					code: "leader-crossing",
					message: `The leader of point ${leader.index} crosses ${text.id}.`,
				});
		for (const dot of readout.dots)
			if (clumps[dot.index] !== clumps[leader.index] && hit(dot.box))
				issues.push({
					code: "leader-over-dot",
					message: `The leader of point ${leader.index} passes over the dot of point ${dot.index}.`,
				});
		for (const other of readout.leaders.slice(at + 1))
			if (quadrantSegmentsCross(leader.from, leader.to, other.from, other.to))
				issues.push({
					code: "leader-crossing",
					message: `The leaders of points ${leader.index} and ${other.index} cross.`,
				});
	});
	// Each divider and axis is one whole line: the dividers across the plot, the axes along it.
	const middle = { x: (plot.left + plot.right) / 2, y: (plot.top + plot.bottom) / 2 };
	const spans: Readonly<Record<string, (from: ScenePoint, to: ScenePoint) => boolean>> = {
		"quadrant:midline:vertical": (from, to) =>
			near(from.x, middle.x) && near(to.x, middle.x) && covers(from.y, to.y, plot.top, plot.bottom),
		"quadrant:midline:horizontal": (from, to) =>
			near(from.y, middle.y) && near(to.y, middle.y) && covers(from.x, to.x, plot.left, plot.right),
		"quadrant:axis:x": (from, to) => covers(from.x, to.x, plot.left, plot.right),
		"quadrant:axis:y": (from, to) => covers(from.y, to.y, plot.top, plot.bottom),
	};
	for (const [id, whole] of Object.entries(spans)) {
		const pieces = readout.rules.filter((rule) => rule.id === id || rule.id.startsWith(`${id}:`));
		if (pieces.length !== 1 || !whole(pieces[0]!.from, pieces[0]!.to))
			issues.push({
				code: "broken-divider",
				message: `${id} is drawn in ${pieces.length} piece${pieces.length === 1 ? "" : "s"}, not one whole line.`,
			});
	}
	for (const rule of readout.rules)
		for (const text of texts)
			if (quadrantSegmentHitsBox(rule.from, rule.to, shrink(text.box, 0.5)))
				issues.push({ code: "rule-crosses-text", message: `${rule.id} crosses ${text.id}.` });
	const aspect = Math.max(scene.width, scene.height) / Math.min(scene.width, scene.height);
	if (aspect > QUADRANT_MAX_ASPECT)
		issues.push({ code: "wide-aspect", message: `The chart reads ${aspect.toFixed(2)} to 1.` });
	return issues;
}
