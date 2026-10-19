import {
	estimateTextWidth,
	segmentCrossesBoundsInterior,
	segmentsFromPoints,
} from "@sketchi/diagram-core";

import type { ArrowSceneElement, NodeSceneElement, RenderedDiagramScene } from "./scene.js";

export interface OrgChartLayoutIssue {
	readonly code:
		| "cards-overlap"
		| "line-through-card"
		| "lines-cross"
		| "line-not-orthogonal"
		| "line-off-card"
		| "text-outside-card"
		| "label-over-card";
	readonly elementId: string;
	readonly message: string;
}

/** Cards closer than this read as touching. */
const CARD_GAP = 6;

const isCard = (element: RenderedDiagramScene["elements"][number]): element is NodeSceneElement =>
	element.type === "node" && (element.kind === "person" || element.kind === "assistant");

/** Whether a point lies on a box's outline. */
function onOutline(point: { x: number; y: number }, box: NodeSceneElement): boolean {
	const within = (value: number, low: number, high: number) =>
		value >= low - 0.5 && value <= high + 0.5;
	const near = (value: number, edge: number) => Math.abs(value - edge) <= 0.5;
	return (
		((near(point.x, box.x) || near(point.x, box.x + box.width)) &&
			within(point.y, box.y, box.y + box.height)) ||
		((near(point.y, box.y) || near(point.y, box.y + box.height)) &&
			within(point.x, box.x, box.x + box.width))
	);
}

/**
 * How an org chart's drawing reads: cards apart, every line orthogonal from
 * the outline of one card to another's and through none, no two reporting
 * lines crossing (a line may leave another where they part, as a bus does),
 * every name and title inside its card, and no dotted line's label over a card.
 */
export function orgChartLayoutIssues(scene: RenderedDiagramScene): OrgChartLayoutIssue[] {
	const issues: OrgChartLayoutIssue[] = [];
	const cards = scene.elements.filter(isCard);
	const byNode = new Map(cards.map((card) => [card.nodeId, card]));
	for (const [index, card] of cards.entries())
		for (const other of cards.slice(index + 1))
			if (
				card.x < other.x + other.width + CARD_GAP &&
				other.x < card.x + card.width + CARD_GAP &&
				card.y < other.y + other.height + CARD_GAP &&
				other.y < card.y + card.height + CARD_GAP
			)
				issues.push({
					code: "cards-overlap",
					elementId: card.id,
					message: `Cards "${card.nodeId}" and "${other.nodeId}" touch.`,
				});
	const arrows = scene.elements.filter(
		(element): element is ArrowSceneElement => element.type === "arrow",
	);
	for (const arrow of arrows) {
		const points = arrow.points;
		const orthogonal = points
			.slice(1)
			.every(
				(point, index) =>
					Math.abs(point.x - points[index]!.x) < 0.01 ||
					Math.abs(point.y - points[index]!.y) < 0.01,
			);
		if (!orthogonal)
			issues.push({
				code: "line-not-orthogonal",
				elementId: arrow.id,
				message: `Line "${arrow.id}" runs diagonally.`,
			});
		const source = byNode.get(arrow.sourceNodeId);
		const target = byNode.get(arrow.targetNodeId);
		if (!source || !target || !onOutline(points[0], source) || !onOutline(points.at(-1)!, target))
			issues.push({
				code: "line-off-card",
				elementId: arrow.id,
				message: `Line "${arrow.id}" does not run from one card's outline to another's.`,
			});
		for (const segment of segmentsFromPoints(points))
			for (const card of cards)
				if (
					segmentCrossesBoundsInterior(segment, {
						x: card.x,
						y: card.y,
						width: card.width,
						height: card.height,
					})
				)
					issues.push({
						code: "line-through-card",
						elementId: arrow.id,
						message: `Line "${arrow.id}" passes through card "${card.nodeId}".`,
					});
	}
	// Reporting lines cross only where one passes through the inside of another's run.
	const solid = arrows
		.filter((arrow) => !arrow.edgeId.startsWith("dotted:"))
		.flatMap((arrow) => segmentsFromPoints(arrow.points).map((segment) => ({ arrow, segment })));
	for (const [index, left] of solid.entries())
		for (const right of solid.slice(index + 1)) {
			if (left.arrow === right.arrow) continue;
			if (left.segment.orientation === right.segment.orientation) continue;
			const [across, along] =
				left.segment.orientation === "horizontal" ? [left, right] : [right, left];
			const x = along.segment.staticCoordinate;
			const y = across.segment.staticCoordinate;
			if (
				x > across.segment.min + 0.5 &&
				x < across.segment.max - 0.5 &&
				y > along.segment.min + 0.5 &&
				y < along.segment.max - 0.5
			)
				issues.push({
					code: "lines-cross",
					elementId: left.arrow.id,
					message: `Lines "${left.arrow.id}" and "${right.arrow.id}" cross.`,
				});
		}
	for (const element of scene.elements) {
		if (element.type !== "text" || !element.id.startsWith("text:dotted:")) continue;
		const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
		const height =
			element.text.split("\n").length * element.fontSize * (element.lineHeight ?? 1.35);
		const covered = cards.find(
			(card) =>
				element.x - width / 2 < card.x + card.width &&
				card.x < element.x + width / 2 &&
				element.y - height / 2 < card.y + card.height &&
				card.y < element.y + height / 2,
		);
		if (covered)
			issues.push({
				code: "label-over-card",
				elementId: element.id,
				message: `Label "${element.id}" covers card "${covered.nodeId}".`,
			});
	}
	for (const element of scene.elements) {
		if (element.type !== "text" || element.containerId || !element.id.endsWith(":name")) continue;
		const card = byNode.get(element.id.slice("text:".length, -":name".length));
		if (!card) continue;
		const width = estimateTextWidth(element.text, element.fontSize);
		const height =
			element.text.split("\n").length * element.fontSize * (element.lineHeight ?? 1.35);
		if (
			element.x - width / 2 < card.x ||
			element.x + width / 2 > card.x + card.width ||
			element.y - height / 2 < card.y ||
			element.y + height / 2 > card.y + card.height
		)
			issues.push({
				code: "text-outside-card",
				elementId: element.id,
				message: `The name in card "${card.nodeId}" leaves the card.`,
			});
	}
	return issues;
}
