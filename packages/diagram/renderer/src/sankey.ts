import {
	CANVAS_SPEC_VERSION,
	SKETCHI_DIAGRAM_PALETTE,
	validateSankeyDiagram,
	wrapTextToWidth,
	estimateTextWidth,
	type SankeyDiagram,
} from "@sketchi/diagram-core";

import { formatValue, unitParts } from "./chart-scale.js";
import {
	layoutSankeyDiagram,
	polygonBounds,
	SANKEY_LINE_HEIGHT,
	type SankeyBox,
	type SankeyLayout,
	type SankeyText,
} from "./sankey-layout.js";
import type {
	LineSceneElement,
	NodeSceneElement,
	RenderedDiagramScene,
	SceneElement,
	TextSceneElement,
} from "./scene.js";

export const SANKEY_MARK_ROLE = "sankey-mark";

/** A Sankey mark keeps its role only while it still reads as one: an unlabeled shape on its Sankey id. */
export function isStructurallyValidSankeyMark(element: {
	readonly id: string;
	readonly nodeId: string;
	readonly icon?: unknown;
}): boolean {
	return (
		element.nodeId.startsWith("sankey:") &&
		element.id === `node:${element.nodeId}` &&
		element.icon === undefined
	);
}

const PADDING = 40;
const TITLE_FONT = 20;
const TITLE_GAP = 20;
const INK = SKETCHI_DIAGRAM_PALETTE.ink;
const LEADER_INK = "#4c4639";
/** Bands are translucent so overlaps read and the bars stay the strongest marks. */
const BAND_OPACITY = 45;
/** Paper behind a middle label lets its bands show faintly through, so they still leave the bar. */
const KNOCKOUT_OPACITY = 75;

/** Scene ids of a node's bar and label and of a flow's band and value. */
export const sankeyNodeId = (id: string) => `sankey:node:${id}`;
export const sankeyLinkId = (source: string, target: string) => `sankey:link:${source}:${target}`;

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function textElement(id: string, text: SankeyText, groupIds: string[]): TextSceneElement {
	const { box } = text;
	return {
		type: "text",
		id,
		x: round((box.left + box.right) / 2),
		y: round((box.top + box.bottom) / 2),
		text: text.text,
		fontSize: text.fontSize,
		lineHeight: SANKEY_LINE_HEIGHT,
		maxWidth: text.width,
		textAlign: text.align,
		textColor: INK,
		groupIds,
	};
}

/** Draw a laid-out Sankey diagram: bands behind, bars over them, then every label. */
export function sankeySceneFromLayout(
	diagram: SankeyDiagram,
	layout: SankeyLayout,
): RenderedDiagramScene {
	const labelOf = new Map(diagram.nodes.map((node) => [node.id, node.label]));
	const flowParts = unitParts(diagram.unit);
	const back: SceneElement[] = [];
	const middle: SceneElement[] = [];
	const front: SceneElement[] = [];
	for (const band of layout.bands) {
		const nodeId = sankeyLinkId(band.source, band.target);
		const bounds = polygonBounds(band.points);
		const relative = band.points.map((point) => ({
			x: round(point.x - bounds.left),
			y: round(point.y - bounds.top),
		}));
		back.push({
			type: "node",
			id: `node:${nodeId}`,
			nodeId,
			rendererRole: SANKEY_MARK_ROLE,
			shape: "polygon",
			points: [relative[0]!, relative[1]!, relative[2]!, ...relative.slice(3)],
			x: round(bounds.left),
			y: round(bounds.top),
			width: round(Math.max(bounds.right - bounds.left, 0.5)),
			height: round(Math.max(bounds.bottom - bounds.top, 0.5)),
			label: `${labelOf.get(band.source)} → ${labelOf.get(band.target)}: ${formatValue(band.value, flowParts)}`,
			fillColor: band.color,
			fillStyle: "solid",
			strokeColor: band.color,
			strokeWidth: 1,
			roughness: 0,
			opacity: BAND_OPACITY,
			groupIds: [nodeId],
		} satisfies NodeSceneElement);
		if (band.leader)
			middle.push({
				type: "line",
				id: `leader:${nodeId}`,
				points: [
					{ x: band.leader[0].x, y: band.leader[0].y },
					{ x: band.leader[1].x, y: band.leader[1].y },
				],
				strokeColor: LEADER_INK,
				strokeWidth: 1,
				roughness: 0,
				groupIds: [nodeId],
			} satisfies LineSceneElement);
		front.push(textElement(`text:${nodeId}`, band.text, [nodeId]));
	}
	for (const node of layout.nodes) {
		const nodeId = sankeyNodeId(node.id);
		if (node.knockout) {
			// Paper behind a middle column's label, so its own bands' edges fade under the text.
			const knockoutId = `sankey:knockout:${node.id}`;
			middle.push({
				type: "node",
				id: `node:${knockoutId}`,
				nodeId: knockoutId,
				rendererRole: SANKEY_MARK_ROLE,
				shape: "rectangle",
				x: round(node.knockout.left),
				y: round(node.knockout.top),
				width: round(node.knockout.right - node.knockout.left),
				height: round(node.knockout.bottom - node.knockout.top),
				label: "",
				fillColor: diagram.style.backgroundColor,
				fillStyle: "solid",
				strokeColor: diagram.style.backgroundColor,
				strokeWidth: 1,
				roughness: 0,
				opacity: KNOCKOUT_OPACITY,
				groupIds: [nodeId],
			} satisfies NodeSceneElement);
		}
		middle.push({
			type: "node",
			id: `node:${nodeId}`,
			nodeId,
			rendererRole: SANKEY_MARK_ROLE,
			shape: "rectangle",
			x: node.x,
			y: node.y,
			width: node.width,
			height: node.height,
			label: node.label,
			fillColor: node.color,
			fillStyle: "solid",
			strokeColor: node.color,
			strokeWidth: 1,
			roughness: 0,
			groupIds: [nodeId],
		} satisfies NodeSceneElement);
		front.push(textElement(`text:${nodeId}`, node.text, [nodeId]));
	}
	const boxes: SankeyBox[] = [
		...layout.nodes.flatMap((node) => [
			{ left: node.x, top: node.y, right: node.x + node.width, bottom: node.y + node.height },
			node.text.box,
			...(node.knockout ? [node.knockout] : []),
		]),
		...layout.bands.flatMap((band) => [polygonBounds(band.points), band.text.box]),
		...layout.bands.flatMap((band) => (band.leader ? [polygonBounds(band.leader)] : [])),
	];
	const content = {
		left: Math.min(...boxes.map((box) => box.left)),
		top: Math.min(...boxes.map((box) => box.top)),
		right: Math.max(...boxes.map((box) => box.right)),
		bottom: Math.max(...boxes.map((box) => box.bottom)),
	};
	const titleText = wrapTextToWidth(
		diagram.title,
		Math.max(content.right - content.left, 360),
		TITLE_FONT,
	);
	const titleLines = titleText.split("\n");
	const titleWidth = Math.ceil(
		Math.max(...titleLines.map((line) => estimateTextWidth(line, TITLE_FONT))),
	);
	const titleHeight = Math.ceil(titleLines.length * TITLE_FONT * SANKEY_LINE_HEIGHT);
	const titleTop = content.top - TITLE_GAP - titleHeight;
	front.push(
		textElement(
			"sankey:title",
			{
				text: titleText,
				fontSize: TITLE_FONT,
				width: titleWidth,
				height: titleHeight,
				align: "left",
				box: {
					left: content.left,
					top: titleTop,
					right: content.left + titleWidth,
					bottom: content.top - TITLE_GAP,
				},
			},
			[],
		),
	);
	const left = content.left;
	const right = Math.max(content.right, content.left + titleWidth);
	const dx = PADDING - left;
	const dy = PADDING - titleTop;
	const elements = [...back, ...middle, ...front].map((element): SceneElement => {
		if (element.type === "node" || element.type === "text")
			return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
		if (element.type === "line") {
			const [first, second, ...rest] = element.points.map((point) => ({
				x: round(point.x + dx),
				y: round(point.y + dy),
			}));
			return { ...element, points: [first!, second!, ...rest] };
		}
		return element;
	});
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: diagram.id,
		title: diagram.title,
		width: Math.ceil(right - left + PADDING * 2),
		height: Math.ceil(content.bottom - titleTop + PADDING * 2),
		accentColor: diagram.style.accentColor,
		backgroundColor: diagram.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
	};
}

export function renderSankeyDiagram(input: SankeyDiagram): RenderedDiagramScene {
	const diagram = validateSankeyDiagram(input);
	return sankeySceneFromLayout(diagram, layoutSankeyDiagram(diagram));
}
