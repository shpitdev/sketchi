import { EXPORT_PADDING, MIN_NODE_HEIGHT, PADDING } from "./measure.js";
import { type GroupLayout, type LaneLayout, type DiagramLayout } from "./layout-types.js";
import { ownEndRunCount, straightRuns, drawnSize, routeLength } from "./route-geometry.js";
import { groupRouteDefects, laneRouteDefects, groupBlocks, laneBlocks } from "./containers.js";
import {
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasShapeElement as NodeSceneElement,
	segmentsFromPoints,
	segmentsOverlapInterior,
	isSharedBoundStem,
	AXIS_ALIGNED_EPSILON,
	segmentCrossesBoundsInterior,
	isCanvasComposedShape,
	type CanvasPoint as ScenePoint,
	routingQualityFindings,
	routingQualityScale,
	candidateRouteQuality,
	touchingLines,
} from "@sketchi/drawing";
import { center } from "./geometry.js";

/**
 * ...or about 2.5 times: a column always, since a tall export shrinks to fit
 * a screen's height, and a row once fitting it to a 2000 px screen would
 * shrink its text below about 24 px...
 */
export const WRAP_ASPECT = 2.45;

/** Width over height, either way up, of content this size in a padded export. */
export function exportAspect(along: number, across: number): number {
	const [long, short] = along > across ? [along, across] : [across, along];
	return (long + 2 * EXPORT_PADDING) / (short + 2 * EXPORT_PADDING);
}

/**
 * Overlapping segments and segments through unbound nodes, counted as
 * validateExcalidrawScene counts them on the export (bound stems that leave or
 * reach one node at one point in one direction may coincide), and lines that
 * meet their own end nodes past their attaching runs (ownEndRunCount).
 */
export function exportRouteDefects(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
	groups?: GroupLayout,
	lanes?: LaneLayout,
): (readonly [string] | readonly [string, string])[] {
	const segments = arrows.flatMap((arrow) =>
		segmentsFromPoints(arrow.points).map((segment) => {
			const from = arrow.points[segment.segmentIndex]!;
			const to = arrow.points[segment.segmentIndex + 1]!;
			return {
				...segment,
				arrowId: arrow.id,
				startBindingId: arrow.sourceNodeId,
				endBindingId: arrow.targetNodeId,
				from: segment.orientation === "horizontal" ? from.x : from.y,
				to: segment.orientation === "horizontal" ? to.x : to.y,
			};
		}),
	);
	const defects: (readonly [string] | readonly [string, string])[] = [];
	for (const [index, left] of segments.entries()) {
		for (const right of segments.slice(index + 1)) {
			if (left.arrowId === right.arrowId || !segmentsOverlapInterior(left, right)) continue;
			const departure =
				left.isFirstSegment && right.isFirstSegment && left.startBindingId === right.startBindingId;
			const shared =
				isSharedBoundStem(left, right) &&
				Math.abs((departure ? left.from : left.to) - (departure ? right.from : right.to)) <=
					AXIS_ALIGNED_EPSILON &&
				Math.sign(left.to - left.from) === Math.sign(right.to - right.from);
			if (!shared) defects.push([left.arrowId, right.arrowId]);
		}
		for (const node of nodes)
			if (
				node.nodeId !== left.startBindingId &&
				node.nodeId !== left.endBindingId &&
				segmentCrossesBoundsInterior(left, node)
			)
				defects.push([left.arrowId]);
	}
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	for (const arrow of arrows)
		if (ownEndRunCount(arrow.points, byId.get(arrow.sourceNodeId), byId.get(arrow.targetNodeId)))
			defects.push([arrow.id]);
	const grouped = groups ? [...defects, ...groupRouteDefects(arrows, groups)] : defects;
	return lanes ? [...grouped, ...laneRouteDefects(arrows, lanes)] : grouped;
}

/** Endpoints whose first step heads into their own node instead of away from it. */
export function inwardEndpoints(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
): number {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	let inward = 0;
	for (const arrow of arrows)
		for (const [nodeId, point, next] of [
			[arrow.sourceNodeId, arrow.points[0], arrow.points[1]],
			[arrow.targetNodeId, arrow.points.at(-1), arrow.points.at(-2)],
		] as const) {
			const node = byId.get(nodeId);
			if (!node || !point || !next) continue;
			const step = 0.0001;
			// A composed shape's end sits on its drawn outline, inside its box: its
			// first step heads in when it closes on the box's middle.
			if (isCanvasComposedShape(node.shape)) {
				const toward = (from: ScenePoint) =>
					Math.max(
						Math.abs(from.x - center(node).x) / (node.width / 2),
						Math.abs(from.y - center(node).y) / (node.height / 2),
					);
				const moved = {
					x: point.x + (next.x - point.x) * step,
					y: point.y + (next.y - point.y) * step,
				};
				if (toward(moved) < toward(point) - 1e-9) inward += 1;
				continue;
			}
			const x = (point.x + (next.x - point.x) * step - center(node).x) / (node.width / 2);
			const y = (point.y + (next.y - point.y) * step - center(node).y) / (node.height / 2);
			const extent =
				node.shape === "diamond"
					? Math.abs(x) + Math.abs(y)
					: node.shape === "ellipse" || node.shape === "circle"
						? Math.hypot(x, y)
						: Math.max(Math.abs(x), Math.abs(y));
			if (extent < 1 - 1e-6) inward += 1;
		}
	return inward;
}

/** Export defects that must not grow, and reader-scale findings to reduce. */
export function routingDefects(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
	scale: number,
	groups?: GroupLayout,
	lanes?: LaneLayout,
): { hard: number; reader: number } {
	const reader = routingQualityFindings(
		arrows.map((arrow) => ({
			id: arrow.id,
			points: arrow.points,
			sourceId: arrow.sourceNodeId,
			targetId: arrow.targetNodeId,
		})),
		scale,
	).length;
	return { hard: exportRouteDefects(arrows, nodes, groups, lanes).length, reader };
}

/**
 * Interior crossings of the axis-aligned segments of `a`, from point `from` on,
 * with those of `b`: of their straight runs, or of each segment as routed when
 * not `runs`, which misses a line crossing where a route runs straight on.
 */
export function pathCrossings(
	route: readonly ScenePoint[],
	other: readonly ScenePoint[],
	from = 0,
	runs = true,
): number {
	const a = runs ? straightRuns(route.slice(Math.max(0, from))) : route.slice(Math.max(0, from));
	const b = runs ? straightRuns(other) : other;
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + AXIS_ALIGNED_EPSILON && value < Math.max(p, q) - AXIS_ALIGNED_EPSILON;
	const horizontal = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON;
	const vertical = (p: ScenePoint, q: ScenePoint) =>
		Math.abs(p.x - q.x) <= AXIS_ALIGNED_EPSILON && Math.abs(p.y - q.y) > AXIS_ALIGNED_EPSILON;
	let crossings = 0;
	for (let i = 0; i < a.length - 1; i += 1)
		for (let j = 0; j < b.length - 1; j += 1) {
			const [p, q, r, u] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
			const [across, along] =
				horizontal(p, q) && vertical(r, u)
					? [
							[p, q],
							[r, u],
						]
					: vertical(p, q) && horizontal(r, u)
						? [
								[r, u],
								[p, q],
							]
						: [];
			if (
				across &&
				along &&
				between(along[0]!.x, across[0]!.x, across[1]!.x) &&
				between(across[0]!.y, along[0]!.y, along[1]!.y)
			)
				crossings += 1;
		}
	return crossings;
}

/**
 * Interior crossings between different arrows. Not `runs`, it counts as the
 * arrangements always have, missing a line crossing where a route runs
 * straight on past a point it was routed through.
 */
export function arrowCrossings(arrows: readonly ArrowSceneElement[], runs = true): number {
	return arrows.reduce(
		(sum, arrow, index) =>
			sum +
			arrows
				.slice(index + 1)
				.reduce((pair, other) => pair + pathCrossings(arrow.points, other.points, 0, runs), 0),
		0,
	);
}

/**
 * Reader-scale findings as the routing tests count them: jogs, near-coincident
 * corridors, touching arrowheads and lines through another arrowhead, at the
 * export size of everything drawn.
 */
export function readerFindingCount(
	arrows: readonly ArrowSceneElement[],
	nodes: readonly NodeSceneElement[],
	jogs = true,
): number {
	const scale = routingQualityScale(drawnSize(nodes, arrows));
	const routes = arrows.map((arrow) => ({
		id: arrow.id,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
	}));
	const quality = candidateRouteQuality(routes, scale);
	return (
		routingQualityFindings(routes, scale).filter(
			(finding) => jogs || finding.kind !== "endpoint-jog",
		).length + routes.filter((route) => quality(route).arrowheadsCrossed > 0).length
	);
}

/**
 * Lines that run more than twice the orthogonal distance between their ends,
 * plus a node and the padding either side of it: a reader takes them for detours.
 */
export function detouredLines(arrows: readonly ArrowSceneElement[]): number {
	return arrows.filter((arrow) => {
		const [start, end] = [arrow.points[0], arrow.points.at(-1)!];
		const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		return routeLength(arrow.points) > 2 * direct + MIN_NODE_HEIGHT + 2 * PADDING;
	}).length;
}

/** Edges whose lines pass through or touch another line's arrowhead, judged at the export size. */
export function headCrossers(layout: DiagramLayout): Set<string> {
	const nodes = [...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)];
	const routes = layout.edgeArrows.map((arrow) => ({
		id: arrow.id,
		edgeId: arrow.edgeId,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
		endArrowhead: arrow.endArrowhead !== null,
	}));
	const quality = candidateRouteQuality(
		routes,
		routingQualityScale(drawnSize(nodes, layout.edgeArrows)),
	);
	return new Set(
		routes.filter((route) => quality(route).arrowheadsCrossed > 0).map((route) => route.edgeId),
	);
}

/**
 * Neither more crossings (or, when `fewerCrossings`, strictly fewer) nor more
 * reader-scale findings, each judged at its own export size, and no newly
 * extreme or longer aspect, unless `narrower` and only narrower. Without
 * `jogs`, a jog beside a port does not count, being minor next to the extreme
 * aspect a zoned wrap removes. With `touches`, each pair of lines that touch
 * (touchingLines) counts as a finding.
 */
export function routesNoWorse(
	candidate: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">,
	current: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">,
	fewerCrossings = false,
	runs = true,
	narrower = false,
	jogs = true,
	touches = false,
): boolean {
	const [crossings, currentCrossings] = [candidate, current].map((layout) =>
		arrowCrossings(layout.edgeArrows, runs),
	);
	// Lines that touch, where counted, are reader findings too.
	const findings = (layout: typeof candidate) =>
		readerFindingCount(
			layout.edgeArrows,
			[...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)],
			jogs,
		) + (touches ? touchingLineCount(layout) : 0);
	const [size, currentSize] = [candidate, current].map((layout) =>
		drawnSize(
			[...layout.nodeShapes, ...groupBlocks(layout.groups), ...laneBlocks(layout.lanes)],
			layout.edgeArrows,
		),
	);
	const [aspect, currentAspect] = [size!, currentSize!].map(({ width, height }) =>
		exportAspect(width, height),
	);
	const longSide = ({ width, height }: { width: number; height: number }) =>
		Math.max(width, height);
	return (
		(fewerCrossings ? crossings! < currentCrossings! : crossings! <= currentCrossings!) &&
		(aspect! < WRAP_ASPECT ||
			aspect! <= currentAspect! + AXIS_ALIGNED_EPSILON ||
			// Narrower without growing longer: its text fits no smaller.
			(narrower && longSide(size!) <= longSide(currentSize!) + AXIS_ALIGNED_EPSILON)) &&
		findings(candidate) <= findings(current)
	);
}

/** Pairs of lines that meet anywhere but a clean crossing, at the drawing's export scale. */
function touchingPairs({
	edgeArrows,
	groups,
	lanes,
	nodeShapes,
}: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">) {
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)], edgeArrows),
	);
	return touchingLines(
		edgeArrows.map((arrow) => ({
			id: arrow.edgeId,
			points: arrow.points,
			sourceId: arrow.sourceNodeId,
			targetId: arrow.targetNodeId,
		})),
		scale,
	);
}

export function touchingLineCount(
	layout: Pick<DiagramLayout, "edgeArrows" | "groups" | "lanes" | "nodeShapes">,
): number {
	return touchingPairs(layout).length;
}

/** Edges whose lines touch another line anywhere but a clean crossing. */
export function touchingEdges(layout: DiagramLayout): Set<string> {
	return new Set(touchingPairs(layout).flatMap((pair) => pair.arrowIds));
}
