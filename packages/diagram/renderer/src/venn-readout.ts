import { estimateTextWidth } from "@sketchi/diagram-core";

import type { RenderedDiagramScene, SceneElement, TextSceneElement } from "./scene.js";
import {
	insideClearance,
	outsideClearance,
	VENN_LINE_HEIGHT,
	type VennBox,
	type VennCircle,
} from "./venn-layout.js";

export interface VennSetReadout {
	readonly index: number;
	readonly label: string;
	readonly circle: VennCircle;
	readonly fillOpacity?: number;
}

export interface VennRegionReadout {
	/** Set indexes, ascending. */
	readonly key: readonly number[];
	readonly label?: string;
	readonly count?: string;
	/** Each item's text, wrapped lines joined by spaces. */
	readonly items: readonly string[];
}

export interface VennReadout {
	readonly sets: readonly VennSetReadout[];
	readonly regions: readonly VennRegionReadout[];
}

const isText = (element: SceneElement): element is TextSceneElement => element.type === "text";
const unwrap = (text: string) => text.split("\n").join(" ");

/** Read a rendered Venn diagram back from its scene: circles, set labels and region texts. */
export function readVennScene(scene: RenderedDiagramScene): VennReadout {
	const texts = new Map(scene.elements.filter(isText).map((element) => [element.id, element]));
	const sets = scene.elements.flatMap((element): VennSetReadout[] => {
		const match = element.type === "node" ? /^venn:set:(\d+)$/u.exec(element.nodeId) : null;
		if (element.type !== "node" || !match) return [];
		const index = Number(match[1]);
		const fill = scene.elements.find(
			(candidate) => candidate.type === "node" && candidate.nodeId === `venn:set:${index}:fill`,
		);
		return [
			{
				index,
				label: unwrap(texts.get(`venn:set:${index}:label`)?.text ?? ""),
				circle: {
					x: element.x + element.width / 2,
					y: element.y + element.height / 2,
					r: element.width / 2,
				},
				...(fill?.opacity === undefined ? {} : { fillOpacity: fill.opacity }),
			},
		];
	});
	const regions = new Map<
		string,
		{ key: number[]; label?: string; count?: string; items: [number, string][] }
	>();
	for (const element of texts.values()) {
		const match = /^venn:region:([\d+]+):(label|count|item:(\d+))$/u.exec(element.id);
		if (!match) continue;
		const region = regions.get(match[1]!) ?? {
			key: match[1]!.split("+").map(Number),
			items: [],
		};
		if (match[2] === "label") region.label = unwrap(element.text);
		else if (match[2] === "count") region.count = element.text;
		else region.items.push([Number(match[3]), unwrap(element.text)]);
		regions.set(match[1]!, region);
	}
	return {
		sets: sets.sort((a, b) => a.index - b.index),
		regions: [...regions.values()].map(({ items, ...region }) => ({
			...region,
			items: items.sort((a, b) => a[0] - b[0]).map(([, text]) => text),
		})),
	};
}

export interface VennLayoutIssue {
	readonly code:
		| "text-outside-region"
		| "text-overlap"
		| "set-label-on-circle"
		| "circle-missing"
		| "opaque-fill";
	readonly elementId: string;
	readonly message: string;
}

/** A line of text closer than this to an outline reads as touching it. */
const MIN_CLEARANCE = 4;

/** The box each line of a text element paints, centred as the renderer centres it. */
export function vennTextLineBoxes(element: TextSceneElement): VennBox[] {
	const lines = element.text.split("\n");
	const height = element.fontSize * (element.lineHeight ?? VENN_LINE_HEIGHT);
	const top = element.y - (lines.length * height) / 2;
	return lines.map((line, index) => {
		const width = Math.ceil(estimateTextWidth(line, element.fontSize));
		return {
			left: element.x - width / 2,
			right: element.x + width / 2,
			top: top + index * height,
			bottom: top + (index + 1) * height,
		};
	});
}

function boxesOverlap(a: VennBox, b: VennBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * How a Venn diagram reads: every region's text inside each of its sets and
 * outside every other, clear of each outline; no two texts overlapping; every
 * set label outside every circle; and fills translucent so overlaps show.
 */
export function vennLayoutIssues(scene: RenderedDiagramScene): VennLayoutIssue[] {
	const issues: VennLayoutIssue[] = [];
	const { sets } = readVennScene(scene);
	const circles = sets.map((set) => set.circle);
	if (sets.length < 2)
		issues.push({
			code: "circle-missing",
			elementId: scene.diagramId,
			message: "Fewer than two set circles are drawn.",
		});
	for (const set of sets)
		if (set.fillOpacity === undefined || set.fillOpacity >= 60)
			issues.push({
				code: "opaque-fill",
				elementId: `node:venn:set:${set.index}:fill`,
				message: `Set ${set.index + 1}'s fill is not translucent, so its overlaps do not show.`,
			});
	const texts = scene.elements.filter(isText);
	const boxes = texts.map((element) => ({ element, boxes: vennTextLineBoxes(element) }));
	for (const { element, boxes: lines } of boxes) {
		const region = /^venn:region:([\d+]+):/u.exec(element.id);
		if (region) {
			const key = region[1]!.split("+").map(Number);
			for (const line of lines) {
				const clearance = Math.min(
					...circles.map((circle, index) =>
						key.includes(index) ? insideClearance(line, circle) : outsideClearance(line, circle),
					),
				);
				if (clearance < MIN_CLEARANCE) {
					issues.push({
						code: "text-outside-region",
						elementId: element.id,
						message: `"${element.text}" comes within ${clearance.toFixed(1)} px of an outline it must stay inside or outside of.`,
					});
					break;
				}
			}
		} else if (/^venn:set:\d+:label$/u.test(element.id)) {
			for (const line of lines)
				if (circles.some((circle) => outsideClearance(line, circle) < MIN_CLEARANCE)) {
					issues.push({
						code: "set-label-on-circle",
						elementId: element.id,
						message: `Set label "${element.text}" touches or sits inside a circle.`,
					});
					break;
				}
		}
	}
	for (const [index, first] of boxes.entries())
		for (const second of boxes.slice(index + 1))
			if (first.boxes.some((a) => second.boxes.some((b) => boxesOverlap(a, b))))
				issues.push({
					code: "text-overlap",
					elementId: first.element.id,
					message: `"${first.element.text}" overlaps "${second.element.text}".`,
				});
	return issues;
}
