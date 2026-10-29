import { estimateTextWidth } from "@sketchi/diagram-core";

import {
	polygonBounds,
	SANKEY_LINE_HEIGHT,
	sankeyBoxesOverlap,
	sankeyBoxMeetsPolygon,
	segmentMeetsBox,
	type SankeyBox,
} from "./sankey-layout.js";
import type { NodeSceneElement, RenderedDiagramScene, TextSceneElement } from "./scene.js";

type Point = { readonly x: number; readonly y: number };

export interface SankeyReadNode {
	readonly id: string;
	readonly box: SankeyBox;
	/** The node's label text, as drawn. */
	readonly text?: string;
	readonly textBox?: SankeyBox;
}

export interface SankeyReadBand {
	readonly source: string;
	readonly target: string;
	readonly points: readonly Point[];
	readonly bounds: SankeyBox;
	/** Where the band leaves its source and enters its target: the x of that end and its span. */
	readonly sourceEnd: { readonly x: number; readonly top: number; readonly bottom: number };
	readonly targetEnd: { readonly x: number; readonly top: number; readonly bottom: number };
	/** Drawn thickness at its ends. */
	readonly width: number;
	readonly text?: string;
	readonly textBox?: SankeyBox;
	/** The leader from the band to its value, when the value sits away from it. */
	readonly leader?: readonly [Point, Point];
}

export interface SankeyReadout {
	readonly nodes: readonly SankeyReadNode[];
	readonly bands: readonly SankeyReadBand[];
	readonly texts: readonly {
		readonly id: string;
		readonly text: string;
		readonly box: SankeyBox;
		readonly maxWidth: number;
		readonly fontSize: number;
	}[];
}

export interface SankeyLayoutIssue {
	readonly code:
		| "side-unbalanced"
		| "band-off-node"
		| "band-leaves-gap"
		| "band-over-node"
		| "labels-overlap"
		| "label-over-node"
		| "label-over-band"
		| "leader-over-label"
		| "text-overflow";
	readonly elementId: string;
	readonly message: string;
}

/** A text element's box: its center, stored width and line count. */
export function sankeyTextBox(element: TextSceneElement): SankeyBox {
	const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
	const height =
		element.text.split("\n").length * element.fontSize * (element.lineHeight ?? SANKEY_LINE_HEIGHT);
	return {
		left: element.x - width / 2,
		top: element.y - height / 2,
		right: element.x + width / 2,
		bottom: element.y + height / 2,
	};
}

/** The span of a band's outline at its leftmost or rightmost x. */
function endAt(points: readonly Point[], side: "left" | "right") {
	const x =
		side === "left"
			? Math.min(...points.map((point) => point.x))
			: Math.max(...points.map((point) => point.x));
	const ys = points.filter((point) => Math.abs(point.x - x) < 0.01).map((point) => point.y);
	return { x, top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Read a rendered Sankey diagram's bars, bands and labels back from its scene. */
export function readSankeyScene(scene: RenderedDiagramScene): SankeyReadout {
	const texts = new Map(
		scene.elements.flatMap((element) =>
			element.type === "text" ? [[element.id, element] as const] : [],
		),
	);
	const shapes = scene.elements.filter(
		(element): element is NodeSceneElement => element.type === "node",
	);
	const leaders = new Map(
		scene.elements.flatMap((element) =>
			element.type === "line" ? [[element.id, element] as const] : [],
		),
	);
	const nodes = shapes.flatMap((element): SankeyReadNode[] => {
		const match = /^sankey:node:([^:]+)$/u.exec(element.nodeId);
		if (!match || element.shape !== "rectangle") return [];
		const text = texts.get(`text:${element.nodeId}`);
		return [
			{
				id: match[1]!,
				box: {
					left: element.x,
					top: element.y,
					right: element.x + element.width,
					bottom: element.y + element.height,
				},
				...(text ? { text: text.text, textBox: sankeyTextBox(text) } : {}),
			},
		];
	});
	const bands = shapes.flatMap((element): SankeyReadBand[] => {
		const match = /^sankey:link:([^:]+):([^:]+)$/u.exec(element.nodeId);
		if (!match || element.shape !== "polygon" || !element.points) return [];
		const points = element.points.map((point) => ({
			x: element.x + point.x,
			y: element.y + point.y,
		}));
		const sourceEnd = endAt(points, "left");
		const targetEnd = endAt(points, "right");
		const text = texts.get(`text:${element.nodeId}`);
		const leader = leaders.get(`leader:${element.nodeId}`);
		return [
			{
				...(leader ? { leader: [leader.points[0], leader.points.at(-1)!] as const } : {}),
				source: match[1]!,
				target: match[2]!,
				points,
				bounds: polygonBounds(points),
				sourceEnd,
				targetEnd,
				width: Math.round((sourceEnd.bottom - sourceEnd.top) * 100) / 100,
				...(text ? { text: text.text, textBox: sankeyTextBox(text) } : {}),
			},
		];
	});
	return {
		nodes,
		bands,
		texts: [...texts.values()].map((element) => ({
			id: element.id,
			text: element.text,
			box: sankeyTextBox(element),
			maxWidth: element.maxWidth ?? estimateTextWidth(element.text, element.fontSize),
			fontSize: element.fontSize,
		})),
	};
}

/** The y of a band's top edge where it crosses `x`, read off its outline's first half. */
function topAt(band: SankeyReadBand, x: number): number {
	const half = band.points.slice(0, Math.ceil(band.points.length / 2));
	for (let index = 1; index < half.length; index += 1) {
		const a = half[index - 1]!;
		const b = half[index]!;
		if (x >= a.x - 0.01 && x <= b.x + 0.01)
			return b.x - a.x < 0.01 ? Math.min(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
	}
	return half.at(-1)!.y;
}

/** Two bands that cross in one gap between adjacent columns. */
export interface SankeyCrossingPair {
	readonly gap: number;
	readonly a: SankeyReadBand;
	readonly b: SankeyReadBand;
}

/**
 * Pairs of bands that cross between each pair of adjacent columns: their
 * order at one side of the gap is the reverse of their order at the other.
 * Bands leaving one bar or entering one bar never count, since they stack.
 * A long band counts in each gap it crosses.
 */
export function sankeyCrossingPairs(scene: RenderedDiagramScene): SankeyCrossingPair[] {
	const { nodes, bands } = readSankeyScene(scene);
	const lefts = [...new Set(nodes.map((node) => Math.round(node.box.left * 100) / 100))].toSorted(
		(a, b) => a - b,
	);
	const width = nodes[0] ? nodes[0].box.right - nodes[0].box.left : 0;
	const columnOf = (x: number) => lefts.findIndex((left) => Math.abs(left - x) < 0.6);
	const pairs: SankeyCrossingPair[] = [];
	for (let gap = 0; gap + 1 < lefts.length; gap += 1) {
		const x0 = lefts[gap]! + width;
		const x1 = lefts[gap + 1]!;
		const spans = bands.flatMap((band) => {
			const first = columnOf(band.sourceEnd.x - width);
			const last = columnOf(band.targetEnd.x);
			if (first < 0 || last < 0 || first > gap || last <= gap) return [];
			return [
				{
					band,
					from: first === gap ? band.source : `~${band.source}:${band.target}`,
					to: last === gap + 1 ? band.target : `~${band.source}:${band.target}`,
					y0: topAt(band, x0),
					y1: topAt(band, x1),
				},
			];
		});
		for (let i = 0; i < spans.length; i += 1)
			for (let j = i + 1; j < spans.length; j += 1) {
				const a = spans[i]!;
				const b = spans[j]!;
				if (a.from === b.from || a.to === b.to) continue;
				if ((a.y0 - b.y0) * (a.y1 - b.y1) < 0) pairs.push({ gap, a: a.band, b: b.band });
			}
	}
	return pairs;
}

/** How many pairs of bands cross, gap by gap. */
export function sankeyCrossings(scene: RenderedDiagramScene): number {
	return sankeyCrossingPairs(scene).length;
}

/**
 * How much crossing a reader sees: the sum over crossing pairs of the
 * product of their weights, by default their drawn widths. Pass each band's
 * value to compare drawings at different scales.
 */
export function sankeyWeightedCrossings(
	scene: RenderedDiagramScene,
	weight: (band: SankeyReadBand) => number = (band) => band.width,
): number {
	return sankeyCrossingPairs(scene).reduce((sum, pair) => sum + weight(pair.a) * weight(pair.b), 0);
}

/**
 * How a Sankey drawing reads: at each bar the bands of each side stack inside
 * it without overlapping and the fuller side fills it; every band runs from
 * its source's right edge to its target's left edge over no other bar; text
 * fits its box, and no label overlaps another label, a bar, or a band other
 * than its own (a node's label may ride the leads of its own bands out).
 */
export function sankeyLayoutIssues(scene: RenderedDiagramScene): SankeyLayoutIssue[] {
	const issues: SankeyLayoutIssue[] = [];
	const { nodes, bands, texts } = readSankeyScene(scene);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	for (const node of nodes) {
		const sides = {
			out: bands.filter((band) => band.source === node.id).map((band) => band.sourceEnd),
			in: bands.filter((band) => band.target === node.id).map((band) => band.targetEnd),
		};
		const sums = { out: 0, in: 0 };
		for (const side of ["out", "in"] as const) {
			const edge = side === "out" ? node.box.right : node.box.left;
			let bottom = -Infinity;
			for (const end of sides[side].toSorted((a, b) => a.top - b.top)) {
				if (
					Math.abs(end.x - edge) > 0.6 ||
					end.top < node.box.top - 0.6 ||
					end.bottom > node.box.bottom + 0.6 ||
					end.top < bottom - 0.6
				)
					issues.push({
						code: "band-off-node",
						elementId: `node:sankey:node:${node.id}`,
						message: `A band at the ${side === "out" ? "right" : "left"} of "${node.id}" leaves its bar or overlaps another band.`,
					});
				bottom = end.bottom;
				sums[side] += end.bottom - end.top;
			}
		}
		const height = node.box.bottom - node.box.top;
		if (
			Math.abs(Math.max(sums.in, sums.out) - height) > 0.6 ||
			Math.min(sums.in, sums.out) > height + 0.6
		)
			issues.push({
				code: "side-unbalanced",
				elementId: `node:sankey:node:${node.id}`,
				message: `The bands at "${node.id}" sum to ${sums.in.toFixed(2)} in and ${sums.out.toFixed(2)} out on a bar ${height.toFixed(2)} tall.`,
			});
	}
	for (const band of bands) {
		const id = `node:sankey:link:${band.source}:${band.target}`;
		const source = byId.get(band.source);
		const target = byId.get(band.target);
		if (
			!source ||
			!target ||
			band.bounds.left < source.box.right - 0.6 ||
			band.bounds.right > target.box.left + 0.6
		)
			issues.push({
				code: "band-leaves-gap",
				elementId: id,
				message: `Band "${band.source}" → "${band.target}" runs outside the gap between its bars.`,
			});
		if (band.leader) {
			const crossed = [
				...nodes.map((node) => ({ id: `node:sankey:node:${node.id}`, box: node.box })),
				...texts.filter((text) => text.id !== `text:sankey:link:${band.source}:${band.target}`),
			].find((entry) => segmentMeetsBox(band.leader![0], band.leader![1], entry.box));
			if (crossed)
				issues.push({
					code: "leader-over-label",
					elementId: id,
					message: `The leader of "${band.source}" → "${band.target}" crosses "${crossed.id}".`,
				});
		}
		for (const node of nodes)
			if (
				node.id !== band.source &&
				node.id !== band.target &&
				sankeyBoxMeetsPolygon(node.box, band.points, band.bounds)
			)
				issues.push({
					code: "band-over-node",
					elementId: id,
					message: `Band "${band.source}" → "${band.target}" runs over "${node.id}".`,
				});
	}
	for (const [index, text] of texts.entries()) {
		const lines = text.text.split("\n");
		if (lines.some((line) => estimateTextWidth(line, text.fontSize) > text.maxWidth + 0.5))
			issues.push({
				code: "text-overflow",
				elementId: text.id,
				message: `Text "${text.id}" is wider than its box.`,
			});
		for (const other of texts.slice(index + 1))
			if (sankeyBoxesOverlap(text.box, other.box))
				issues.push({
					code: "labels-overlap",
					elementId: text.id,
					message: `Labels "${text.id}" and "${other.id}" overlap.`,
				});
		for (const node of nodes)
			if (sankeyBoxesOverlap(text.box, node.box))
				issues.push({
					code: "label-over-node",
					elementId: text.id,
					message: `Label "${text.id}" covers bar "${node.id}".`,
				});
		const owner = /^text:sankey:(node|link):([^:]+)(?::([^:]+))?$/u.exec(text.id);
		for (const band of bands) {
			const own =
				owner?.[1] === "link"
					? owner[2] === band.source && owner[3] === band.target
					: owner?.[1] === "node" && owner[2] === band.source;
			if (!own && sankeyBoxMeetsPolygon(text.box, band.points, band.bounds))
				issues.push({
					code: "label-over-band",
					elementId: text.id,
					message: `Label "${text.id}" covers band "${band.source}" → "${band.target}".`,
				});
		}
	}
	return issues;
}
