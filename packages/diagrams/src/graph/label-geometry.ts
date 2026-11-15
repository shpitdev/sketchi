/** Owns branch-label boxes and candidate positions along routed segments. */
import { type LabelBox, type Box, type RoutedEdge } from "./layout-types.js";
import {
	type CanvasPoint as ScenePoint,
	type CanvasShapeElement as NodeSceneElement,
	AXIS_ALIGNED_EPSILON,
	type AxisAlignedSegment,
	segmentCrossesBoundsInterior,
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasTextElement as TextSceneElement,
	segmentsFromPoints,
} from "@sketchi/drawing";
import { ARROWHEAD_LENGTH, ARROWHEAD_WING } from "./measure.js";
import { obstacleBox } from "./containers.js";
import { routeLength } from "./route-geometry.js";
import { endRunOf } from "./geometry.js";

/** Clearance a label box keeps from its own line, and the wider one from other lines. */
const LABEL_LINE_CLEARANCE = 3;

export const LABEL_OTHER_LINE_CLEARANCE = 8;

/** Room a label moved off an ambiguous spot keeps from everything, past the usual clearances. */
export const LABEL_MOVE_MARGIN = 6;

/** Route length from the source within which a label may slide to stay clear. */
const LABEL_SLIDE_LENGTH = 240;

const LABEL_SLIDE_STEP = 12;

export function labelBox(position: ScenePoint, size: { width: number; height: number }): LabelBox {
	return {
		x: position.x - size.width / 2,
		y: position.y - size.height / 2,
		width: size.width,
		height: size.height,
	};
}

/** The box point nearest a shape's center decides overlap with its true outline. */
function boxOverlapsShape(box: LabelBox, shape: NodeSceneElement): boolean {
	const [cx, cy] = [shape.x + shape.width / 2, shape.y + shape.height / 2];
	const dx = Math.max(box.x, Math.min(cx, box.x + box.width)) - cx;
	const dy = Math.max(box.y, Math.min(cy, box.y + box.height)) - cy;
	const [u, v] = [Math.abs(dx) / (shape.width / 2), Math.abs(dy) / (shape.height / 2)];
	if (shape.shape === "diamond") return u + v < 1;
	if (shape.shape === "ellipse" || shape.shape === "circle") return u * u + v * v < 1;
	return u < 1 && v < 1;
}

/** Whether a label box lies within a region. */
export function boxWithin(box: LabelBox, region: Box): boolean {
	return (
		box.x >= region.x - AXIS_ALIGNED_EPSILON &&
		box.y >= region.y - AXIS_ALIGNED_EPSILON &&
		box.x + box.width <= region.x + region.width + AXIS_ALIGNED_EPSILON &&
		box.y + box.height <= region.y + region.height + AXIS_ALIGNED_EPSILON
	);
}

export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function padBox(box: LabelBox, padding: number): LabelBox {
	return {
		x: box.x - padding,
		y: box.y - padding,
		width: box.width + 2 * padding,
		height: box.height + 2 * padding,
	};
}

/** Distance from a label box to an axis-aligned segment. */
export function boxSegmentDistance(box: LabelBox, segment: AxisAlignedSegment): number {
	const [x0, x1, y0, y1] =
		segment.orientation === "horizontal"
			? [segment.min, segment.max, segment.staticCoordinate, segment.staticCoordinate]
			: [segment.staticCoordinate, segment.staticCoordinate, segment.min, segment.max];
	return Math.hypot(
		Math.max(0, box.x - x1, x0 - box.x - box.width),
		Math.max(0, box.y - y1, y0 - box.y - box.height),
	);
}

/**
 * Lines, nodes and other labels a label box touches. Other edges keep a wider
 * berth, so a label never reads as belonging to the line beside it.
 */
export function labelConflicts(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
	nodes: readonly NodeSceneElement[],
	others: readonly LabelBox[],
): number {
	const near = padBox(box, LABEL_LINE_CLEARANCE);
	const far = padBox(box, LABEL_OTHER_LINE_CLEARANCE);
	return (
		own.filter((segment) => segmentCrossesBoundsInterior(segment, near)).length +
		segments.filter((segment) => segmentCrossesBoundsInterior(segment, far)).length +
		nodes.filter((node) => boxOverlapsShape(box, node)).length +
		others.filter((other) => boxesOverlap(near, other)).length
	);
}

/** The box an arrow's head is drawn in, wings and stroke included. */
export function arrowheadBox(arrow: ArrowSceneElement): NodeSceneElement | undefined {
	if (arrow.endArrowhead === null) return undefined;
	const [previous, tip] = [arrow.points.at(-2), arrow.points.at(-1)];
	if (!previous || !tip) return undefined;
	const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
	if (length <= 0) return undefined;
	const size = Math.min(ARROWHEAD_LENGTH, length / 2);
	const [back, across] = [size * Math.cos(ARROWHEAD_WING), size * Math.sin(ARROWHEAD_WING) + 1];
	const [ux, uy] = [(tip.x - previous.x) / length, (tip.y - previous.y) / length];
	const xs = [tip.x, tip.x - ux * back - uy * across, tip.x - ux * back + uy * across];
	const ys = [tip.y, tip.y - uy * back + ux * across, tip.y - uy * back - ux * across];
	return obstacleBox(`arrowhead:${arrow.id}`, {
		x: Math.min(...xs) - 1,
		y: Math.min(...ys) - 1,
		width: Math.max(...xs) - Math.min(...xs) + 2,
		height: Math.max(...ys) - Math.min(...ys) + 2,
	});
}

/** A label beside a straight line, pushed out across it past its own arrowhead's wing. */
export function clearOfHead(
	stub: ScenePoint,
	arrow: ArrowSceneElement,
	head: NodeSceneElement | undefined,
): ScenePoint[] {
	const [start, next] = arrow.points;
	if (!head || !next || arrow.points.length !== 2) return [];
	const reach = (Math.abs(start.x - next.x) <= AXIS_ALIGNED_EPSILON ? head.width : head.height) / 2;
	return Math.abs(start.x - next.x) <= AXIS_ALIGNED_EPSILON
		? [{ x: stub.x + Math.sign(stub.x - start.x) * (reach + LABEL_LINE_CLEARANCE), y: stub.y }]
		: [{ x: stub.x, y: stub.y + Math.sign(stub.y - start.y) * (reach + LABEL_LINE_CLEARANCE) }];
}

/** Distance from a label box to the nearest of some lines. */
export function nearestLine(box: LabelBox, lines: readonly AxisAlignedSegment[]): number {
	return Math.min(Infinity, ...lines.map((segment) => boxSegmentDistance(box, segment)));
}

/**
 * How much nearer a label box sits to another line than it may: a label reads
 * as its own line's only when every other line is further by the wider berth.
 */
export function labelShortfall(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
): number {
	return Math.max(
		0,
		nearestLine(box, own) + LABEL_OTHER_LINE_CLEARANCE - nearestLine(box, segments),
	);
}

/** Whether a label box sits no clearer of another line than of its own: it could belong to either. */
export function labelAmbiguous(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
	segments: readonly AxisAlignedSegment[],
): boolean {
	return labelShortfall(box, own, segments) > 0;
}

/**
 * Text beside a vertical run aligns toward it. Widths are estimated wide, so
 * centered text would paint further from its line than placement measured.
 */
export function labelAlign(
	box: LabelBox,
	own: readonly AxisAlignedSegment[],
): TextSceneElement["textAlign"] | undefined {
	const [nearest] = own.toSorted((a, b) => boxSegmentDistance(box, a) - boxSegmentDistance(box, b));
	if (!nearest || nearest.orientation !== "vertical") return undefined;
	if (nearest.max <= box.y || nearest.min >= box.y + box.height) return undefined;
	if (box.x >= nearest.staticCoordinate) return "left";
	if (box.x + box.width <= nearest.staticCoordinate) return "right";
	return undefined;
}

/**
 * Positions beside the final route, nearest the source first: each axis-aligned
 * run within `LABEL_SLIDE_LENGTH` of the source, on either side, as the stub
 * label sits beside its stub.
 */
export function labelSlidePositions(
	points: readonly ScenePoint[],
	size: { width: number; height: number },
	runs: { readonly start: number; readonly end: number } = { start: 0, end: 0 },
): ScenePoint[] {
	const positions: ScenePoint[] = [];
	const total = routeLength(points);
	let travelled = 0;
	for (const segment of segmentsFromPoints(points)) {
		if (travelled > LABEL_SLIDE_LENGTH) break;
		const start = points[segment.segmentIndex]!;
		const end = points[segment.segmentIndex + 1]!;
		const length = segment.max - segment.min;
		const horizontal = segment.orientation === "horizontal";
		const along = horizontal ? size.width / 2 + 4 : size.height / 2 + 4;
		for (
			let offset = Math.min(along, length / 2);
			offset <= length - Math.min(along, length / 2);
			offset += LABEL_SLIDE_STEP
		) {
			if (travelled + offset > LABEL_SLIDE_LENGTH) break;
			// A label beside a run keeps clear of the end runs and their markers.
			if (
				(runs.start > 0 && travelled + offset - along < runs.start) ||
				(runs.end > 0 && travelled + offset + along > total - runs.end)
			)
				continue;
			const t = offset / length;
			const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
			for (const side of [1, -1])
				positions.push(
					horizontal
						? { x: point.x, y: point.y - side * (size.height / 2 + 5) }
						: { x: point.x + side * (size.width / 2 + 8), y: point.y },
				);
		}
		travelled += length;
	}
	return positions;
}

/** The end runs a label keeps clear of, from its line's start and end. */
export function labelRuns(route: RoutedEdge | undefined): { start: number; end: number } {
	return route
		? { start: endRunOf(route, "source"), end: endRunOf(route, "target") }
		: { start: 0, end: 0 };
}
