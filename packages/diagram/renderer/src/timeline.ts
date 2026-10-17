import {
	CANVAS_SPEC_VERSION,
	orderedTimelineEvents,
	validateTimelineDiagram,
	wrapTextToWidth,
	type TimelineDiagram,
} from "@sketchi/diagram-core";
import type { RenderedDiagramScene, SceneElement } from "./scene.js";

const PADDING = 48;
const EVENT_WIDTH = 260;
const GAP = 64;
const FONT_SIZE = 16;
const DATE_FONT_SIZE = 13;
const LINE_HEIGHT = 1.4;
const MARKER_SIZE = 48;
const AXIS_Y = 44;
const LABEL_TOP = 78;

/** Dated points on a chronological spine, wrapped into alternating rows. */
export function renderTimelineDiagram(diagram: TimelineDiagram): RenderedDiagramScene {
	const input = validateTimelineDiagram(diagram);
	const events = orderedTimelineEvents(input);
	const columns = events.length <= 4 ? events.length : Math.ceil(Math.sqrt(events.length));
	const labels = events.map((event) =>
		wrapTextToWidth(
			[event.label, ...(event.description ? [event.description] : [])].join("\n"),
			EVENT_WIDTH - 16,
			FONT_SIZE,
		),
	);
	const dates = events.map((event) =>
		wrapTextToWidth(event.date ?? `Order ${event.order}`, EVENT_WIDTH - 16, DATE_FONT_SIZE),
	);
	const labelHeights = labels.map((text) =>
		Math.ceil(text.split("\n").length * FONT_SIZE * LINE_HEIGHT),
	);
	const rows = Math.ceil(events.length / columns);
	const rowHeights = Array.from(
		{ length: rows },
		(_, row) => LABEL_TOP + Math.max(...labelHeights.slice(row * columns, (row + 1) * columns)),
	);
	const rowY: number[] = [];
	let y = PADDING;
	for (const height of rowHeights) {
		rowY.push(y);
		y += height + GAP;
	}
	const positions = events.map((_, index) => {
		const row = Math.floor(index / columns);
		const column = row % 2 === 0 ? index % columns : columns - 1 - (index % columns);
		return {
			x: PADDING + column * (EVENT_WIDTH + GAP) + EVENT_WIDTH / 2,
			y: rowY[row] ?? PADDING,
			row,
		};
	});
	const elements: SceneElement[] = [];
	events.forEach((event, index) => {
		const position = positions[index]!;
		const nodeId = `event:${event.id}`;
		elements.push({
			type: "node",
			id: `node:${nodeId}`,
			nodeId,
			shape: "circle",
			x: position.x - MARKER_SIZE / 2,
			y: position.y + AXIS_Y - MARKER_SIZE / 2,
			width: MARKER_SIZE,
			height: MARKER_SIZE,
			label: String(index + 1),
			fillColor: input.style.backgroundColor,
			strokeColor: input.style.accentColor,
		});
		elements.push({
			type: "text",
			id: `marker:${nodeId}`,
			containerId: `node:${nodeId}`,
			x: position.x,
			y: position.y + AXIS_Y,
			text: String(index + 1),
			fontSize: 12,
			maxWidth: MARKER_SIZE - 10,
		});
		elements.push({
			type: "text",
			id: `date:${nodeId}`,
			x: position.x,
			y: position.y + 8,
			text: dates[index]!,
			fontSize: DATE_FONT_SIZE,
			maxWidth: EVENT_WIDTH - 16,
		});
		elements.push({
			type: "text",
			id: `label:${nodeId}`,
			x: position.x,
			y: position.y + LABEL_TOP + labelHeights[index]! / 2,
			text: labels[index]!,
			fontSize: FONT_SIZE,
			maxWidth: EVENT_WIDTH - 16,
		});
		const next = positions[index + 1];
		const nextEvent = events[index + 1];
		if (!next || !nextEvent) return;
		const rightward = position.row % 2 === 0;
		const side = rightward ? 1 : -1;
		const start = { x: position.x + (side * MARKER_SIZE) / 2, y: position.y + AXIS_Y };
		const end = {
			x: next.x - ((position.row === next.row ? side : -side) * MARKER_SIZE) / 2,
			y: next.y + AXIS_Y,
		};
		// A row turn stays in the outer gutter, clear of dates and descriptions.
		const railX = position.x + side * (EVENT_WIDTH / 2 + GAP / 2);
		const points =
			position.row === next.row
				? [start, end]
				: [start, { x: railX, y: start.y }, { x: railX, y: end.y }, end];
		elements.push({
			type: "arrow",
			id: `arrow:next:${event.id}`,
			edgeId: `next:${event.id}`,
			sourceNodeId: nodeId,
			targetNodeId: `event:${nextEvent.id}`,
			points: [points[0]!, ...points.slice(1)],
		});
	});
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: input.id,
		title: input.title,
		width: PADDING * 2 + columns * EVENT_WIDTH + (columns - 1) * GAP,
		height: y - GAP + PADDING,
		accentColor: input.style.accentColor,
		backgroundColor: input.style.backgroundColor,
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
	};
}
