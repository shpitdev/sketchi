/** Owns route segments, intersections, clearance predicates, lengths and drawn extents. */
import {
	type CanvasPoint as ScenePoint,
	type CanvasShapeElement as NodeSceneElement,
	type AxisAlignedSegment,
	AXIS_ALIGNED_EPSILON,
	segmentsFromPoints,
	segmentCrossesBoundsInterior,
	routingQualityScale,
	routingCorridorGap,
	routingCorridorRun,
	type CanvasConnectorElement as ArrowSceneElement,
	segmentsOverlapInterior,
	isSharedBoundStem,
	candidateTouches,
	routingTouchGap,
	arrowheadsNear,
	candidateRouteQuality,
	segmentOverlapLength,
	GROUP_OUTLINE_CLEARANCE,
} from "@sketchi/drawing";
import {
	type Box,
	type DiagramLayout,
	type Alongside,
	type RouteSegment,
	type RoutedEdge,
	type RoutedSoFar,
	type TouchGrid,
	type CrossingRun,
	type ConnectionEdge,
	type CrossingLookup,
} from "./layout-types.js";
import { groupBlocks, GROUP_OUTLINE, LANE_OUTLINE, LANE_OUTLINE_CLEARANCE } from "./containers.js";
import { openEnd, ROUTE_STUB_LENGTH, reservedArrivals } from "./geometry.js";
import { ARROWHEAD_LENGTH } from "./measure.js";

export function compactPoints(points: readonly ScenePoint[]): [ScenePoint, ...ScenePoint[]] {
	const compacted: ScenePoint[] = [];

	for (const point of points) {
		const previous = compacted[compacted.length - 1];

		if (previous && previous.x === point.x && previous.y === point.y) {
			continue;
		}

		compacted.push(point);
	}

	const first = compacted[0];
	if (!first) {
		return [{ x: 0, y: 0 }];
	}

	return [first, ...compacted.slice(1)];
}

function pointInsideBounds(point: ScenePoint, shape: NodeSceneElement): boolean {
	return (
		point.x >= shape.x &&
		point.x <= shape.x + shape.width &&
		point.y >= shape.y &&
		point.y <= shape.y + shape.height
	);
}

/** Room a route keeps from the drawn outline of every node it neither leaves nor enters. */
export const NODE_CLEARANCE = 12;

/**
 * Whether an axis-aligned segment passes within `clearance` of a shape's drawn
 * outline: its rectangle, or its ellipse or diamond grown by `clearance`, so a
 * line never runs tangent to a rounded or pointed node it passes.
 */
export function segmentNearOutline(
	segment: AxisAlignedSegment,
	shape: NodeSceneElement,
	clearance: number,
): boolean {
	const horizontal = segment.orientation === "horizontal";
	const [halfAlong, halfAcross] = horizontal
		? [shape.width / 2, shape.height / 2]
		: [shape.height / 2, shape.width / 2];
	const middle = horizontal ? shape.x + halfAlong : shape.y + halfAlong;
	const offset = Math.abs(
		segment.staticCoordinate - (horizontal ? shape.y + halfAcross : shape.x + halfAcross),
	);
	let reach: number;
	if (shape.shape === "ellipse" || shape.shape === "circle") {
		const [along, across] = [halfAlong + clearance, halfAcross + clearance];
		if (offset >= across) return false;
		reach = along * Math.sqrt(1 - (offset / across) ** 2);
	} else if (shape.shape === "diamond") {
		// Each side moves out by the clearance along its normal.
		const grown = 1 + clearance * Math.hypot(1 / halfAlong, 1 / halfAcross);
		if (offset >= halfAcross * grown) return false;
		reach = halfAlong * (grown - offset / halfAcross);
	} else {
		if (offset >= halfAcross + clearance) return false;
		reach = halfAlong + clearance;
	}
	return (
		segment.min < middle + reach - AXIS_ALIGNED_EPSILON &&
		segment.max > middle - reach + AXIS_ALIGNED_EPSILON
	);
}

/** A drawn node a route must keep its clearance from: neither of its own ends, nor a label or frame. */
export function keepsClearOf(
	shape: NodeSceneElement,
	ignoredNodeIds: ReadonlySet<string>,
): boolean {
	return shape.id.startsWith("node:") && !ignoredNodeIds.has(shape.nodeId);
}

/** Runs that lie along a drawn node's border, other than its own ends' nodes. */
export function routeBorderRunCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	return segmentsFromPoints(points).filter((segment) =>
		shapes.some(
			(shape) => keepsClearOf(shape, ignoredNodeIds) && segmentAlongBorder(segment, shape),
		),
	).length;
}

/** Whether a run lies on one of a box's sides, overlapping it. */
export function segmentAlongBorder(segment: AxisAlignedSegment, box: Box): boolean {
	const horizontal = segment.orientation === "horizontal";
	const [low, size, along, length] = horizontal
		? [box.y, box.height, box.x, box.width]
		: [box.x, box.width, box.y, box.height];
	return (
		(Math.abs(segment.staticCoordinate - low) <= AXIS_ALIGNED_EPSILON ||
			Math.abs(segment.staticCoordinate - low - size) <= AXIS_ALIGNED_EPSILON) &&
		Math.min(segment.max, along + length) - Math.max(segment.min, along) > AXIS_ALIGNED_EPSILON
	);
}

/**
 * Segments of a line that enter one of its own end nodes' boxes, other than
 * those of the straight run that attaches the line there. A line meets its
 * ends only by those runs: elsewhere it cuts a diamond's tip or an ellipse's
 * side, or runs through the node, inside its box. Routes are chosen clear of
 * these as of every node (routeNodeCrossingCount); exportRouteDefects keeps
 * every later move from making one.
 */
export function ownEndRunCount(
	points: readonly ScenePoint[],
	source: NodeSceneElement | undefined,
	target: NodeSceneElement | undefined,
): number {
	const segments = segmentsFromPoints(points);
	const heading = (segment: AxisAlignedSegment) => {
		const [from, to] = [points[segment.segmentIndex]!, points[segment.segmentIndex + 1]!];
		return Math.sign(to.x - from.x + to.y - from.y);
	};
	// Segments that run straight on, the same way, from one to the next.
	const straightOn = (a: AxisAlignedSegment, b: AxisAlignedSegment) =>
		a.orientation === b.orientation &&
		Math.abs(a.staticCoordinate - b.staticCoordinate) <= AXIS_ALIGNED_EPSILON &&
		heading(a) === heading(b);
	let [leaving, arriving] = [1, 1];
	while (leaving < segments.length && straightOn(segments[leaving]!, segments[0]!)) leaving += 1;
	while (arriving < segments.length && straightOn(segments.at(-1 - arriving)!, segments.at(-1)!))
		arriving += 1;
	const ends = [source, ...(target?.nodeId === source?.nodeId ? [] : [target])];
	let count = 0;
	for (const [index, segment] of segments.entries())
		for (const node of ends)
			if (
				node !== undefined &&
				!(index < leaving && node.nodeId === source?.nodeId) &&
				!(index >= segments.length - arriving && node.nodeId === target?.nodeId) &&
				segmentCrossesBoundsInterior(segment, node)
			)
				count += 1;
	return count;
}

export function routeNodeCrossingCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	let crossingCount = 0;

	for (const [index, segment] of segmentsFromPoints(points).entries()) {
		for (const shape of shapes) {
			const endpointStub =
				ignoredNodeIds.has(shape.nodeId) &&
				((index === 0 && pointInsideBounds(points[0]!, shape)) ||
					(index === points.length - 2 && pointInsideBounds(points.at(-1)!, shape)));
			if (!endpointStub && segmentCrossesBoundsInterior(segment, shape)) {
				crossingCount += 1;
			}
		}
	}

	return crossingCount;
}

/** Runs of a route that pass within the clearance of a node's outline without crossing it. */
export function routeClearanceCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
): number {
	let near = 0;
	for (const segment of segmentsFromPoints(points))
		for (const shape of shapes)
			if (
				keepsClearOf(shape, ignoredNodeIds) &&
				!segmentCrossesBoundsInterior(segment, shape) &&
				segmentNearOutline(segment, shape, NODE_CLEARANCE)
			)
				near += 1;
	return near;
}

export function alongsideReach({
	edgeArrows,
	groups,
	nodeShapes,
}: Pick<DiagramLayout, "edgeArrows" | "groups" | "nodeShapes">): Alongside | undefined {
	if (!groups?.zoned) return undefined;
	const scale = routingQualityScale(drawnSize([...nodeShapes, ...groupBlocks(groups)], edgeArrows));
	return { gap: routingCorridorGap(scale), run: routingCorridorRun(scale) };
}

/** Whether a run lies alongside a box's side, outside it but nearer than the gap, past a corner's length. */
export function segmentAlongside(
	segment: AxisAlignedSegment,
	box: Box,
	{ gap, run }: Alongside,
): boolean {
	const horizontal = segment.orientation === "horizontal";
	const [low, size, along, length] = horizontal
		? [box.y, box.height, box.x, box.width]
		: [box.x, box.width, box.y, box.height];
	const at = segment.staticCoordinate;
	const distance = at < low ? low - at : at - low - size;
	return (
		distance > 0 &&
		distance < gap &&
		Math.min(segment.max, along + length) - Math.max(segment.min, along) > run
	);
}

/** Middle runs of a route that lie alongside a node it neither leaves nor enters. */
export function routeAlongsideCount(
	points: readonly ScenePoint[],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
	alongside: Alongside,
): number {
	return segmentsFromPoints(straightRuns(points)).filter(
		(segment) =>
			!segment.isFirstSegment &&
			!segment.isLastSegment &&
			shapes.some(
				(shape) =>
					keepsClearOf(shape, ignoredNodeIds) && segmentAlongside(segment, shape, alongside),
			),
	).length;
}

export function routeLength(points: readonly ScenePoint[]): number {
	let length = 0;

	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index];
		const end = points[index + 1];

		if (!start || !end) {
			continue;
		}

		length += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	}

	return length;
}

function routeSegments(input: {
	arrowId: string;
	points: readonly ScenePoint[];
	sourceNodeId: string;
	targetNodeId: string;
}): RouteSegment[] {
	return segmentsFromPoints(input.points).map((segment) => {
		const [from, to] = [
			input.points[segment.segmentIndex]!,
			input.points[segment.segmentIndex + 1]!,
		];
		return {
			...segment,
			arrowId: input.arrowId,
			startBindingId: input.sourceNodeId,
			endBindingId: input.targetNodeId,
			from: segment.orientation === "horizontal" ? from.x : from.y,
			to: segment.orientation === "horizontal" ? to.x : to.y,
		};
	});
}

/** Segment the routed arrows once per search; candidates and grid steps reuse the result. */
function existingRouteSegments(existingArrows: readonly ArrowSceneElement[]): RouteSegment[] {
	return existingArrows.flatMap((arrow) =>
		routeSegments({
			arrowId: arrow.id,
			points: arrow.points,
			sourceNodeId: arrow.sourceNodeId,
			targetNodeId: arrow.targetNodeId,
		}),
	);
}

/** Other lines a candidate meets anywhere but a clean crossing (touchingLines). */
export function routeTouchCount(
	points: readonly ScenePoint[],
	route: RoutedEdge,
	routed: RoutedSoFar,
): number {
	return (
		routed.touches?.({
			id: `edge:${route.edge.id}`,
			points,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}) ?? 0
	);
}

/** First index in a list sorted by `key` whose key is at least `value`. */
function lowerBound<T>(list: readonly T[], key: (item: T) => number, value: number): number {
	let [low, high] = [0, list.length];
	while (low < high) {
		const middle = (low + high) >> 1;
		if (key(list[middle]!) < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function touchGrid(arrows: readonly ArrowSceneElement[], gap: number): TouchGrid {
	const lines = arrows.filter((arrow) => !arrow.id.startsWith(GROUP_OUTLINE));
	// A reserved stub's free end is no bend: its line may run straight on.
	const bends = lines
		.flatMap((arrow) => {
			const points = straightRuns(arrow.points);
			const open = openEnd(arrow);
			return (
				open === "start" ? points.slice(1) : open === "end" ? points.slice(0, -1) : points
			).map((point) => ({ id: arrow.id, point }));
		})
		.sort((a, b) => a.point.x - b.point.x);
	const runs: Record<AxisAlignedSegment["orientation"], CrossingRun[]> = {
		horizontal: [],
		vertical: [],
	};
	for (const arrow of lines)
		for (const segment of segmentsFromPoints(straightRuns(arrow.points)))
			runs[segment.orientation].push({
				arrowId: arrow.id,
				at: segment.staticCoordinate,
				min: segment.min,
				max: segment.max,
			});
	for (const list of Object.values(runs)) list.sort((a, b) => a.at - b.at);
	const near = (value: number, low: number, high: number) =>
		value > low - gap && value < high + gap;
	return {
		gap,
		step: (from, to, arrowId) => {
			const [minX, maxX] = [Math.min(from.x, to.x), Math.max(from.x, to.x)];
			const [minY, maxY] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
			const touched = new Set<string>();
			for (
				let index = lowerBound(bends, (bend) => bend.point.x, minX - gap + AXIS_ALIGNED_EPSILON);
				index < bends.length && bends[index]!.point.x < maxX + gap;
				index += 1
			) {
				const { id, point } = bends[index]!;
				if (id === arrowId || !near(point.y, minY, maxY)) continue;
				const dx = Math.max(minX - point.x, 0, point.x - maxX);
				const dy = Math.max(minY - point.y, 0, point.y - maxY);
				if (Math.hypot(dx, dy) < gap) touched.add(id);
			}
			return touched.size;
		},
		turn: (point, arrowId) => {
			const touched = new Set<string>();
			for (const [orientation, at, along] of [
				["horizontal", point.y, point.x],
				["vertical", point.x, point.y],
			] as const) {
				const list = runs[orientation];
				for (
					let index = lowerBound(list, (run) => run.at, at - gap + AXIS_ALIGNED_EPSILON);
					index < list.length && list[index]!.at < at + gap;
					index += 1
				) {
					const run = list[index]!;
					if (run.arrowId === arrowId) continue;
					const beyond = Math.max(run.min - along, 0, along - run.max);
					if (Math.hypot(beyond, at - run.at) < gap) touched.add(run.arrowId);
				}
			}
			return touched.size;
		},
	};
}

export function routeArrowOverlapCount(
	points: readonly ScenePoint[],
	existingSegments: readonly RouteSegment[],
	route: RoutedEdge,
): number {
	const candidateSegments = routeSegments({
		arrowId: `edge:${route.edge.id}`,
		points,
		sourceNodeId: route.edge.source,
		targetNodeId: route.edge.target,
	});
	let overlapCount = 0;

	for (const candidate of candidateSegments) {
		for (const existing of existingSegments) {
			if (
				candidate.arrowId === existing.arrowId ||
				!segmentsOverlapInterior(candidate, existing) ||
				(route.pinned !== undefined && sharedPinnedStem(candidate, existing))
			) {
				continue;
			}

			overlapCount += 1;
		}
	}

	return overlapCount;
}

/**
 * Stems that leave or reach one node at one point in one direction, as lines
 * pinned to the same port do: the export validator lets them coincide.
 */
function sharedPinnedStem(left: RouteSegment, right: RouteSegment): boolean {
	const departure =
		left.isFirstSegment && right.isFirstSegment && left.startBindingId === right.startBindingId;
	return (
		isSharedBoundStem(left, right) &&
		Math.abs((departure ? left.from : left.to) - (departure ? right.from : right.to)) <=
			AXIS_ALIGNED_EPSILON &&
		Math.sign(left.to - left.from) === Math.sign(right.to - right.from)
	);
}

export function routeSelfOverlapCount(points: readonly ScenePoint[], route: RoutedEdge): number {
	const segments = routeSegments({
		arrowId: `edge:${route.edge.id}`,
		points,
		sourceNodeId: route.edge.source,
		targetNodeId: route.edge.target,
	});
	let overlapCount = 0;

	for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
		const left = segments[leftIndex];

		if (!left) {
			continue;
		}

		for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
			const right = segments[rightIndex];

			if (!right || !segmentsOverlapInterior(left, right)) {
				continue;
			}

			overlapCount += 1;
		}
	}

	return overlapCount;
}

export function routeBacktrackDistance(points: readonly ScenePoint[]): number {
	const start = points[0];
	const end = points[points.length - 1];

	if (!start || !end) {
		return 0;
	}

	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	let distance = 0;

	if (end.x < start.x) {
		distance += Math.max(0, Math.max(...xs) - start.x);
	} else if (end.x > start.x) {
		distance += Math.max(0, start.x - Math.min(...xs));
	}

	if (end.y < start.y) {
		distance += Math.max(0, Math.max(...ys) - start.y);
	} else if (end.y > start.y) {
		distance += Math.max(0, start.y - Math.min(...ys));
	}

	return distance;
}

export function routeTargetOvershootDistance(points: readonly ScenePoint[]): number {
	const start = points[0];
	const end = points[points.length - 1];

	if (!start || !end) {
		return 0;
	}

	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	let distance = 0;

	if (end.x < start.x) {
		distance += Math.max(0, end.x - Math.min(...xs));
	} else if (end.x > start.x) {
		distance += Math.max(0, Math.max(...xs) - end.x);
	}

	if (end.y < start.y) {
		distance += Math.max(0, end.y - Math.min(...ys));
	} else if (end.y > start.y) {
		distance += Math.max(0, Math.max(...ys) - end.y);
	}

	return distance;
}

function pointLeavesEdge(
	edgePoint: ScenePoint,
	candidate: ScenePoint,
	edge: ConnectionEdge,
): boolean {
	switch (edge) {
		case "top":
			return candidate.x === edgePoint.x && edgePoint.y - candidate.y >= ROUTE_STUB_LENGTH;
		case "right":
			return candidate.y === edgePoint.y && candidate.x - edgePoint.x >= ROUTE_STUB_LENGTH;
		case "bottom":
			return candidate.x === edgePoint.x && candidate.y - edgePoint.y >= ROUTE_STUB_LENGTH;
		case "left":
			return candidate.y === edgePoint.y && edgePoint.x - candidate.x >= ROUTE_STUB_LENGTH;
	}
}

function endpointStubScore(
	points: readonly [ScenePoint, ...ScenePoint[]],
	route: RoutedEdge,
): number {
	const start = points[0];
	const second = points[1];
	const end = points[points.length - 1];
	const pointBeforeEnd = points[points.length - 2];
	let score = 0;

	if (second && pointLeavesEdge(start, second, route.sourceEdge)) {
		score += 1;
	}

	if (pointBeforeEnd && end && pointLeavesEdge(end, pointBeforeEnd, route.targetEdge)) {
		score += 1;
	}

	return score;
}

/** Touch scoring against the arrows routed so far: a reserved stub's free end is no bend. */
function touchScoring(
	arrows: readonly ArrowSceneElement[],
	readerScale: number,
): Pick<RoutedSoFar, "touches" | "touchGrid"> {
	return {
		touches: candidateTouches(
			arrows.flatMap((arrow) => {
				if (arrow.id.startsWith(GROUP_OUTLINE)) return [];
				const open = openEnd(arrow);
				return [
					{
						id: arrow.id,
						points: arrow.points,
						sourceId: arrow.sourceNodeId,
						targetId: arrow.targetNodeId,
						...(open ? { openEnd: open } : {}),
					},
				];
			}),
			readerScale,
		),
		touchGrid: touchGrid(arrows, routingTouchGap(readerScale)),
	};
}

export function routedSoFar(
	routedArrows: readonly ArrowSceneElement[],
	readerScale: number | undefined,
	avoidCrossings = false,
	clearHeads = false,
	shared?: { readonly of: (arrow: ArrowSceneElement) => boolean; readonly gap: number },
	clearTouches = false,
): RoutedSoFar {
	const arrows = routedArrows.some((arrow) => arrow.id.startsWith(LANE_OUTLINE))
		? routedArrows.filter((arrow) => !arrow.id.startsWith(LANE_OUTLINE))
		: routedArrows;
	const scored = arrows.map((arrow) => ({
		id: arrow.id,
		points: arrow.points,
		sourceId: arrow.sourceNodeId,
		targetId: arrow.targetNodeId,
		endArrowhead: arrow.endArrowhead !== null,
		// A reserved arrival stub stands for a line whose head is drawn full size.
		...(clearHeads && reservedArrivals.has(arrow) ? { headRun: 2 * ARROWHEAD_LENGTH } : {}),
	}));
	return {
		...(readerScale === undefined
			? {}
			: {
					...(avoidCrossings ? { crossings: crossingLookup(arrows) } : {}),
					...(clearHeads ? { heads: arrowheadsNear(scored, readerScale) } : {}),
					quality: sharedQuality(scored, arrows, readerScale, shared),
					...(clearTouches ? touchScoring(arrows, readerScale) : {}),
				}),
		outlines: existingRouteSegments(
			routedArrows.filter((arrow) => arrow.id.startsWith(GROUP_OUTLINE)),
		),
		segments: existingRouteSegments(arrows),
	};
}

/**
 * Candidate route quality against arrows routed so far. With `shared`, a line
 * sharing a node with the candidate runs beside it only when nearer than
 * `shared.gap`, the spacing its family gives such lines, where that is nearer
 * than a reader's corridor gap: its corridors are judged at the scale that
 * makes the corridor gap that spacing. Jogs and arrowheads count as ever.
 */
function sharedQuality(
	scored: readonly Parameters<typeof candidateRouteQuality>[0][number][],
	arrows: readonly ArrowSceneElement[],
	readerScale: number,
	shared: { readonly of: (arrow: ArrowSceneElement) => boolean; readonly gap: number } | undefined,
): ReturnType<typeof candidateRouteQuality> {
	const all = candidateRouteQuality(scored, readerScale);
	const readerGap = routingCorridorGap(readerScale);
	if (!shared || shared.gap >= readerGap) return all;
	const sharing = arrows.map((arrow) => shared.of(arrow));
	const beside = scored.filter((_, index) => sharing[index]);
	const others = scored.filter((_, index) => !sharing[index]);
	if (beside.length === 0) return all;
	const near = candidateRouteQuality(beside, (readerScale * readerGap) / shared.gap);
	const far = candidateRouteQuality(others, readerScale);
	return (candidate) => ({
		...all(candidate),
		corridors: far(candidate).corridors + near(candidate).corridors,
	});
}

/** Crossing counts against routed arrows, sorted once per route so each query reads only nearby runs. */
function crossingLookup(arrows: readonly ArrowSceneElement[]): CrossingLookup {
	const runs: Record<AxisAlignedSegment["orientation"], CrossingRun[]> = {
		horizontal: [],
		vertical: [],
	};
	for (const arrow of arrows) {
		if (arrow.id.startsWith(GROUP_OUTLINE)) continue;
		const points = straightRuns(arrow.points);
		for (let index = 0; index + 1 < points.length; index += 1) {
			const [p, q] = [points[index]!, points[index + 1]!];
			const horizontal = Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON;
			if (!horizontal && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON) continue;
			const [low, high] = horizontal ? [p.x, q.x] : [p.y, q.y];
			if (Math.abs(high - low) <= AXIS_ALIGNED_EPSILON) continue;
			runs[horizontal ? "horizontal" : "vertical"].push({
				arrowId: arrow.id,
				at: horizontal ? p.y : p.x,
				min: Math.min(low, high),
				max: Math.max(low, high),
			});
		}
	}
	for (const list of Object.values(runs)) list.sort((a, b) => a.at - b.at);
	const count = (
		orientation: AxisAlignedSegment["orientation"],
		at: number,
		low: number,
		high: number,
		arrowId: string,
		includeHigh: boolean,
	) => {
		// A step crosses the runs across it whose fixed coordinate it passes.
		const list = runs[orientation === "horizontal" ? "vertical" : "horizontal"];
		let start = 0;
		let end = list.length;
		while (start < end) {
			const middle = (start + end) >> 1;
			if (list[middle]!.at <= low + AXIS_ALIGNED_EPSILON) start = middle + 1;
			else end = middle;
		}
		let crossings = 0;
		for (let index = start; index < list.length; index += 1) {
			const run = list[index]!;
			if (
				includeHigh ? run.at > high + AXIS_ALIGNED_EPSILON : run.at >= high - AXIS_ALIGNED_EPSILON
			)
				break;
			if (
				run.arrowId !== arrowId &&
				at > run.min + AXIS_ALIGNED_EPSILON &&
				at < run.max - AXIS_ALIGNED_EPSILON
			)
				crossings += 1;
		}
		return crossings;
	};
	return {
		step: (orientation, at, from, to, arrowId) =>
			count(orientation, at, Math.min(from, to), Math.max(from, to), arrowId, true),
		route: (points, arrowId) => {
			const corners = straightRuns(points);
			let crossings = 0;
			for (let index = 0; index + 1 < corners.length; index += 1) {
				const [p, q] = [corners[index]!, corners[index + 1]!];
				const horizontal = Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON;
				if (!horizontal && Math.abs(p.x - q.x) > AXIS_ALIGNED_EPSILON) continue;
				const [low, high] = horizontal
					? [Math.min(p.x, q.x), Math.max(p.x, q.x)]
					: [Math.min(p.y, q.y), Math.max(p.y, q.y)];
				crossings += count(
					horizontal ? "horizontal" : "vertical",
					horizontal ? p.y : p.x,
					low,
					high,
					arrowId,
					false,
				);
			}
			return crossings;
		},
	};
}

/** Runs of a route parallel to a frame outline and closer to it than its clearance. */
export function routeOutlineBesideCount(
	points: readonly ScenePoint[],
	outlines: readonly RouteSegment[],
): number {
	if (outlines.length === 0) return 0;
	return segmentsFromPoints(points).filter((segment) =>
		outlines.some(
			(edge) =>
				edge.orientation === segment.orientation &&
				Math.abs(edge.staticCoordinate - segment.staticCoordinate) < outlineClearance(edge) &&
				segmentOverlapLength(edge, segment) > GROUP_OUTLINE_CLEARANCE,
		),
	).length;
}

/** How far a route keeps from an outline it runs along: a lane boundary asks for more room. */
function outlineClearance(outline: RouteSegment): number {
	return outline.arrowId.startsWith(LANE_OUTLINE)
		? LANE_OUTLINE_CLEARANCE
		: GROUP_OUTLINE_CLEARANCE;
}

export function routeBendCount(points: readonly ScenePoint[]): number {
	return segmentsFromPoints(points).filter(
		(segment, index, segments) =>
			index > 0 && segment.orientation !== segments[index - 1]!.orientation,
	).length;
}

export function chooseBestRoute(
	candidates: readonly [ScenePoint, ...ScenePoint[]][],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
	route: RoutedEdge,
	routed: RoutedSoFar,
	borders = false,
	preferred: readonly [ScenePoint, ...ScenePoint[]][] = [],
): [ScenePoint, ...ScenePoint[]] {
	const first = candidates[0];
	if (!first) {
		return [{ x: 0, y: 0 }];
	}

	const routeScore = (candidate: [ScenePoint, ...ScenePoint[]]): readonly number[] => {
		const quality = routed.quality?.({
			id: `edge:${route.edge.id}`,
			points: candidate,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}) ?? { arrowheadsCrossed: 0, corridors: 0, jogs: 0 };
		return [
			-endpointStubScore(candidate, route),
			routeNodeCrossingCount(candidate, shapes, ignoredNodeIds),
			...(borders ? [routeBorderRunCount(candidate, shapes, ignoredNodeIds)] : []),
			routeSelfOverlapCount(candidate, route),
			routeArrowOverlapCount(candidate, routed.segments, route),
			routeTouchCount(candidate, route, routed),
			routed.heads ? quality.arrowheadsCrossed : 0,
			routeOutlineBesideCount(candidate, routed.outlines),
			quality.corridors,
			routed.heads ? 0 : quality.arrowheadsCrossed,
			routed.crossings?.route(candidate, `edge:${route.edge.id}`) ?? 0,
			routeBacktrackDistance(candidate),
			routeTargetOvershootDistance(candidate),
			quality.jogs,
			routeLength(candidate),
			routed.quality ? routeBendCount(candidate) : 0,
		];
	};
	const isLowerScore = (candidate: readonly number[], best: readonly number[]) => {
		for (let index = 0; index < candidate.length; index += 1) {
			const difference = (candidate[index] ?? 0) - (best[index] ?? 0);
			if (difference !== 0) return difference < 0;
		}
		return false;
	};
	let best = first;
	let bestScore = routeScore(first);
	for (const candidate of candidates.slice(1)) {
		const score = routeScore(candidate);
		if (isLowerScore(score, bestScore)) {
			best = candidate;
			bestScore = score;
		}
	}
	// A preferred route wins wherever it is no worse until crossings count: it
	// may run longer or bend more, and, kept in its lane, it crosses fewer lines.
	const until = bestScore.length - 6;
	for (const candidate of preferred) {
		const score = routeScore(candidate);
		if (!isLowerScore(bestScore.slice(0, until), score.slice(0, until))) {
			best = candidate;
			bestScore = score;
			break;
		}
	}
	return best;
}

/** Size of the nodes, arrows and any free labels drawn. */
export function drawnSize(
	nodes: readonly NodeSceneElement[],
	arrows: readonly ArrowSceneElement[],
	labels: readonly Box[] = [],
): { width: number; height: number } {
	const points = [
		...nodes.flatMap((node) => [
			{ x: node.x, y: node.y },
			{ x: node.x + node.width, y: node.y + node.height },
		]),
		...arrows.flatMap((arrow) => arrow.points),
		...labels.flatMap((label) => [
			{ x: label.x, y: label.y },
			{ x: label.x + label.width, y: label.y + label.height },
		]),
	];
	return {
		width:
			Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
		height:
			Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
	};
}

/**
 * A route's corners alone: a point that continues a straight run is dropped, so
 * a line crossing the route there crosses one run, not the end of two.
 */
export function straightRuns(points: readonly ScenePoint[]): ScenePoint[] {
	return points.filter((point, index) => {
		const [before, after] = [points[index - 1], points[index + 1]];
		return (
			!before ||
			!after ||
			!(
				(Math.abs(before.x - point.x) <= AXIS_ALIGNED_EPSILON &&
					Math.abs(point.x - after.x) <= AXIS_ALIGNED_EPSILON) ||
				(Math.abs(before.y - point.y) <= AXIS_ALIGNED_EPSILON &&
					Math.abs(point.y - after.y) <= AXIS_ALIGNED_EPSILON)
			)
		);
	});
}
