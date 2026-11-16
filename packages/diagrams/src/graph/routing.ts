/** Owns bounded geometric route search, self-loops, paired returns and route-order repairs. */
import {
	type RoutedEdge,
	type RouteOptions,
	type RouteSegment,
	type Alongside,
	type CrossingLookup,
	type RoutedSoFar,
	type TouchGrid,
	type ConnectionEdge,
} from "./layout-types";
import {
	routeEndpoints,
	isSelfLoop,
	pointAwayFromEdge,
	ROUTE_STUB_LENGTH,
	PORT_SPACING,
	center,
	OPPOSITE_EDGE,
	slotAxis,
	portKey,
	HORIZONTAL_GAP,
	VERTICAL_GAP,
} from "./geometry";
import {
	compactPoints,
	straightRuns,
	keepsClearOf,
	segmentAlongside,
	segmentNearOutline,
	NODE_CLEARANCE,
	segmentAlongBorder,
	routedSoFar,
	chooseBestRoute,
	routeBorderRunCount,
	routeNodeCrossingCount,
	routeSelfOverlapCount,
	routeArrowOverlapCount,
	routeOutlineBesideCount,
	routeBacktrackDistance,
	routeTargetOvershootDistance,
	routeTouchCount,
} from "./route-geometry";
import { type GraphInput } from "./input";
import {
	type CanvasShapeElement as NodeSceneElement,
	type CanvasConnectorElement as ArrowSceneElement,
	type AxisAlignedSegment,
	AXIS_ALIGNED_EPSILON,
	segmentsOverlapInterior,
	segmentOverlapLength,
	type CanvasPoint as ScenePoint,
	segmentsFromPoints,
	segmentCrossesBoundsInterior,
	GROUP_OUTLINE_CLEARANCE,
	routingCorridorGap,
	routingQualityFindings,
} from "@sketchi/drawing";
import {
	sourceStubLength,
	targetStubLength,
	straightHandoff,
	branchLabelObstacles,
	endpointStubsForRoutes,
} from "./ports";
import {
	boundsOf,
	obstacleBox,
	LANE_OUTLINE,
	LANE_OUTLINE_CLEARANCE,
	groupOutlineLines,
	laneOutlineLines,
	laneObstacles,
	groupObstacles,
} from "./containers";
import { padBox } from "./label-geometry";
import { exportRouteDefects, pathCrossings } from "./readability";
import { type GraphLayout } from "./topology";

function arrowForRoute(
	route: RoutedEdge,
	edgeRouting: GraphInput["layout"]["edgeRouting"],
	portOffsets: ReadonlyMap<string, number>,
	shapes: readonly NodeSceneElement[],
	existingArrows: readonly ArrowSceneElement[],
	options: RouteOptions,
): ArrowSceneElement {
	const { edge } = route;
	const { start: portedStart, end: portedEnd } = routeEndpoints(route, portOffsets);
	const routed =
		edgeRouting === "orthogonal"
			? exteriorLaneRoute(route, portedStart, portedEnd, shapes, existingArrows, options)
			: compactPoints([portedStart, portedEnd]);
	// A pinned line keeps only its corners, so a stem it shares with another line
	// stays one run from the shared port, as the export validator reads it.
	const points = route.pinned ? compactPoints(straightRuns(routed)) : routed;

	return {
		type: "arrow",
		id: `edge:${edge.id}`,
		edgeId: edge.id,
		sourceNodeId: edge.source,
		targetNodeId: edge.target,
		points,
		...(edge.label ? { label: edge.label } : {}),
	};
}

/**
 * The corner each self-loop turns around, from its two ports out past its
 * stubs, as a box every other route keeps out of, so no line runs through the
 * loop or between it and its label.
 */
function loopObstacles(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): NodeSceneElement[] {
	return routes.filter(isSelfLoop).map((route) => {
		const { start, end } = routeEndpoints(route, offsets);
		const points = [
			start,
			end,
			pointAwayFromEdge(start, route.sourceEdge, sourceStubLength(route, start, ROUTE_STUB_LENGTH)),
			pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)),
		];
		const box = boundsOf(points.map((point) => ({ ...point, width: 0, height: 0 })));
		return obstacleBox(`loop:${route.edge.id}`, padBox(box, PORT_SPACING / 2));
	});
}

/**
 * Count, for one grid step, the routed segments it overlaps and those it runs
 * beside closer than `gap`, without scanning every segment: only segments near
 * the step's fixed coordinate qualify.
 */
function segmentOverlapLookup(segments: readonly RouteSegment[], gap: number) {
	const byOrientation = new Map<AxisAlignedSegment["orientation"], RouteSegment[]>([
		["horizontal", []],
		["vertical", []],
	]);
	for (const segment of segments) byOrientation.get(segment.orientation)!.push(segment);
	for (const list of byOrientation.values())
		list.sort((a, b) => a.staticCoordinate - b.staticCoordinate);
	return (candidate: AxisAlignedSegment, arrowId: string): { beside: number; overlaps: number } => {
		const list = byOrientation.get(candidate.orientation)!;
		// Widen the window past the overlap tolerance; segmentsOverlapInterior decides.
		const reach = Math.max(gap, 2 * AXIS_ALIGNED_EPSILON);
		let low = 0;
		let high = list.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (list[middle]!.staticCoordinate < candidate.staticCoordinate - reach) low = middle + 1;
			else high = middle;
		}
		let overlaps = 0;
		let beside = 0;
		for (
			let index = low;
			index < list.length && list[index]!.staticCoordinate <= candidate.staticCoordinate + reach;
			index += 1
		) {
			const segment = list[index]!;
			if (segment.arrowId === arrowId) continue;
			if (segmentsOverlapInterior(candidate, segment)) overlaps += 1;
			else if (
				Math.abs(segment.staticCoordinate - candidate.staticCoordinate) < gap &&
				segmentOverlapLength(candidate, segment) > AXIS_ALIGNED_EPSILON
			)
				beside += 1;
		}
		return { beside, overlaps };
	};
}

/**
 * Binary-heap open list for the grid search. It pops the lowest estimate and,
 * among equal estimates, the most recently queued step. Effect TxPriorityQueue
 * is a transactional sorted Chunk; this bounded pure search needs heap updates.
 */
function stepQueue<T extends { readonly estimate: number }>() {
	const heap: { item: T; order: number }[] = [];
	let queued = 0;
	const before = (a: { item: T; order: number }, b: { item: T; order: number }) =>
		a.item.estimate < b.item.estimate || (a.item.estimate === b.item.estimate && a.order > b.order);
	const swap = (i: number, j: number) => {
		[heap[i], heap[j]] = [heap[j]!, heap[i]!];
	};
	return {
		get size() {
			return heap.length;
		},
		push(item: T) {
			heap.push({ item, order: queued++ });
			for (let i = heap.length - 1; i > 0;) {
				const parent = (i - 1) >> 1;
				if (!before(heap[i]!, heap[parent]!)) break;
				swap(i, parent);
				i = parent;
			}
		},
		pop(): T {
			const top = heap[0]!;
			const last = heap.pop()!;
			if (heap.length > 0) {
				heap[0] = last;
				for (let i = 0; ;) {
					const left = 2 * i + 1;
					const right = left + 1;
					let next = i;
					if (left < heap.length && before(heap[left]!, heap[next]!)) next = left;
					if (right < heap.length && before(heap[right]!, heap[next]!)) next = right;
					if (next === i) break;
					swap(i, next);
					i = next;
				}
			}
			return top.item;
		},
	};
}

/**
 * Variants of a route whose middle runs move just clear of a parallel neighbor
 * they would otherwise read as one line with. The endpoint stubs stay fixed.
 */
function lanesClearOfNeighbors(
	points: readonly [ScenePoint, ...ScenePoint[]],
	segments: readonly RouteSegment[],
	route: RoutedEdge,
	gap: number,
): [ScenePoint, ...ScenePoint[]][] {
	const arrowId = `edge:${route.edge.id}`;
	const variants: [ScenePoint, ...ScenePoint[]][] = [];
	for (const run of segmentsFromPoints(points)) {
		if (run.isFirstSegment || run.isLastSegment) continue;
		for (const other of segments) {
			if (
				other.arrowId === arrowId ||
				other.orientation !== run.orientation ||
				Math.abs(other.staticCoordinate - run.staticCoordinate) >= gap ||
				segmentOverlapLength(run, other) <= AXIS_ALIGNED_EPSILON
			)
				continue;
			for (const lane of [other.staticCoordinate - gap - 1, other.staticCoordinate + gap + 1]) {
				const moved = points.map((point, index) =>
					index === run.segmentIndex || index === run.segmentIndex + 1
						? run.orientation === "horizontal"
							? { x: point.x, y: lane }
							: { x: lane, y: point.y }
						: point,
				);
				variants.push(compactPoints(moved));
			}
		}
	}
	return variants;
}

/**
 * Variants of a route whose middle runs that pass too close to a node's
 * outline move just clear of it, to either side of the node; given the
 * corridor gap, those that run alongside a node move out by the gap. A run moves whole,
 * from turn to turn, so the runs beside it stay straight, and a variant that
 * shortens either endpoint stub or turns it back is not offered.
 */
export function runsClearOfOutlines(
	points: readonly [ScenePoint, ...ScenePoint[]],
	shapes: readonly NodeSceneElement[],
	ignoredNodeIds: ReadonlySet<string>,
	alongside?: Alongside,
): [ScenePoint, ...ScenePoint[]][] {
	const corners = straightRuns(points);
	const variants: [ScenePoint, ...ScenePoint[]][] = [];
	for (const run of segmentsFromPoints(corners)) {
		if (run.isFirstSegment || run.isLastSegment) continue;
		for (const shape of shapes) {
			if (
				!keepsClearOf(shape, ignoredNodeIds) ||
				segmentCrossesBoundsInterior(run, shape) ||
				!(alongside
					? segmentAlongside(run, shape, alongside)
					: segmentNearOutline(run, shape, NODE_CLEARANCE))
			)
				continue;
			const clearance = alongside ? alongside.gap : NODE_CLEARANCE;
			const [low, size] =
				run.orientation === "horizontal" ? [shape.y, shape.height] : [shape.x, shape.width];
			for (const lane of [low - clearance - 1, low + size + clearance + 1]) {
				const moved = corners.map((point, index) =>
					index === run.segmentIndex || index === run.segmentIndex + 1
						? run.orientation === "horizontal"
							? { x: point.x, y: lane }
							: { x: lane, y: point.y }
						: point,
				);
				if (keepsStubs(corners, moved)) variants.push(compactPoints(moved));
			}
		}
	}
	return variants;
}

/** Whether every run of a route is axis-aligned. */
export function orthogonalRoute(points: readonly ScenePoint[]): boolean {
	return points.every(
		(point, index) =>
			index === 0 ||
			Math.abs(point.x - points[index - 1]!.x) <= AXIS_ALIGNED_EPSILON ||
			Math.abs(point.y - points[index - 1]!.y) <= AXIS_ALIGNED_EPSILON,
	);
}

/**
 * Whether a moved route stays orthogonal and still leaves and arrives by its
 * stubs: its first and last runs keep their direction and at least the
 * length they had, up to a stub's.
 */
export function keepsStubs(route: readonly ScenePoint[], moved: readonly ScenePoint[]): boolean {
	if (moved.length !== route.length || !orthogonalRoute(moved)) return false;
	const stub = (points: readonly ScenePoint[], from: number, to: number) => ({
		dx: points[to]!.x - points[from]!.x,
		dy: points[to]!.y - points[from]!.y,
	});
	const last = route.length - 1;
	return (
		[
			[0, 1],
			[last, last - 1],
		] as const
	).every(([from, to]) => {
		const [before, after] = [stub(route, from, to), stub(moved, from, to)];
		const length = Math.abs(before.dx) + Math.abs(before.dy);
		return (
			Math.sign(after.dx) === Math.sign(before.dx) &&
			Math.sign(after.dy) === Math.sign(before.dy) &&
			Math.abs(after.dx) + Math.abs(after.dy) >=
				Math.min(length, ROUTE_STUB_LENGTH) - AXIS_ALIGNED_EPSILON
		);
	});
}

/** A visibility grid is the fallback when one exterior lane cannot clear every obstacle.
 * Neighbors and turn costs are discovered as needed, with an expansion limit.
 * Effect Graph.astar requires a materialized graph and scans all edge costs;
 * it has no lazy-neighbor or expansion-budget hook for this geometry search. */
function obstacleRoute(
	start: ScenePoint,
	end: ScenePoint,
	startStub: ScenePoint,
	endStub: ScenePoint,
	shapes: readonly NodeSceneElement[],
	route: RoutedEdge,
	arrows: readonly ArrowSceneElement[],
	arrowSegments: readonly RouteSegment[],
	outlineSegments: readonly RouteSegment[],
	corridorGap = 0,
	maxSteps = Infinity,
	guided = true,
	crossings?: CrossingLookup,
	borders = false,
	heads?: RoutedSoFar["heads"],
	touches?: TouchGrid,
): [ScenePoint, ...ScenePoint[]] | undefined {
	// With a corridor gap, also offer lanes far enough from each routed point to read apart,
	// and with a touch gap, lanes clear of each turn and end.
	const lanes = (coordinate: number) =>
		[
			...new Set([
				PORT_SPACING,
				Math.max(PORT_SPACING, corridorGap + 1),
				Math.max(PORT_SPACING, (touches?.gap ?? 0) + 1),
			]),
		].flatMap((offset) => [coordinate - offset, coordinate + offset]);
	const xs = [
		...new Set([
			startStub.x,
			endStub.x,
			...shapes.flatMap((s) => [s.x - PORT_SPACING, s.x + s.width + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => lanes(p.x))),
		]),
	].sort((a, b) => a - b);
	const ys = [
		...new Set([
			startStub.y,
			endStub.y,
			...shapes.flatMap((s) => [s.y - PORT_SPACING, s.y + s.height + PORT_SPACING]),
			...arrows.flatMap((a) => a.points.flatMap((p) => lanes(p.y))),
		]),
	].sort((a, b) => a - b);
	const key = (x: number, y: number, axis: number) => (x * ys.length + y) * 2 + axis;
	const arrowId = `edge:${route.edge.id}`;
	const nearby = segmentOverlapLookup(arrowSegments, corridorGap);
	const [frameOutlines, laneOutlines] = [false, true].map((lane) =>
		outlineSegments.filter((segment) => segment.arrowId.startsWith(LANE_OUTLINE) === lane),
	);
	const nearOutline =
		frameOutlines!.length > 0
			? segmentOverlapLookup(frameOutlines!, GROUP_OUTLINE_CLEARANCE)
			: undefined;
	const nearLane =
		laneOutlines!.length > 0
			? segmentOverlapLookup(laneOutlines!, LANE_OUTLINE_CLEARANCE)
			: undefined;
	const stubs = [...segmentsFromPoints([start, startStub]), ...segmentsFromPoints([endStub, end])];
	type Step = {
		x: number;
		y: number;
		axis: number;
		cost: number;
		estimate: number;
		previous?: Step;
	};
	// Every step costs at least its length, so the Manhattan distance to the arrival
	// stub never overestimates: A* finds the same lowest cost while expanding less.
	// Unguided, the search expands in pure cost order like the plain router.
	const remaining = (x: number, y: number) =>
		guided ? Math.abs(xs[x]! - endStub.x) + Math.abs(ys[y]! - endStub.y) : 0;
	const initialX = xs.indexOf(startStub.x);
	const initialY = ys.indexOf(startStub.y);
	const initial: Step = {
		x: initialX,
		y: initialY,
		axis: start.x === startStub.x ? 1 : 0,
		cost: 0,
		estimate: remaining(initialX, initialY),
	};
	// The shapes each grid line runs through the interior of, found on the line's
	// first step: a step along a line can cross only those, so it tests no other.
	const through = (lines: readonly number[], axis: "x" | "y") => {
		const size = axis === "x" ? "width" : "height";
		const found: (readonly NodeSceneElement[] | undefined)[] = [];
		// With borders held, a line on a node's side passes along it too.
		const margin = borders ? -AXIS_ALIGNED_EPSILON : AXIS_ALIGNED_EPSILON;
		return (index: number) =>
			(found[index] ??= shapes.filter(
				(shape) =>
					lines[index]! > shape[axis] + margin &&
					lines[index]! < shape[axis] + shape[size] - margin,
			));
	};
	const [throughX, throughY] = [through(xs, "x"), through(ys, "y")];
	const pending = stepQueue<Step>();
	pending.push(initial);
	const costs = new Map<number, number>([[key(initial.x, initial.y, initial.axis), 0]]);
	// Each grid edge's obstacle test and length, computed once however often it is relaxed.
	const edgeCosts = new Map<number, number | undefined>();
	// What turning at each grid point costs beyond the turn itself, computed once.
	const turnCosts = new Map<number, number>();
	const turnCost = (x: number, y: number, point: ScenePoint) => {
		if (!touches) return 0;
		const at = x * ys.length + y;
		let cost = turnCosts.get(at);
		if (cost === undefined) {
			cost = touches.turn(point, arrowId) * TOUCH_COST;
			turnCosts.set(at, cost);
		}
		return cost;
	};
	for (let steps = 0; pending.size && steps < maxSteps; steps += 1) {
		const current = pending.pop();
		if (current.cost !== costs.get(key(current.x, current.y, current.axis))) continue;
		const point = { x: xs[current.x]!, y: ys[current.y]! };
		if (point.x === endStub.x && point.y === endStub.y) {
			const path: ScenePoint[] = [];
			for (let step: Step | undefined = current; step; step = step.previous)
				path.unshift({ x: xs[step.x]!, y: ys[step.y]! });
			const corners = path.filter(
				(p, i) =>
					i === 0 ||
					i === path.length - 1 ||
					!(
						(path[i - 1]!.x === p.x && p.x === path[i + 1]!.x) ||
						(path[i - 1]!.y === p.y && p.y === path[i + 1]!.y)
					),
			);
			return compactPoints([start, ...corners, end]);
		}
		for (const [dx, dy, axis] of [
			[-1, 0, 0],
			[1, 0, 0],
			[0, -1, 1],
			[0, 1, 1],
		] as const) {
			const x = current.x + dx,
				y = current.y + dy;
			if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
			const next = { x: xs[x]!, y: ys[y]! };
			const gridEdge = (Math.min(x, current.x) * ys.length + Math.min(y, current.y)) * 2 + axis;
			if (!edgeCosts.has(gridEdge)) {
				const segment = segmentsFromPoints([point, next], 0)[0]!;
				const step = segmentsFromPoints([point, next])[0];
				const { beside, overlaps } = step ? nearby(step, arrowId) : { beside: 0, overlaps: 0 };
				const outline = step && nearOutline ? nearOutline(step, arrowId) : undefined;
				const lane = step && nearLane ? nearLane(step, arrowId) : undefined;
				edgeCosts.set(
					gridEdge,
					(axis === 0 ? throughY(current.y) : throughX(current.x)).some(
						(shape) =>
							segmentCrossesBoundsInterior(segment, shape) ||
							(borders && shape.id.startsWith("node:") && segmentAlongBorder(segment, shape)),
					) ||
						// Neither the departure nor the arrival may double back over its port stub.
						stubs.some((stub) => segmentsOverlapInterior(segment, stub))
						? undefined
						: Math.abs(next.x - point.x) +
								Math.abs(next.y - point.y) +
								overlaps * 10000 +
								beside * 1000 +
								(outline ? (outline.beside + outline.overlaps) * 1000 : 0) +
								(lane ? (lane.beside + lane.overlaps) * 1000 : 0) +
								// Through another line's head costs as much as overlapping it.
								(heads ? heads(point, next, arrowId) * 10000 : 0) +
								(touches ? touches.step(point, next, arrowId) * TOUCH_COST : 0) +
								(crossings && step
									? crossings.step(
											step.orientation,
											step.staticCoordinate,
											step.min,
											step.max,
											arrowId,
										) * CROSSING_COST
									: 0),
				);
			}
			const edgeCost = edgeCosts.get(gridEdge);
			if (edgeCost === undefined) continue;
			const cost =
				current.cost +
				edgeCost +
				(axis === current.axis ? 0 : 24 + turnCost(current.x, current.y, point));
			const id = key(x, y, axis);
			if (cost >= (costs.get(id) ?? Infinity)) continue;
			costs.set(id, cost);
			pending.push({ x, y, axis, cost, estimate: cost + remaining(x, y), previous: current });
		}
	}
	return undefined;
}

function exteriorLaneRoute(
	route: RoutedEdge,
	start: ScenePoint,
	end: ScenePoint,
	shapes: readonly NodeSceneElement[],
	existingArrows: readonly ArrowSceneElement[],
	{
		avoidCrossings,
		clearHeads,
		clearTouches,
		readerScale,
		guided,
		bandOf,
		groups,
		lanes: laneLayout,
		midway,
	}: RouteOptions,
): [ScenePoint, ...ScenePoint[]] {
	const horizontalDominant = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
	const ignoredNodeIds = new Set([route.source.nodeId, route.target.nodeId]);
	const band = bandOf?.get(route.source.nodeId);
	const extent =
		band === undefined ? shapes : shapes.filter((shape) => bandOf!.get(shape.nodeId) === band);
	const minX = Math.min(...extent.map((shape) => shape.x));
	const maxX = Math.max(...extent.map((shape) => shape.x + shape.width));
	const minY = Math.min(...extent.map((shape) => shape.y));
	const maxY = Math.max(...extent.map((shape) => shape.y + shape.height));
	const useLeftLane =
		route.sourceEdge === "left" ||
		route.targetEdge === "left" ||
		center(route.target).x < center(route.source).x;
	const useUpperLane = center(route.target).y < center(route.source).y;
	const laneOffset = route.index * PORT_SPACING;
	const leftLaneX = minX - HORIZONTAL_GAP / 2 - laneOffset;
	const rightLaneX = maxX + HORIZONTAL_GAP / 2 + laneOffset;
	const upperLaneY = minY - VERTICAL_GAP / 2 - laneOffset;
	const lowerLaneY = maxY + VERTICAL_GAP / 2 + laneOffset;
	const localLaneOffset = ((route.index % 4) * PORT_SPACING) / 2;
	const localLeftLaneX =
		Math.min(route.source.x, route.target.x) - HORIZONTAL_GAP / 2 - localLaneOffset;
	const localRightLaneX =
		Math.max(route.source.x + route.source.width, route.target.x + route.target.width) +
		HORIZONTAL_GAP / 2 +
		localLaneOffset;
	const localUpperLaneY =
		Math.min(route.source.y, route.target.y) - VERTICAL_GAP / 2 - localLaneOffset;
	const localLowerLaneY =
		Math.max(route.source.y + route.source.height, route.target.y + route.target.height) +
		VERTICAL_GAP / 2 +
		localLaneOffset;
	const preferredX = useLeftLane ? leftLaneX : rightLaneX;
	const alternateX = useLeftLane ? rightLaneX : leftLaneX;
	const preferredY = useUpperLane ? upperLaneY : lowerLaneY;
	const alternateY = useUpperLane ? lowerLaneY : upperLaneY;
	const preferredLocalX = useLeftLane ? localLeftLaneX : localRightLaneX;
	const alternateLocalX = useLeftLane ? localRightLaneX : localLeftLaneX;
	const preferredLocalY = useUpperLane ? localUpperLaneY : localLowerLaneY;
	const alternateLocalY = useUpperLane ? localLowerLaneY : localUpperLaneY;
	const localStubDistance = ROUTE_STUB_LENGTH + (route.index % 4) * PORT_SPACING;
	// Staggered stubs separate parallel lanes; the plain stub can turn clear of nearby arrowheads.
	const stubDistances =
		readerScale === undefined
			? [localStubDistance]
			: [...new Set([localStubDistance, ROUTE_STUB_LENGTH])];
	const routeForVerticalLane = (laneX: number, stubDistance: number) => {
		const startStub =
			stubDistance > 0
				? pointAwayFromEdge(
						start,
						route.sourceEdge,
						sourceStubLength(route, start, ROUTE_STUB_LENGTH),
					)
				: start;
		const endStub =
			stubDistance > 0
				? pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, stubDistance))
				: end;

		return compactPoints([
			start,
			startStub,
			{ x: laneX, y: startStub.y },
			{ x: laneX, y: endStub.y },
			endStub,
			end,
		]);
	};
	const routeForHorizontalLane = (laneY: number, stubDistance: number) => {
		const startStub =
			stubDistance > 0
				? pointAwayFromEdge(
						start,
						route.sourceEdge,
						sourceStubLength(route, start, ROUTE_STUB_LENGTH),
					)
				: start;
		const endStub =
			stubDistance > 0
				? pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, stubDistance))
				: end;

		return compactPoints([
			start,
			startStub,
			{ x: startStub.x, y: laneY },
			{ x: endStub.x, y: laneY },
			endStub,
			end,
		]);
	};
	type LaneGenerator = (lane: number, stubDistance: number) => [ScenePoint, ...ScenePoint[]];
	const horizontalLanes: readonly (readonly [number, LaneGenerator])[] = [
		[preferredLocalY, routeForHorizontalLane],
		[alternateLocalY, routeForHorizontalLane],
		[preferredY, routeForHorizontalLane],
		[alternateY, routeForHorizontalLane],
	];
	const verticalLanes: readonly (readonly [number, LaneGenerator])[] = [
		[preferredLocalX, routeForVerticalLane],
		[alternateLocalX, routeForVerticalLane],
		[preferredX, routeForVerticalLane],
		[alternateX, routeForVerticalLane],
	];
	const [preferredLanes, alternateLanes] = horizontalDominant
		? [horizontalLanes, verticalLanes]
		: [verticalLanes, horizontalLanes];
	const lanes = [
		...preferredLanes.slice(0, 2),
		...alternateLanes.slice(0, 2),
		...preferredLanes.slice(2),
		...alternateLanes.slice(2),
	];
	const startStub = pointAwayFromEdge(
		start,
		route.sourceEdge,
		sourceStubLength(route, start, ROUTE_STUB_LENGTH),
	);
	const endStub = pointAwayFromEdge(
		end,
		route.targetEdge,
		targetStubLength(route, end, ROUTE_STUB_LENGTH),
	);
	const bandLane = route.lane;
	const continuation = bandLane
		? stubDistances.map((distance) =>
				bandLane.vertical
					? routeForVerticalLane(bandLane.at, distance)
					: routeForHorizontalLane(bandLane.at, distance),
			)
		: [];
	// A pinned line, a handoff straight across a lane boundary, or, in the
	// drawn layout's polish, any line between facing sides may step across
	// midway, a bend clear of both ports rather than a jog beside one, or on
	// a lane boundary.
	const facing =
		route.targetEdge === OPPOSITE_EDGE[route.sourceEdge] &&
		(route.pinned !== undefined ||
			(laneLayout !== undefined ? straightHandoff(route, laneLayout) : midway === true));
	const middle =
		route.sourceEdge === "left" || route.sourceEdge === "right"
			? [
					{ x: (startStub.x + endStub.x) / 2, y: startStub.y },
					{ x: (startStub.x + endStub.x) / 2, y: endStub.y },
				]
			: [
					{ x: startStub.x, y: (startStub.y + endStub.y) / 2 },
					{ x: endStub.x, y: (startStub.y + endStub.y) / 2 },
				];
	const candidates = [
		...continuation,
		compactPoints([start, end]),
		compactPoints([start, startStub, { x: startStub.x, y: endStub.y }, endStub, end]),
		compactPoints([start, startStub, { x: endStub.x, y: startStub.y }, endStub, end]),
		...(facing ? [compactPoints([start, startStub, ...middle, endStub, end])] : []),
		...lanes.flatMap(([lane, generator]) =>
			stubDistances.map((distance) => generator(lane, distance)),
		),
	];

	// A skipping line's own lane, preferred wherever it draws as cleanly: in
	// line with either end first, so it runs straight on from its port.
	const skipLane = route.skipLane;
	const laneRoute = (at: number) => {
		const { vertical, leave, enter } = skipLane!;
		const point = (along: number, across: number) =>
			vertical ? { x: across, y: along } : { x: along, y: across };
		const [startAlong, startAcross, endAlong, endAcross] = vertical
			? [startStub.y, startStub.x, endStub.y, endStub.x]
			: [startStub.x, startStub.y, endStub.x, endStub.y];
		// An end that faces along the flow turns midway across its gap; one on a
		// side turns at its stub.
		const leavesAlong = slotAxis(route.sourceEdge) === (vertical ? "x" : "y");
		const entersAlong = slotAxis(route.targetEdge) === (vertical ? "x" : "y");
		return compactPoints([
			start,
			startStub,
			...(leavesAlong ? [point(leave, startAcross), point(leave, at)] : [point(startAlong, at)]),
			...(entersAlong ? [point(enter, at), point(enter, endAcross)] : [point(endAlong, at)]),
			endStub,
			end,
		]);
	};
	const laneRoutes = skipLane
		? [
				...new Set(
					skipLane.vertical
						? [startStub.x, endStub.x, skipLane.at]
						: [startStub.y, endStub.y, skipLane.at],
				),
			].map(laneRoute)
		: [];
	const ends = [route.source.nodeId, route.target.nodeId];
	const sharesNode = (arrow: ArrowSceneElement) =>
		ends.includes(arrow.sourceNodeId) || ends.includes(arrow.targetNodeId);
	const routed = routedSoFar(
		existingArrows,
		readerScale,
		avoidCrossings,
		clearHeads,
		route.besideShared === undefined ? undefined : { of: sharesNode, gap: route.besideShared },
		clearTouches,
	);
	// Among zones, or between boxes a family placed (tables, classes), a run
	// along a node's border reads as part of the node.
	const strict = groups?.zoned === true || route.pinned !== undefined;
	const first = chooseBestRoute(
		candidates,
		shapes,
		ignoredNodeIds,
		route,
		routed,
		strict,
		laneRoutes,
	);
	const gap = readerScale === undefined ? 0 : routingCorridorGap(readerScale);
	const best = gap
		? chooseBestRoute(
				[first, ...lanesClearOfNeighbors(first, routed.segments, route, gap)],
				shapes,
				ignoredNodeIds,
				route,
				routed,
				strict,
			)
		: first;
	const quality = (points: [ScenePoint, ...ScenePoint[]]) =>
		routed.quality?.({
			id: `edge:${route.edge.id}`,
			points,
			sourceId: route.edge.source,
			targetId: route.edge.target,
		}) ?? { arrowheadsCrossed: 0, corridors: 0, jogs: 0 };
	// A run along a node's border, like a corridor, is polish: a bounded search fixes it.
	const border = strict && routeBorderRunCount(best, shapes, ignoredNodeIds) > 0;
	const hard =
		routeNodeCrossingCount(best, shapes, ignoredNodeIds) ||
		routeSelfOverlapCount(best, route) ||
		routeArrowOverlapCount(best, routed.segments, route) ||
		(routed.heads !== undefined && quality(best).arrowheadsCrossed) ||
		routeOutlineBesideCount(best, routed.outlines);
	// A pinned line that runs out past its target, around everything between, may
	// find a way between the nodes instead.
	const wanders =
		route.pinned !== undefined &&
		routeBacktrackDistance(best) + routeTargetOvershootDistance(best) > 0;
	// Bending clear of other lines first, a line that touches one searches the
	// whole grid, for lanes that also read apart.
	const touching = routeTouchCount(best, route, routed) > 0;
	if (hard || touching || border || quality(best).corridors || wanders) {
		// Search lanes that read apart only when a corridor is what remains to fix.
		const detour = obstacleRoute(
			start,
			end,
			startStub,
			endStub,
			shapes,
			route,
			existingArrows,
			routed.segments,
			routed.outlines,
			// Bending clear of other lines, lanes that read apart are searched for too.
			hard && !clearTouches ? 0 : gap,
			// A corridor or a crossing is polish: search a bounded neighborhood, never the whole grid.
			hard ? Infinity : CORRIDOR_SEARCH_STEPS,
			guided,
			routed.crossings,
			strict,
			routed.heads,
			routed.touchGrid,
		);
		if (detour)
			return chooseBestRoute([best, detour], shapes, ignoredNodeIds, route, routed, strict);
	}
	return best;
}

/** Route every edge in order; each avoids earlier routes and every reserved endpoint stub. */
export function routeAllEdges(
	routes: readonly RoutedEdge[],
	edgeRouting: GraphInput["layout"]["edgeRouting"],
	portOffsets: ReadonlyMap<string, number>,
	nodeShapes: readonly NodeSceneElement[],
	options: RouteOptions,
	order: readonly number[] = routes.map((_, index) => index),
	fixed: ReadonlyMap<string, ArrowSceneElement> = new Map(),
): ArrowSceneElement[] {
	const labelObstacles = [
		...branchLabelObstacles(routes, portOffsets),
		...loopObstacles(routes, portOffsets),
	];
	const endpointStubs =
		edgeRouting === "orthogonal" ? endpointStubsForRoutes(routes, portOffsets) : [];
	// Frame outlines and lane boundaries are lines routes keep apart from, as from each other.
	const outlines = [...groupOutlineLines(options.groups), ...laneOutlineLines(options.lanes)];
	const lanes = laneObstacles(options.lanes);
	const passage = laneObstacles(options.lanes, true);
	const edgeArrows: ArrowSceneElement[] = [];
	for (const route of order.map((index) => routes[index]!)) {
		const kept = fixed.get(route.edge.id);
		if (kept) {
			edgeArrows.push(kept);
			continue;
		}
		edgeArrows.push(
			arrowForRoute(
				route,
				edgeRouting,
				portOffsets,
				[
					...nodeShapes,
					...labelObstacles.filter(
						(label) =>
							label.nodeId !== `branch-label:${route.edge.id}` &&
							label.nodeId !== `loop:${route.edge.id}`,
					),
					...groupObstacles(options.groups, route),
					...(options.lanes?.continuations.has(route.edge.id) ? passage : lanes),
				],
				[...outlines, ...endpointStubs, ...edgeArrows],
				options,
			),
		);
	}
	// Hand arrows back in edge order so labels and z-order follow the diagram.
	return routes.map((route) => edgeArrows.find((arrow) => arrow.edgeId === route.edge.id)!);
}

/**
 * Touching lines few enough to route again, together and one at a time, each
 * after all the others; a graph with more is too tangled for that to clear.
 */
export const TOUCH_MOVES = 6;

/** Rounds of clearing touching lines, each kept only where it touches fewer. */
export const TOUCH_ROUNDS = 2;

/** Candidates a round of clearing touching lines draws in full, clearest first. */
export const TOUCH_DRAWINGS = 3;

/** Reroutes allowed after a layout still has an export defect. */
const MAX_REROUTES = 4;

/**
 * Rip up and reroute: when routes still overlap or cross a node, route the later
 * edge of the first defect before the earlier one (or first, for a node crossing)
 * and keep the order only if the export defects drop.
 */
export function rerouteDefects(
	arrows: ArrowSceneElement[],
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
	nodeShapes: readonly NodeSceneElement[],
	options: RouteOptions,
): ArrowSceneElement[] {
	let defects = exportRouteDefects(arrows, nodeShapes, options.groups, options.lanes);
	let order = routes.map((_, index) => index);
	for (let attempt = 0; attempt < MAX_REROUTES && defects.length > 0; attempt += 1) {
		const position = (arrowId: string) =>
			order.findIndex((index) => `edge:${routes[index]!.edge.id}` === arrowId);
		const [first, second] = defects[0]!;
		const [earlier, later] =
			second === undefined
				? [0, position(first)]
				: [
						Math.min(position(first), position(second)),
						Math.max(position(first), position(second)),
					];
		if (later <= earlier) break;
		const next = [...order];
		next.splice(earlier, 0, ...next.splice(later, 1));
		const retry = routeAllEdges(routes, "orthogonal", portOffsets, nodeShapes, options, next);
		const retryDefects = exportRouteDefects(retry, nodeShapes, options.groups, options.lanes);
		if (retryDefects.length >= defects.length) break;
		[arrows, defects, order] = [retry, retryDefects, next];
	}
	return arrows;
}

/** How many lines leave or arrive by each side of each node, by port key. */
export function sideEnds(routes: readonly RoutedEdge[]): Map<string, number> {
	const ends = new Map<string, number>();
	for (const route of routes)
		for (const key of [
			portKey(route.source.nodeId, route.sourceEdge),
			portKey(route.target.nodeId, route.targetEdge),
		])
			ends.set(key, (ends.get(key) ?? 0) + 1);
	return ends;
}

/**
 * Whether a line turns over its target's corner into a side another line meets
 * the target by: its last run before a short stub starts beyond the target.
 */
export function turnsCorner(
	route: RoutedEdge,
	arrow: ArrowSceneElement,
	ends: ReadonlyMap<string, number>,
): boolean {
	if ((ends.get(portKey(route.target.nodeId, route.targetEdge)) ?? 0) < 2) return false;
	const corners = straightRuns(arrow.points);
	if (corners.length < 3) return false;
	const [from, turn, end] = corners.slice(-3) as [ScenePoint, ScenePoint, ScenePoint];
	if (Math.abs(end.x - turn.x) + Math.abs(end.y - turn.y) >= 2 * ROUTE_STUB_LENGTH) return false;
	const { target } = route;
	const [at, low, size] =
		Math.abs(from.y - turn.y) <= AXIS_ALIGNED_EPSILON
			? [from.x, target.x, target.width]
			: [from.y, target.y, target.height];
	return at < low - AXIS_ALIGNED_EPSILON || at > low + size + AXIS_ALIGNED_EPSILON;
}

/**
 * A forward edge that hooks sideways just before its arrowhead, crosses
 * another arrow on its final approach, or, `cornered`, turns over its target's
 * corner from beyond it into a side another line meets the target by, reads
 * better entering the free side its last run already approaches. Returns the
 * routes it moved with their previous sides.
 */
export function resideArrivals(
	layoutGraph: GraphLayout,
	routes: readonly RoutedEdge[],
	arrows: readonly ArrowSceneElement[],
	scale: number,
	trigger: "hooked" | "crossed" | "cornered",
): { route: RoutedEdge; side: ConnectionEdge }[] {
	const feedback = layoutGraph.feedback;
	const ends = sideEnds(routes);
	const used = new Set(ends.keys());
	const resided: { route: RoutedEdge; side: ConnectionEdge }[] = [];
	for (const [index, arrow] of arrows.entries()) {
		const route = routes[index]!;
		if (feedback.has(route.edge.id) || route.pinned?.target !== undefined) continue;
		const moves =
			trigger === "hooked"
				? routingQualityFindings([{ id: arrow.id, points: arrow.points }], scale).some(
						(finding) => finding.kind === "endpoint-jog" && finding.endpoint === "end",
					)
				: trigger === "cornered"
					? turnsCorner(route, arrow, ends)
					: arrows.some(
							(other) =>
								other !== arrow &&
								// Only a crossing between the turns of the final approach moves it.
								pathCrossings(arrow.points, other.points, arrow.points.length - 3, false) > 0,
						);
		if (!moves) continue;
		const segments = segmentsFromPoints(arrow.points);
		const last = segments.at(-1);
		const step = segments.findLast((segment) => segment.orientation !== last?.orientation);
		if (!last || !step) continue;
		const from = arrow.points[step.segmentIndex]!;
		const to = arrow.points[step.segmentIndex + 1]!;
		const side: ConnectionEdge =
			step.orientation === "horizontal"
				? to.x > from.x
					? "left"
					: "right"
				: to.y > from.y
					? "top"
					: "bottom";
		if (side === route.targetEdge || used.has(portKey(route.target.nodeId, side))) continue;
		resided.push({ route, side: route.targetEdge });
		used.add(portKey(route.target.nodeId, side));
		route.targetEdge = side;
	}
	return resided;
}

/** Grid-search expansions spent looking for a lane clear of a near-parallel neighbor. */
export const CORRIDOR_SEARCH_STEPS = 5_000;

/** Grid-search cost of crossing another arrow: a detour this much longer reads better. */
export const CROSSING_COST = 320;

/**
 * Grid-search cost of a turn on another line, or a step past another line's
 * turn or end: the two read as one line that forks there, worse than crossing.
 */
export const TOUCH_COST = 1000;
