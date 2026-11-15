import {
	type DiagramLayout,
	type ConnectionEdge,
	type RoutedEdge,
	type GroupLayout,
	type SideMove,
	type SettledLayout,
	type RoutingPolish,
	type LayoutDirection,
	type CompletedLayout,
} from "./layout-types.js";
import {
	straightRuns,
	routeLength,
	routeBendCount,
	drawnSize,
	compactPoints,
	routeClearanceCount,
} from "./route-geometry.js";
import {
	ROUTE_STUB_LENGTH,
	slotAxis,
	OPPOSITE_EDGE,
	isSelfLoop,
	center,
	EDGE_NORMAL,
	routeEndpoints,
	connectionKey,
	FORWARD_SIDE,
	pointAwayFromEdge,
	pointOnEdge,
	PORT_SPACING,
	curvedSide,
	PORT_PADDING,
	clamp,
	portJogSteps,
} from "./geometry.js";
import {
	segmentsFromPoints,
	type CanvasConnectorElement as ArrowSceneElement,
	type CanvasPoint as ScenePoint,
	AXIS_ALIGNED_EPSILON,
	type CanvasShapeElement as NodeSceneElement,
	routingQualityScale,
	routingQualityFindings,
	canvasCornerRadius,
	routingJogReach,
	routingWideBend,
	sharedSegments,
} from "@sketchi/drawing";
import { laned, ACROSS_DIRECTION, CROSSING_REPAIR_MAX_EDGES } from "./placement.js";
import { branches } from "./measure.js";
import { type GraphLayout } from "./topology.js";
import { type IntermediateDiagram } from "./intermediate.js";
import { portOffsetsAt, portOrderOf, layoutDiagram, portJogCount } from "./layout.js";
import { routeAllEdges, sideEnds, turnsCorner, resideArrivals, keepsStubs } from "./routing.js";
import {
	arrowCrossings,
	routesNoWorse,
	detouredLines,
	headCrossers,
	exportAspect,
	readerFindingCount,
} from "./readability.js";
import { type GraphRenderOptions } from "./options.js";
import { groupBlocks, groupObstacles, laneBlocks } from "./containers.js";
import { portLimit, directSegmentCrossesNode, branchLabelObstacles } from "./ports.js";
import { placedBranchLabels, branchLabels } from "./labels.js";

/**
 * How much longer a drawing may grow, its text shrinking as much once fitted,
 * to draw fewer crossings (Arrangement.skipLanes, Arrangement.throughBlocks);
 * one that still fits a screen's FITTED_LONG_SIDE shrinks no text at all.
 */
export const LONGER_FOR_CROSSINGS = 1.15;

/** Crossings a rival may draw beyond the arranged layout's, before repairs, and still be repaired. */
export const RIVAL_CROSSING_SLACK = 2;

/** Room a branch label may lose, in all, for each crossing a rival removes. */
export const LABEL_ROOM_FOR_CROSSING = 8;

/** Layouts the crossing repair may try beyond the arrangements, each with one side change. */
const CROSSING_MOVES = 6;

/**
 * A layout with more crossings than this is too tangled for side changes to
 * untangle within the moves; the repair leaves it as the arrangements drew it.
 */
export const CROSSING_REPAIR_MAX_CROSSINGS = 6;

/** Moves tried around the remaining crossings before the repair gives up on them. */
const ROUND_MOVES = 3;

/** Side changes screened by routing only the edges they touch. */
const SCREENED_MOVES = 24;

/**
 * Routes that hook around one of their own ends: past its stubs, a run passes
 * close beside the node it leaves or enters, on a side other than the one it
 * leaves or enters by.
 */
export function hookedRoutes(layout: DiagramLayout): number {
	return layout.edgeArrows.filter((arrow, index) => {
		const route = layout.routedEdges[index]!;
		const runs = segmentsFromPoints(straightRuns(arrow.points)).slice(1, -1);
		return (["source", "target"] as const).some((endpoint) => {
			const node = route[endpoint];
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			return runs.some((run) => {
				const [low, size, alongLow, alongSize] =
					run.orientation === "horizontal"
						? [node.y, node.height, node.x, node.width]
						: [node.x, node.width, node.y, node.height];
				const beside =
					run.staticCoordinate < low
						? low - run.staticCoordinate
						: run.staticCoordinate - low - size;
				const passed: ConnectionEdge =
					run.orientation === "horizontal"
						? run.staticCoordinate < low
							? "top"
							: "bottom"
						: run.staticCoordinate < low
							? "left"
							: "right";
				return (
					passed !== side &&
					beside > 0 &&
					beside < 2 * ROUTE_STUB_LENGTH &&
					run.min < alongLow + alongSize &&
					run.max > alongLow
				);
			});
		});
	}).length;
}

/** Each crossing between two arrows, by arrow index, with where it lies. */
function crossingPairs(
	arrows: readonly ArrowSceneElement[],
): { first: number; second: number; at: ScenePoint }[] {
	const runs = arrows.map((arrow) => straightRuns(arrow.points));
	const pairs: { first: number; second: number; at: ScenePoint }[] = [];
	const between = (value: number, p: number, q: number) =>
		value > Math.min(p, q) + AXIS_ALIGNED_EPSILON && value < Math.max(p, q) - AXIS_ALIGNED_EPSILON;
	for (const [first, a] of runs.entries())
		for (const [offset, b] of runs.slice(first + 1).entries())
			for (let i = 0; i + 1 < a.length; i += 1)
				for (let j = 0; j + 1 < b.length; j += 1) {
					const [p, q, r, u] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
					const [h, v] =
						Math.abs(p.y - q.y) <= AXIS_ALIGNED_EPSILON &&
						Math.abs(r.x - u.x) <= AXIS_ALIGNED_EPSILON
							? [
									[p, q],
									[r, u],
								]
							: Math.abs(p.x - q.x) <= AXIS_ALIGNED_EPSILON &&
								  Math.abs(r.y - u.y) <= AXIS_ALIGNED_EPSILON
								? [
										[r, u],
										[p, q],
									]
								: [];
					if (h && v && between(v[0]!.x, h[0]!.x, h[1]!.x) && between(h[0]!.y, v[0]!.y, v[1]!.y))
						pairs.push({ first, second: first + 1 + offset, at: { x: v[0]!.x, y: h[0]!.y } });
				}
	return pairs;
}

/**
 * Side changes that may remove a crossing between two routes: a loop moved to
 * one side of the flow with both its ends there, the two routes trading sides
 * at a node they share, a decision's branches trading vertices, and each end
 * moved to another side, the end nearest the crossing first. No line leaves or
 * arrives by a side along the flow that faces away from its other end, so none
 * leaves a node backward or arrives from beyond it.
 */
function crossingMoves(
	layoutGraph: GraphLayout,
	first: RoutedEdge,
	second: RoutedEdge,
	at: ScenePoint,
	diagram: IntermediateDiagram,
	portOffsets: ReadonlyMap<string, number>,
	routes: readonly RoutedEdge[],
	groups: GroupLayout | undefined,
): SideMove[] {
	const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
	const along = vertical ? "y" : "x";
	const lateral = (side: ConnectionEdge) => slotAxis(side) === along;
	const mirror = (side: ConnectionEdge) => (lateral(side) ? OPPOSITE_EDGE[side] : side);
	const feedback = layoutGraph.feedback;
	const movable = (route: RoutedEdge) =>
		!isSelfLoop(route) && route.pair === undefined && route.pinned === undefined;
	const sideKey = (endpoint: "source" | "target") =>
		endpoint === "source" ? ("sourceEdge" as const) : ("targetEdge" as const);
	// A side along the flow faces the other end; either side across it will do.
	const natural = (route: RoutedEdge, endpoint: "source" | "target", side: ConnectionEdge) => {
		if (lateral(side)) return true;
		const here = center(route[endpoint])[along];
		const there = center(route[endpoint === "source" ? "target" : "source"])[along];
		return EDGE_NORMAL[side][along] * (there - here) > AXIS_ALIGNED_EPSILON;
	};
	const moves: SideMove[] = [];
	// In lanes an arrival never shares a side with a departure, so a line into a
	// step never reads as leaving it.
	const sideOf = (route: RoutedEdge, endpoint: "source" | "target") =>
		move.get(route.edge.id)?.[sideKey(endpoint)] ?? route[sideKey(endpoint)];
	let move: SideMove = new Map();
	const mixesRoles = () =>
		[...move.keys()].some((id) => {
			const route = routes.find((candidate) => candidate.edge.id === id)!;
			return (["source", "target"] as const).some((endpoint) => {
				const other = endpoint === "source" ? "target" : "source";
				const node = route[endpoint];
				const side = sideOf(route, endpoint);
				return routes.some(
					(candidate) =>
						candidate !== route && candidate[other] === node && sideOf(candidate, other) === side,
				);
			});
		});
	const add = (candidate: SideMove) => {
		move = candidate;
		const valid =
			[...candidate].every(([id, change]) => {
				const route = routes.find((other) => other.edge.id === id)!;
				return (
					natural(route, "source", change.sourceEdge ?? route.sourceEdge) &&
					natural(route, "target", change.targetEdge ?? route.targetEdge)
				);
			}) && !(laned(diagram) && mixesRoles());
		if (valid) moves.push(candidate);
	};
	// The side of `node` that faces `other`.
	const facingSide = (node: NodeSceneElement, other: NodeSceneElement): ConnectionEdge => {
		const [here, there] = [center(node), center(other)];
		return Math.abs(there.x - here.x) > Math.abs(there.y - here.y)
			? there.x > here.x
				? "right"
				: "left"
			: there.y > here.y
				? "bottom"
				: "top";
	};
	// A loop runs back along one side of the flow or the other, both ends on that side.
	const sidesAcross: readonly ConnectionEdge[] = vertical ? ["left", "right"] : ["top", "bottom"];
	for (const route of [first, second].filter(movable)) {
		if (!feedback.has(route.edge.id)) continue;
		for (const side of [...sidesAcross].sort((a, b) =>
			a === mirror(route.sourceEdge) ? -1 : b === mirror(route.sourceEdge) ? 1 : 0,
		))
			if (route.sourceEdge !== side || route.targetEdge !== side)
				add(new Map([[route.edge.id, { sourceEdge: side, targetEdge: side }]]));
	}
	if (movable(first) && movable(second))
		for (const a of ["source", "target"] as const)
			for (const b of ["source", "target"] as const) {
				const [sideA, sideB] = [first[sideKey(a)], second[sideKey(b)]];
				if (first[a].nodeId !== second[b].nodeId || sideA === sideB) continue;
				add(
					new Map([
						[first.edge.id, { [sideKey(a)]: sideB }],
						[second.edge.id, { [sideKey(b)]: sideA }],
					]),
				);
			}
	// A decision's branches trade vertices among themselves, and, after every
	// other move, take its free vertex.
	const decisionMoves = (free: boolean, loops = false) => {
		for (const source of new Set([first, second].map((route) => route.source))) {
			if (!branches(source.kind)) continue;
			const own = routes.filter(
				(route) =>
					route.source === source && movable(route) && (loops || !feedback.has(route.edge.id)),
			);
			// Trades that move a loop come after every other move.
			if (loops && !own.some((route) => feedback.has(route.edge.id))) continue;
			if (own.length < 2 || own.length > 3) continue;
			const current = own.map((route) => route.sourceEdge);
			const taken = new Set(
				routes
					.filter((route) => route.source === source && !own.includes(route) && !isSelfLoop(route))
					.map((route) => route.sourceEdge),
			);
			const vertices = free
				? branchVertices(nodeFlow(diagram, groups, source.nodeId)).filter(
						(side) => !taken.has(side),
					)
				: current;
			for (const order of sideAssignments(vertices, own.length)) {
				if (free && order.every((side) => current.includes(side))) continue;
				const move: SideMove = new Map(
					own.flatMap((route, index) =>
						order[index] === route.sourceEdge
							? []
							: [[route.edge.id, { sourceEdge: order[index]! }]],
					),
				);
				if (move.size > 0) add(move);
			}
		}
	};
	decisionMoves(false);
	const ends = [first, second]
		.filter(movable)
		.flatMap((route) =>
			(["source", "target"] as const).map((endpoint) => {
				const { start, end } = routeEndpoints(route, portOffsets);
				const port = endpoint === "source" ? start : end;
				return { endpoint, route, distance: Math.abs(port.x - at.x) + Math.abs(port.y - at.y) };
			}),
		)
		.sort((a, b) => a.distance - b.distance);
	for (const { endpoint, route } of ends) {
		const current = route[sideKey(endpoint)];
		// The side that faces the route's other end first, then its mirror.
		const facing = facingSide(route[endpoint], route[endpoint === "source" ? "target" : "source"]);
		for (const side of new Set([
			facing,
			mirror(current),
			"top",
			"right",
			"bottom",
			"left",
		] as const))
			if (side !== current) add(new Map([[route.edge.id, { [sideKey(endpoint)]: side }]]));
	}
	if (!laned(diagram)) decisionMoves(true);
	// Last, a loop trades vertices with its decision's branches, or runs straight
	// back between the sides its ends face each other by.
	decisionMoves(false, true);
	for (const route of [first, second].filter(movable)) {
		if (!feedback.has(route.edge.id)) continue;
		const [back, into] = [
			facingSide(route.source, route.target),
			facingSide(route.target, route.source),
		];
		if (route.sourceEdge !== back && route.targetEdge !== into)
			add(new Map([[route.edge.id, { sourceEdge: back, targetEdge: into }]]));
	}
	return moves;
}

/**
 * Crossings a side change would leave if only the routes it touches moved: the
 * moved edges and every edge whose port shifts route again around the others
 * as they lie, then the edges they now cross route again around them. A cheap
 * first look before a move is laid out in full.
 */
function screenedCrossings(settled: SettledLayout, move: SideMove, polish: RoutingPolish): number {
	const { layout } = settled;
	if (!layout.portOffsets || !layout.routeOptions) return 0;
	const routes = layout.routedEdges.map((route) => ({ ...route, ...move.get(route.edge.id) }));
	const offsets = portOffsetsAt(
		routes,
		polish,
		portOrderOf(settled.arrangement),
		layout.lanes !== undefined,
	);
	const moved = new Set(
		routes.flatMap((route) =>
			move.has(route.edge.id) ||
			(["source", "target"] as const).some((endpoint) => {
				const key = connectionKey({ edgeId: route.edge.id, endpoint });
				return offsets.get(key) !== layout.portOffsets!.get(key);
			})
				? [route.edge.id]
				: [],
		),
	);
	// The routes kept as they lie come first; the rerouted ones avoid them in edge order.
	const reroute = (arrows: readonly ArrowSceneElement[], again: ReadonlySet<string>) => {
		const fixed = new Map(
			arrows.flatMap((arrow) => (again.has(arrow.edgeId) ? [] : [[arrow.edgeId, arrow] as const])),
		);
		const order = routes
			.map((route, index) => ({ index, again: again.has(route.edge.id) }))
			.sort((a, b) => Number(a.again) - Number(b.again))
			.map(({ index }) => index);
		return routeAllEdges(
			routes,
			"orthogonal",
			offsets,
			layout.nodeShapes,
			{ ...layout.routeOptions!, avoidCrossings: true },
			order,
			fixed,
		);
	};
	const first = reroute(layout.edgeArrows, moved);
	const crossed = new Set(
		crossingPairs(first).flatMap(({ first: a, second: b }) => {
			const [left, right] = [routes[a]!.edge.id, routes[b]!.edge.id];
			return moved.has(left) === moved.has(right) ? [] : [moved.has(left) ? right : left];
		}),
	);
	if (crossed.size === 0) return arrowCrossings(first);
	return Math.min(arrowCrossings(first), arrowCrossings(reroute(first, crossed)));
}

/**
 * Crossings the arrangements leave: try side changes near each crossing and
 * keep one when the layout then routes with strictly fewer crossings and is
 * otherwise no worse, until no crossing is left or the moves run out.
 */
export function repairCrossings(
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	settled: SettledLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): SettledLayout {
	let best = settled;
	const tried = new Set<string>();

	let [layouts, screens] = [CROSSING_MOVES, SCREENED_MOVES];
	for (let improved = true; improved && layouts > 0;) {
		improved = false;
		const crossings = arrowCrossings(best.layout.edgeArrows);
		const moves = crossingPairs(best.layout.edgeArrows).flatMap(({ first, second, at }) =>
			crossingMoves(
				layoutGraph,
				best.layout.routedEdges[first]!,
				best.layout.routedEdges[second]!,
				at,
				diagram,
				best.layout.portOffsets ?? new Map(),
				best.layout.routedEdges,
				best.layout.groups,
			),
		);
		let round = ROUND_MOVES;
		for (const move of moves) {
			if (layouts === 0 || round === 0 || screens === 0) break;
			const sides = new Map(best.arrangement.sides);
			for (const [id, change] of move) sides.set(id, { ...sides.get(id), ...change });
			const key = JSON.stringify([...sides].sort(([a], [b]) => (a < b ? -1 : 1)));
			if (tried.has(key)) continue;
			tried.add(key);
			screens -= 1;
			if (screenedCrossings(best, move, polish) >= crossings) continue;
			[layouts, round] = [layouts - 1, round - 1];
			const arrangement = { ...best.arrangement, sides, avoidCrossings: true };
			const layout = layoutDiagram(layoutGraph, renderOptions, diagram, polish, arrangement);
			const defects = defectsOf(layout);
			if (
				!fewer(best.defects, defects) &&
				routesNoWorse(layout, best.layout, true, true, true) &&
				hookedRoutes(layout) <= hookedRoutes(best.layout)
			) {
				best = { arrangement, defects, layout };
				improved = true;
				break;
			}
		}
	}
	return best;
}

/** Whether the first score that differs is lower in `left`. */
export function lowerScore(left: readonly number[], right: readonly number[]): boolean {
	const index = left.findIndex((value, at) => value !== right[at]);
	return index >= 0 && left[index]! < right[index]!;
}

/** The direction a node reads in: across the flow inside a group laid out across it. */
function nodeFlow(
	diagram: IntermediateDiagram,
	groups: GroupLayout | undefined,
	nodeId: string,
): LayoutDirection {
	const group = groups?.groupOf.get(nodeId);
	return group !== undefined && groups!.across.has(group)
		? ACROSS_DIRECTION[diagram.layout.direction]
		: diagram.layout.direction;
}

/** The vertices a decision's forward branches may leave by: across the flow either way, and forward. */
function branchVertices(direction: LayoutDirection): readonly ConnectionEdge[] {
	const [low, high]: readonly ConnectionEdge[] =
		direction === "TB" || direction === "BT" ? ["left", "right"] : ["top", "bottom"];
	return [low!, FORWARD_SIDE[direction], high!];
}

/** Whether a line leaving its source by this side starts away from its target. */
function leavesAway(route: RoutedEdge, side: ConnectionEdge): boolean {
	const normal = EDGE_NORMAL[side];
	const [axis, size] = normal.x === 0 ? (["y", "height"] as const) : (["x", "width"] as const);
	return (
		(center(route.target)[axis] - center(route.source)[axis]) * normal[axis] <
		-route.source[size] / 2
	);
}

/**
 * Lines that step back out from the side they arrive by just before turning
 * into it: past a run toward the target, a short run away from the side, one
 * along it and the stub, so the line dips beyond the side and hooks back in.
 */
export function dippedArrivals(arrows: readonly ArrowSceneElement[]): Set<string> {
	return new Set(
		arrows.flatMap((arrow) => {
			const corners = straightRuns(arrow.points);
			if (corners.length < 5) return [];
			const [from, out, along, end] = corners.slice(-4) as [
				ScenePoint,
				ScenePoint,
				ScenePoint,
				ScenePoint,
			];
			const stub = { x: end.x - along.x, y: end.y - along.y };
			const away = { x: out.x - from.x, y: out.y - from.y };
			return stub.x * away.x + stub.y * away.y < 0 &&
				Math.abs(away.x) + Math.abs(away.y) < 2 * ROUTE_STUB_LENGTH
				? [arrow.edgeId]
				: [];
		}),
	);
}

/** Every injective assignment of `count` items to the given sides, in order. */
function sideAssignments(sides: readonly ConnectionEdge[], count: number): ConnectionEdge[][] {
	if (count === 0) return [[]];
	return sides.flatMap((side, index) =>
		sideAssignments([...sides.slice(0, index), ...sides.slice(index + 1)], count - 1).map(
			(rest) => [side, ...rest],
		),
	);
}

/** Branch-side assignments laid out per decision, and of those, completed. */
const BRANCH_SCREENS = 2;

const BRANCH_COMPLETIONS = 1;

/**
 * How far a branch leaving by this vertex runs at least: its stub, then
 * straight across and along to its target's middle.
 */
function branchReach(route: RoutedEdge, side: ConnectionEdge): number {
	const out = pointAwayFromEdge(pointOnEdge(route.source, side), side, ROUTE_STUB_LENGTH);
	const end = center(route.target);
	return ROUTE_STUB_LENGTH + Math.abs(end.x - out.x) + Math.abs(end.y - out.y);
}

/**
 * A decision's forward branches leave by whichever of its lateral and forward
 * vertices route them best together. Where one of them doubles back around
 * its decision, detours or dips into its target as drawn, or two of them
 * cross, the other assignments of the branches to those vertices that double
 * back no more and reach their targets most directly are laid out. The best
 * of those, arranged with no more crossings, detours and dips, is completed
 * like the drawn layout and kept when it has fewer crossings, then fewer
 * detours and dips, then shorter lines (a loop shows in the length it adds),
 * no more export defects, and draws no more reader findings, lines through a
 * head, hooks or crowded labels, and no longer a drawing.
 */
export function chooseBranchSides(
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	polish: RoutingPolish,
	arranged: SettledLayout,
	drawn: CompletedLayout,
	complete: (
		settled: SettledLayout,
		hopeless?: (layout: DiagramLayout) => boolean,
	) => CompletedLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): CompletedLayout {
	const feedback = layoutGraph.feedback;
	const { continuations } = arranged.arrangement.wrap;
	// A loop shows in the length it adds.
	const score = (layout: DiagramLayout) => [
		arrowCrossings(layout.edgeArrows),
		detouredLines(layout.edgeArrows) + dippedArrivals(layout.edgeArrows).size,
		layout.edgeArrows.reduce((sum, arrow) => sum + routeLength(arrow.points), 0),
	];
	const noWorse = (candidate: DiagramLayout, current: DiagramLayout) => {
		const [labels, currentLabels] = [candidate, current].map(labelCrowding);
		return (
			!fewer(defectsOf(current), defectsOf(candidate)) &&
			routesNoWorse(candidate, current, false, true) &&
			headCrossers(candidate).size <= headCrossers(current).size &&
			hookedRoutes(candidate) <= hookedRoutes(current) &&
			labels!.every((count, index) => count <= currentLabels![index]!) &&
			reads(candidate, current)
		);
	};
	// No longer a drawing, and no longer for its breadth unless shorter.
	const reads = (candidate: DiagramLayout, current: DiagramLayout) => {
		const [size, currentSize] = [candidate, current].map(drawnExtent);
		const [long, currentLong] = [size!, currentSize!].map(({ width, height }) =>
			Math.max(width, height),
		);
		return (
			long! <= currentLong! + AXIS_ALIGNED_EPSILON &&
			(long! < currentLong! - AXIS_ALIGNED_EPSILON ||
				exportAspect(size!.width, size!.height) <=
					exportAspect(currentSize!.width, currentSize!.height) + AXIS_ALIGNED_EPSILON)
		);
	};
	let [base, best] = [arranged, drawn];
	let bestScore = score(best.layout);
	const decisions = new Set(
		drawn.layout.routedEdges
			.filter((route) => branches(route.source.kind))
			.map((route) => route.source.nodeId),
	);
	for (const decision of decisions) {
		const { groups, routedEdges } = best.layout;
		const departures = routedEdges.filter(
			(route) => route.source.nodeId === decision && !isSelfLoop(route),
		);
		const own = departures.filter(
			(route) =>
				!feedback.has(route.edge.id) &&
				route.pinned === undefined &&
				route.pair === undefined &&
				!continuations.has(route.edge.id),
		);
		if (own.length < 2 || own.length > 3) continue;
		const ids = new Set(own.map((route) => route.edge.id));
		const arrangedScore = score(base.layout);
		const looping = (order: readonly ConnectionEdge[]) =>
			own.filter((route, index) => leavesAway(route, order[index]!)).length;
		// As drawn, or as arranged before a crossing repair moved them.
		const [loops, flawed] = [best.layout, base.layout]
			.map((layout) => {
				const lines = layout.edgeArrows.filter((arrow) => ids.has(arrow.edgeId));
				const count = layout.routedEdges.filter(
					(route) => ids.has(route.edge.id) && leavesAway(route, route.sourceEdge),
				).length;
				const flaw =
					count > 0 ||
					detouredLines(lines) > 0 ||
					dippedArrivals(lines).size > 0 ||
					arrowCrossings(lines) > 0;
				return [count, flaw] as const;
			})
			.reduce(([count, flaw], [next, nextFlaw]) => [Math.max(count, next), flaw || nextFlaw]);
		if (!flawed) continue;
		const taken = new Set(
			departures.filter((route) => !ids.has(route.edge.id)).map((route) => route.sourceEdge),
		);
		const vertices = branchVertices(nodeFlow(diagram, groups, decision)).filter(
			(side) => !taken.has(side),
		);
		// Only the assignments that reach their targets most directly are laid out.
		const reach = (order: readonly ConnectionEdge[]) =>
			own.reduce((sum, route, index) => sum + branchReach(route, order[index]!), 0);
		// Where a crossing repair moved the branches, the arranged layout's own
		// assignment is one of the others: it lays out as the arranged layout, and
		// completes to the drawn layout, so it is neither laid out nor completed again.
		const arrangedSides = own.map(
			(route) =>
				base.layout.routedEdges.find((other) => other.edge.id === route.edge.id)?.sourceEdge,
		);
		const arrangedCandidates = sideAssignments(vertices, own.length)
			.filter(
				(order) =>
					looping(order) <= loops && order.some((side, index) => side !== own[index]!.sourceEdge),
			)
			.sort((a, b) => reach(a) - reach(b))
			.slice(0, BRANCH_SCREENS)
			.map((order) => {
				if (order.every((side, index) => side === arrangedSides[index]))
					return { ...base, score: arrangedScore };
				const sides = new Map(base.arrangement.sides);
				own.forEach((route, index) =>
					sides.set(route.edge.id, { ...sides.get(route.edge.id), sourceEdge: order[index]! }),
				);
				const arrangement = { ...base.arrangement, sides };
				const layout = layoutDiagram(layoutGraph, renderOptions, diagram, polish, arrangement);
				return { arrangement, defects: defectsOf(layout), layout, score: score(layout) };
			})
			// Before its repairs, it must cross and flaw no more than the arranged layout did.
			.filter((candidate) => !lowerScore(arrangedScore.slice(0, 2), candidate.score.slice(0, 2)))
			.sort((a, b) => (lowerScore(a.score, b.score) ? -1 : lowerScore(b.score, a.score) ? 1 : 0))
			.slice(0, BRANCH_COMPLETIONS);
		let chosen: { base: SettledLayout; drawn: CompletedLayout; score: number[] } | undefined;
		for (const { score: _, ...settled } of arrangedCandidates) {
			if (settled.layout === base.layout) continue;
			const candidate = complete(settled, (layout) =>
				lowerScore((chosen?.score ?? bestScore).slice(0, 2), score(layout).slice(0, 2)),
			);
			const candidateScore = score(candidate.layout);
			if (
				lowerScore(candidateScore, chosen?.score ?? bestScore) &&
				noWorse(candidate.layout, best.layout)
			)
				chosen = { base: settled, drawn: candidate, score: candidateScore };
		}
		if (chosen) [base, best, bestScore] = [chosen.base, chosen.drawn, chosen.score];
	}
	return best;
}

/**
 * The drawn layout with the forward lines that merge into one target nested.
 * Where such a line crosses another line into its target, or enters by the
 * side opposite one that faces its source and so winds round the target, it
 * moves into a side that faces its source and departs no line, alone or
 * trading sides with the merging lines already there. The target's merging
 * lines route again, with the lines whose ports shift, around the others as
 * they lie: the moved line first or last, and, where they share its side, in
 * either order along it. Which line runs inside depends on what stands beside
 * the corridor they share, so every order is tried. Of those that cross fewer
 * lines, or as few with fewer far sides and shorter merging lines, the one
 * with the fewest crossings, then far sides, then lines turning over a
 * corner, then the shortest merging lines is kept, where it turns no more
 * lines over a corner unless it crosses fewer, draws no worse, passes no
 * nearer a node and steps no more lines sideways beside a port. A family that places its own boxes keeps its lines, as does a
 * graph too large for the crossing repair.
 */
export function nestSharedArrivals(
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, polish, routeOptions } = layout;
	if (
		!polish?.sides ||
		!layout.portOffsets ||
		!routeOptions ||
		lanes ||
		renderOptions.placement ||
		diagram.edges.length > CROSSING_REPAIR_MAX_EDGES
	)
		return layout;
	const feedback = layoutGraph.feedback;
	const sides: readonly ConnectionEdge[] = ["top", "right", "bottom", "left"];
	const merging = (route: RoutedEdge) =>
		!feedback.has(route.edge.id) &&
		!isSelfLoop(route) &&
		route.pinned === undefined &&
		route.pair === undefined;
	// How far the route's source's middle lies out past a side of its target:
	// positive where the side faces the source.
	const beyond = (route: RoutedEdge, side: ConnectionEdge) => {
		const [from, to, normal] = [center(route.source), center(route.target), EDGE_NORMAL[side]];
		const half = normal.x !== 0 ? route.target.width / 2 : route.target.height / 2;
		return (from.x - to.x) * normal.x + (from.y - to.y) * normal.y - half;
	};
	// A line into the side opposite one that faces its source winds round its target.
	const facesAway = (route: RoutedEdge) => beyond(route, OPPOSITE_EDGE[route.targetEdge]) > 0;
	const cornered = ({ edgeArrows, routedEdges }: DiagramLayout) => {
		const ends = sideEnds(routedEdges);
		return edgeArrows.filter((arrow, index) => turnsCorner(routedEdges[index]!, arrow, ends))
			.length;
	};
	let current = layout;
	const targets = new Set(layout.routedEdges.filter(merging).map((route) => route.target.nodeId));
	for (const targetId of targets) {
		const members = new Set(
			current.routedEdges.flatMap((route, index) =>
				route.target.nodeId === targetId && merging(route) ? [index] : [],
			),
		);
		if (members.size < 2) continue;
		const crossed = new Set(
			crossingPairs(current.edgeArrows).flatMap(({ first, second }) =>
				members.has(first) && members.has(second) ? [first, second] : [],
			),
		);
		const misplaced = [...members].filter(
			(index) => crossed.has(index) || facesAway(current.routedEdges[index]!),
		);
		if (misplaced.length === 0) continue;
		const target = current.routedEdges[misplaced[0]!]!.target;
		const departed = new Set(
			current.routedEdges.flatMap((route) => (route.source === target ? [route.sourceEdge] : [])),
		);
		// A side a merging line may take: free of departures, facing its source.
		const open = (index: number, side: ConnectionEdge) =>
			!departed.has(side) && beyond(current.routedEdges[index]!, side) > 0;
		// Crossings, then merging lines into far sides, then lines turning over a
		// corner, then the merging lines' length.
		const score = (settled: DiagramLayout) => [
			arrowCrossings(settled.edgeArrows),
			[...members].filter((index) => facesAway(settled.routedEdges[index]!)).length,
			cornered(settled),
			[...members].reduce((sum, index) => sum + routeLength(settled.edgeArrows[index]!.points), 0),
		];
		const [crossings, far, corners, length] = score(current);
		const improves = ([candidateCrossings, candidateFar, , candidateLength]: number[]) =>
			candidateCrossings! < crossings! ||
			(candidateCrossings === crossings &&
				candidateFar! < far! &&
				candidateLength! < length! - AXIS_ALIGNED_EPSILON);
		// Each misplaced line into each open side, alone, or trading sides with
		// the merging lines already there where its own side is open to them.
		const moves = misplaced.flatMap((index) =>
			sides.flatMap((side) => {
				if (!open(index, side)) return [];
				const alone = new Map([[index, side]]);
				const from = current.routedEdges[index]!.targetEdge;
				const there = [...members].filter(
					(at) => at !== index && current.routedEdges[at]!.targetEdge === side,
				);
				return there.length > 0 && there.every((at) => open(at, from))
					? [alone, new Map([...alone, ...there.map((at) => [at, from] as const)])]
					: [alone];
			}),
		);
		let kept: { layout: DiagramLayout; score: number[] } | undefined;
		for (const move of moves) {
			const routes = current.routedEdges.map((route, at) =>
				move.has(at) ? { ...route, targetEdge: move.get(at)! } : route,
			);
			const offsets = portOffsetsAt(routes, polish, current.byApproach ?? false, false);
			const [index] = move.keys();
			const side = move.get(index!)!;
			// The merging lines that share the moved line's side, in order along it,
			// and the same ports taken the other way along.
			const beside = [...members]
				.filter((at) => routes[at]!.targetEdge === side)
				.map((at) => connectionKey({ edgeId: routes[at]!.edge.id, endpoint: "target" }))
				.sort((a, b) => offsets.get(a)! - offsets.get(b)!);
			const reversed = new Map(offsets);
			for (const [at, key] of beside.entries())
				reversed.set(key, offsets.get(beside[beside.length - 1 - at]!)!);
			const others = [...members].filter((at) => at !== index);
			for (const ports of beside.length > 1 ? [offsets, reversed] : [offsets]) {
				const again = new Set(
					routes.flatMap((route, at) =>
						members.has(at) ||
						(["source", "target"] as const).some((endpoint) => {
							const key = connectionKey({ edgeId: route.edge.id, endpoint });
							return ports.get(key) !== current.portOffsets!.get(key);
						})
							? [at]
							: [],
					),
				);
				const indices = routes.map((_, at) => at);
				for (const merge of [
					[index!, ...others],
					[...others, index!],
				]) {
					// The lines kept as they lie come first, then the merging lines in
					// this order, then those whose ports shift.
					const order = [
						...indices.filter((at) => !again.has(at)),
						...merge,
						...indices.filter((at) => again.has(at) && !members.has(at)),
					];
					const drafted = {
						...current,
						edgeArrows: routeAllEdges(
							routes,
							"orthogonal",
							ports,
							current.nodeShapes,
							{ ...routeOptions, midway: true },
							order,
							new Map(
								current.edgeArrows
									.filter((_, at) => !again.has(at))
									.map((arrow) => [arrow.edgeId, arrow]),
							),
						),
						portOffsets: ports,
						routedEdges: routes,
					};
					// A first look as routed, before the clearance passes finish it.
					if (!improves(score(drafted))) continue;
					const candidate = finished(drafted);
					const candidateScore = score(candidate);
					if (
						improves(candidateScore) &&
						(candidateScore[2]! <= corners! || candidateScore[0]! < crossings!) &&
						(!kept || lowerScore(candidateScore, kept.score)) &&
						drawsNoWorse(candidate, current, defectsOf, fewer) &&
						nearOutlines(candidate) <= nearOutlines(current) &&
						portJogCount(candidate) <= portJogCount(current)
					)
						kept = { layout: candidate, score: candidateScore };
				}
			}
		}
		if (kept) current = kept.layout;
	}
	return current;
}

/**
 * The drawn layout with each return into a decision that lands farther from
 * its source than a vertex no other line uses moved into the nearest such
 * vertex, leaving its source as it does or by a side that faces the vertex: a
 * return that winds round to the decision's far side, or shares a vertex with
 * a branch, reads as a detour into the wrong face. One line at a time routes
 * again, with the lines whose ports shift, around the others as they lie. Of
 * the sides tried, the shortest line is kept that bends no more and is
 * shorter than before, where the layout crosses no more lines, draws no worse
 * and passes no nearer a node. A family that places its own boxes keeps its
 * lines.
 */
export function returnsToNearVertices(
	layoutGraph: GraphLayout,
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, polish, routeOptions } = layout;
	if (!polish?.sides || !layout.portOffsets || !routeOptions || lanes || renderOptions.placement)
		return layout;
	const feedback = layoutGraph.feedback;
	const sides: readonly ConnectionEdge[] = ["top", "right", "bottom", "left"];
	let current = layout;
	for (const index of layout.routedEdges.keys()) {
		const route = current.routedEdges[index]!;
		const { source, target } = route;
		if (
			!feedback.has(route.edge.id) ||
			isSelfLoop(route) ||
			!branches(target.kind) ||
			route.pinned !== undefined ||
			route.pair !== undefined
		)
			continue;
		const line = current.edgeArrows[index]!;
		// How far a point lies from the source's box.
		const away = (point: ScenePoint) =>
			Math.hypot(
				Math.max(source.x - point.x, 0, point.x - source.x - source.width),
				Math.max(source.y - point.y, 0, point.y - source.y - source.height),
			);
		const [vertex] = sides
			.filter(
				(side) =>
					!current.routedEdges.some(
						(other) =>
							other !== route &&
							((other.target === target && other.targetEdge === side) ||
								(other.source === target && other.sourceEdge === side)),
					),
			)
			.map((side) => ({ point: pointOnEdge(target, side), side }))
			.filter(({ point }) => away(point) < away(line.points.at(-1)!) - PORT_SPACING)
			.sort((a, b) => away(a.point) - away(b.point));
		if (!vertex) continue;
		const facing = sides.filter((side) => {
			const [from, normal] = [pointOnEdge(source, side), EDGE_NORMAL[side]];
			return (vertex.point.x - from.x) * normal.x + (vertex.point.y - from.y) * normal.y > 0;
		});
		let kept: { layout: DiagramLayout; length: number } | undefined;
		for (const sourceEdge of new Set([route.sourceEdge, ...facing])) {
			const routes = current.routedEdges.map((other, at) =>
				at === index ? { ...other, sourceEdge, targetEdge: vertex.side } : other,
			);
			const offsets = portOffsetsAt(routes, polish, current.byApproach ?? false, false);
			const again = new Set(
				routes.flatMap((other, at) =>
					at === index ||
					(["source", "target"] as const).some((endpoint) => {
						const key = connectionKey({ edgeId: other.edge.id, endpoint });
						return offsets.get(key) !== current.portOffsets!.get(key);
					})
						? [other.edge.id]
						: [],
				),
			);
			// The lines kept as they lie come first; the others route around them in edge order.
			const order = routes
				.map((other, at) => ({ again: again.has(other.edge.id), at }))
				.sort((a, b) => Number(a.again) - Number(b.again))
				.map(({ at }) => at);
			const arrows = routeAllEdges(
				routes,
				"orthogonal",
				offsets,
				current.nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				new Map(
					current.edgeArrows
						.filter((arrow) => !again.has(arrow.edgeId))
						.map((arrow) => [arrow.edgeId, arrow]),
				),
			);
			if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
			const candidate = finished({
				...current,
				edgeArrows: arrows,
				portOffsets: offsets,
				routedEdges: routes,
			});
			const points = candidate.edgeArrows[index]!.points;
			const length = routeLength(points);
			if (
				length < routeLength(line.points) - AXIS_ALIGNED_EPSILON &&
				routeBendCount(points) <= routeBendCount(line.points) &&
				(!kept || length < kept.length - AXIS_ALIGNED_EPSILON) &&
				drawsNoWorse(candidate, current, defectsOf, fewer) &&
				nearOutlines(candidate) <= nearOutlines(current)
			)
				kept = { layout: candidate, length };
		}
		if (kept) current = kept.layout;
	}
	return current;
}

/**
 * The drawn layout with its arrivals polished. An arrival that turns over its
 * target's corner, from beyond the target, into a side another line meets it
 * by, or that dips past its side and hooks back in, enters by the side its
 * approach faces instead, where that side is free or flat with only arrivals;
 * and every line between facing sides that jogs beside a port may step across
 * midway. Only those lines, and lines whose ports shift, route again around
 * the others as they lie. Kept when it draws fewer reader findings or dips,
 * or bends those lines less, without lengthening them, and has no more export
 * defects and draws no more crossings, reader findings, lines through a head,
 * hooks, detours, dips or crowded labels, and no longer a drawing.
 */
export function polishArrivals(
	layoutGraph: GraphLayout,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { edgeArrows, lanes, nodeShapes, polish, portOffsets, routeOptions } = layout;
	if (!polish?.sides || !portOffsets || !routeOptions?.readerScale || lanes) return layout;
	const routes = layout.routedEdges.map((route) => ({ ...route }));
	const drawn = [...nodeShapes, ...groupBlocks(layout.groups)];
	const scale = routingQualityScale(drawnSize(drawn, edgeArrows));
	const changed = new Set(
		resideArrivals(layoutGraph, routes, edgeArrows, diagram, scale, "cornered").map(
			({ route }) => route.edge.id,
		),
	);
	const feedback = layoutGraph.feedback;
	const dipped = dippedArrivals(edgeArrows);
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		if (
			!dipped.has(arrow.edgeId) ||
			feedback.has(route.edge.id) ||
			route.pinned?.target !== undefined
		)
			continue;
		const [before, from] = straightRuns(arrow.points).slice(-5) as [ScenePoint, ScenePoint];
		const side: ConnectionEdge =
			Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON
				? from.x > before.x
					? "left"
					: "right"
				: from.y > before.y
					? "top"
					: "bottom";
		const others = routes.filter(
			(other) =>
				other !== route &&
				((other.source === route.target && other.sourceEdge === side) ||
					(other.target === route.target && other.targetEdge === side)),
		);
		if (
			side === route.targetEdge ||
			(others.length > 0 &&
				(curvedSide(route.target, side) || others.some((other) => other.source === route.target)))
		)
			continue;
		route.targetEdge = side;
		changed.add(route.edge.id);
	}
	// Where a line drops straight into the side of its target facing its own
	// side, nothing between: in line with where it starts, else from the nearest
	// port of the two sides' overlap, a port's spacing clear of the other lines
	// at its source's side and in the same order, its start moved there. Its
	// ends' offsets, and whether it starts in line.
	const straightAcross = (route: RoutedEdge, arrow: ArrowSceneElement) => {
		const side = OPPOSITE_EDGE[route.sourceEdge];
		const { source, target } = route;
		const axis = slotAxis(side);
		const [low, size] = axis === "x" ? [target.x, target.width] : [target.y, target.height];
		const drawnStart = arrow.points[0][axis];
		const inLine = drawnStart > low + PORT_PADDING && drawnStart < low + size - PORT_PADDING;
		const along = inLine
			? drawnStart
			: clamp(drawnStart, low + 2 * PORT_PADDING, low + size - 2 * PORT_PADDING);
		const from = center(source)[axis];
		// Where each other line meets the source's side.
		const besides = routes.flatMap((other, at) =>
			other !== route &&
			((other.source === source && other.sourceEdge === route.sourceEdge) ||
				(other.target === source && other.targetEdge === route.sourceEdge))
				? [
						(other.source === source ? edgeArrows[at]!.points[0] : edgeArrows[at]!.points.at(-1)!)[
							axis
						],
					]
				: [],
		);
		if (
			!inLine &&
			(route.pinned !== undefined ||
				size < 4 * PORT_PADDING ||
				Math.abs(along - from) > portLimit(source, route.sourceEdge) ||
				besides.some(
					(other) =>
						Math.abs(along - other) < PORT_SPACING ||
						Math.sign(along - other) !== Math.sign(drawnStart - other),
				))
		)
			return undefined;
		const start = inLine ? arrow.points[0] : pointOnEdge(source, route.sourceEdge, along - from);
		const end = pointOnEdge(target, side, along - low - size / 2);
		const across = axis === "x" ? "y" : "x";
		return EDGE_NORMAL[side][across] * (start[across] - end[across]) <= 0 ||
			nodeShapes.some(
				(node) =>
					node.nodeId !== source.nodeId &&
					node.nodeId !== target.nodeId &&
					directSegmentCrossesNode(start, end, node),
			)
			? undefined
			: { inLine, source: along - from, target: along - low - size / 2 };
	};
	const straightPorts = new Map<string, number>();
	// Lines that move onto the facing side only by moving their start, by their sides before.
	const slid = new Map<string, ConnectionEdge>();
	const runStraight = (route: RoutedEdge, ports: { source: number; target: number }) => {
		straightPorts.set(connectionKey({ edgeId: route.edge.id, endpoint: "source" }), ports.source);
		straightPorts.set(connectionKey({ edgeId: route.edge.id, endpoint: "target" }), ports.target);
	};
	// A line the dip moves onto the side facing its own side drops straight in
	// where it can.
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		if (!changed.has(route.edge.id) || route.targetEdge !== OPPOSITE_EDGE[route.sourceEdge])
			continue;
		const ports = straightAcross(route, arrow);
		if (ports) runStraight(route, ports);
	}
	// A line that starts in line with the free side of its target it faces,
	// nothing between, drops straight into it, and one that starts just past
	// that side's span from the overlap.
	for (const [index, arrow] of edgeArrows.entries()) {
		const route = routes[index]!;
		const side = OPPOSITE_EDGE[route.sourceEdge];
		const { target } = route;
		if (
			route.targetEdge === side ||
			changed.has(route.edge.id) ||
			feedback.has(route.edge.id) ||
			route.pinned?.target !== undefined ||
			isSelfLoop(route) ||
			routes.some(
				(other) =>
					(other.target === target && other.targetEdge === side) ||
					(other.source === target && other.sourceEdge === side),
			)
		)
			continue;
		const ports = straightAcross(route, arrow);
		if (!ports) continue;
		if (!ports.inLine) {
			slid.set(route.edge.id, route.targetEdge);
			runStraight(route, ports);
		}
		route.targetEdge = side;
		changed.add(route.edge.id);
	}
	for (const finding of routingQualityFindings(
		edgeArrows.map((arrow) => ({ id: arrow.edgeId, points: arrow.points })),
		scale,
	))
		if (finding.kind === "endpoint-jog") {
			const route = routes.find((candidate) => candidate.edge.id === finding.arrowIds[0])!;
			if (route.targetEdge === OPPOSITE_EDGE[route.sourceEdge]) changed.add(route.edge.id);
		}
	// The lines that move, and those whose ports shift, route again around the
	// others as they lie; kept when they read better and draw no worse.
	const attempt = (
		moved: RoutedEdge[],
		lines: ReadonlySet<string>,
		ports: ReadonlyMap<string, number>,
	): DiagramLayout | undefined => {
		if (lines.size === 0) return undefined;
		const offsets = portOffsetsAt(moved, polish, layout.byApproach ?? false, false);
		for (const [key, offset] of ports) offsets.set(key, offset);
		const again = new Set(
			moved.flatMap((route) =>
				lines.has(route.edge.id) ||
				(["source", "target"] as const).some((endpoint) => {
					const key = connectionKey({ edgeId: route.edge.id, endpoint });
					return offsets.get(key) !== portOffsets.get(key);
				})
					? [route.edge.id]
					: [],
			),
		);
		// The lines kept as they lie come first; the others route around them in edge order.
		const order = moved
			.map((route, index) => ({ again: again.has(route.edge.id), index }))
			.sort((a, b) => Number(a.again) - Number(b.again))
			.map(({ index }) => index);
		const candidate = finished({
			...layout,
			edgeArrows: routeAllEdges(
				moved,
				"orthogonal",
				offsets,
				nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				new Map(edgeArrows.filter((arrow) => !again.has(arrow.edgeId)).map((a) => [a.edgeId, a])),
			),
			portOffsets: offsets,
			routedEdges: moved,
		});
		const measure = (arrows: readonly ArrowSceneElement[]) =>
			arrows
				.filter((arrow) => lines.has(arrow.edgeId))
				.reduce(
					(sum, arrow) => ({
						bends: sum.bends + routeBendCount(arrow.points),
						length: sum.length + routeLength(arrow.points),
					}),
					{ bends: 0, length: 0 },
				);
		const [before, after] = [measure(edgeArrows), measure(candidate.edgeArrows)];
		const [findings, currentFindings] = [candidate, layout].map((settled) =>
			readerFindingCount(settled.edgeArrows, [
				...settled.nodeShapes,
				...groupBlocks(settled.groups),
			]),
		);
		const [dips, currentDips] = [candidate, layout].map(
			(settled) => dippedArrivals(settled.edgeArrows).size,
		);
		return (findings! < currentFindings! || dips! < currentDips! || after.bends < before.bends) &&
			after.length <= before.length + AXIS_ALIGNED_EPSILON &&
			drawsNoWorse(candidate, layout, defectsOf, fewer)
			? candidate
			: undefined;
	};
	// Straight in first; failing that, as the moves go without moving any start.
	return (
		(straightPorts.size > 0 ? attempt(routes, changed, straightPorts) : undefined) ??
		attempt(
			routes.map((route) =>
				slid.has(route.edge.id) ? { ...route, targetEdge: slid.get(route.edge.id)! } : route,
			),
			new Set([...changed].filter((id) => !slid.has(id))),
			new Map(),
		) ??
		layout
	);
}

/**
 * Whether a route swings out past the box its two ends span, a stub's length
 * or more each way.
 */
function swingsOut(points: readonly ScenePoint[]): boolean {
	const [start, end] = [points[0]!, points.at(-1)!];
	const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	return (
		routeLength(points) >= direct + 2 * ROUTE_STUB_LENGTH &&
		points.some(
			(point) =>
				point.x < Math.min(start.x, end.x) - AXIS_ALIGNED_EPSILON ||
				point.x > Math.max(start.x, end.x) + AXIS_ALIGNED_EPSILON ||
				point.y < Math.min(start.y, end.y) - AXIS_ALIGNED_EPSILON ||
				point.y > Math.max(start.y, end.y) + AXIS_ALIGNED_EPSILON,
		)
	);
}

/** Arrival ports tried along a side, as fractions of its reach: the middle and either end. */
const ARRIVAL_PORT_STEPS = [0, -1, 1];

/**
 * The drawn layout with each line between facing sides that bends more than
 * twice, out past its ends, into a flat side it alone arrives by moved along
 * that side to the port from which it routes with the fewest bends, then the
 * shortest line: a port aligned with the line's start that a group's name or
 * another obstacle blocks sends the line around instead. Only that line routes again, around
 * the others as they lie, kept when it bends less without lengthening and
 * the layout draws no worse.
 */
export function straightenArrivals(
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, nodeShapes, polish, routeOptions, routedEdges } = layout;
	if (!polish?.sides || !layout.portOffsets || !routeOptions?.readerScale || lanes) return layout;
	let current = layout;
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const { target, targetEdge } = route;
		if (
			targetEdge !== OPPOSITE_EDGE[route.sourceEdge] ||
			route.pinned?.target !== undefined ||
			routeBendCount(line.points) <= 2 ||
			// Only a line that swings out past its ends goes around its port.
			!swingsOut(line.points) ||
			curvedSide(target, targetEdge) ||
			routedEdges.some(
				(other) =>
					other !== route &&
					((other.target === target && other.targetEdge === targetEdge) ||
						(other.source === target && other.sourceEdge === targetEdge)),
			)
		)
			continue;
		const key = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		const reach = portLimit(target, targetEdge);
		const fixed = new Map(
			current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
		);
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		const ports = ARRIVAL_PORT_STEPS.flatMap((step) => {
			const offset = step * reach;
			if (Math.abs(offset - (current.portOffsets!.get(key) ?? 0)) <= AXIS_ALIGNED_EPSILON)
				return [];
			const offsets = new Map(current.portOffsets).set(key, offset);
			const arrows = routeAllEdges(
				routedEdges,
				"orthogonal",
				offsets,
				nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				fixed,
			);
			const points = arrows[index]!.points;
			const [bends, length] = [routeBendCount(points), routeLength(points)];
			return bends < routeBendCount(line.points) &&
				length <= routeLength(line.points) + AXIS_ALIGNED_EPSILON
				? [{ arrows, bends, length, offsets }]
				: [];
		});
		// The straightest port, where it crosses no more lines and draws no worse.
		const straightest = ports.sort((a, b) => a.bends - b.bends || a.length - b.length)[0];
		if (!straightest || arrowCrossings(straightest.arrows) > arrowCrossings(current.edgeArrows))
			continue;
		const candidate = finished({
			...current,
			edgeArrows: straightest.arrows,
			portOffsets: straightest.offsets,
		});
		if (drawsNoWorse(candidate, current, defectsOf, fewer)) current = candidate;
	}
	return current;
}

/**
 * The drawn layout with each line that meets a rounded node within a corner's
 * curve, nearer the corner along its side than the radius, moved along that
 * side onto its straight part: a line into the curve reads as aimed at the
 * corner. One line at a time routes again, around the others as they lie,
 * kept when the layout draws no worse. A family that draws its own boxes
 * (placed, square) keeps its lines.
 */
export function endsOffCorners(
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { lanes, routeOptions, routedEdges } = layout;
	if (!layout.portOffsets || !routeOptions || lanes || renderOptions.placement) return layout;
	let current = layout;
	// Where each other line meets a node's side, along it from the node's middle.
	const besides = (node: NodeSceneElement, side: ConnectionEdge, except: string) =>
		routedEdges.flatMap((other, at) =>
			(["source", "target"] as const).flatMap((endpoint) => {
				const otherSide = endpoint === "source" ? other.sourceEdge : other.targetEdge;
				if (
					other.edge.id === except ||
					other[endpoint].nodeId !== node.nodeId ||
					otherSide !== side
				)
					return [];
				const points = current.edgeArrows[at]!.points;
				const point = endpoint === "source" ? points[0] : points.at(-1)!;
				return [point[slotAxis(side)] - center(node)[slotAxis(side)]];
			}),
		);
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const ends = (["source", "target"] as const).map((endpoint) => {
			const node = route[endpoint];
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			const axis = slotAxis(side);
			const point = endpoint === "source" ? line.points[0] : line.points.at(-1)!;
			const radius = node.id.startsWith("node:") ? canvasCornerRadius(node) : 0;
			const half = (axis === "x" ? node.width : node.height) / 2;
			return {
				along: point[axis] - center(node)[axis],
				curved: radius > PORT_PADDING,
				key: connectionKey({ edgeId: route.edge.id, endpoint }),
				limit: Math.max(0, half - Math.max(PORT_PADDING, radius)),
				others: besides(node, side, route.edge.id),
			};
		});
		const cornered = ends.filter(
			(end) => end.curved && Math.abs(end.along) > end.limit + AXIS_ALIGNED_EPSILON,
		);
		// An end moves in only as far as it keeps a port's room from the other lines on its side.
		const roomy = (end: (typeof ends)[number], along: number) =>
			end.others.every(
				(other) =>
					Math.abs(along - other) >=
					Math.min(Math.abs(end.along - other), PORT_SPACING) - AXIS_ALIGNED_EPSILON,
			);
		if (
			cornered.length === 0 ||
			!cornered.every((end) => roomy(end, Math.sign(end.along) * end.limit))
		)
			continue;
		const offsets = new Map(current.portOffsets);
		for (const end of cornered) offsets.set(end.key, Math.sign(end.along) * end.limit);
		// A straight line moves both its ends, so it stays straight.
		if (line.points.length === 2 && cornered.length === 1) {
			const [moved] = cornered;
			const other = ends.find((end) => end !== moved)!;
			const along = other.along + Math.sign(moved!.along) * moved!.limit - moved!.along;
			if (Math.abs(along) <= other.limit + AXIS_ALIGNED_EPSILON && roomy(other, along))
				offsets.set(other.key, along);
		}
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		const arrows = routeAllEdges(
			routedEdges,
			"orthogonal",
			offsets,
			current.nodeShapes,
			{ ...routeOptions, midway: true },
			order,
			new Map(
				current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
			),
		);
		// A line that crosses more is no better for its straight end: it is not finished.
		if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
		const candidate = finished({ ...current, edgeArrows: arrows, portOffsets: offsets });
		if (drawsNoWorse(candidate, current, defectsOf, fewer)) current = candidate;
	}
	return current;
}

/** Ports a lone arrival tries nearer its side's middle, nearest the middle first. */
const CENTERED_PORT_TRIES = 3;

/**
 * The drawn layout with each bent line that alone meets its target's flat
 * side, in the outer quarter of that side, moved along it to the port nearest
 * the middle from which it routes with no more bends and no longer than the
 * move: the middle, else just past what blocks its last run there, such as a
 * group's name, where nothing else does. A line that lands by a corner reads
 * as aimed at it. One line at a time routes again, around the others as they
 * lie, its step moved clear of its ends where the new port brings one near
 * (withStepMoved), kept when the layout draws no worse and passes no nearer a
 * node.
 */
export function centerLoneArrivals(
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	finished: (layout: DiagramLayout) => DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { groups, lanes, nodeShapes, polish, routeOptions, routedEdges } = layout;
	if (!polish?.sides || !layout.portOffsets || !routeOptions || lanes || renderOptions.placement)
		return layout;
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups)], layout.edgeArrows),
	);
	let current = layout;
	for (const [index, route] of routedEdges.entries()) {
		const line = current.edgeArrows[index]!;
		const { source, target, targetEdge: side } = route;
		if (
			isSelfLoop(route) ||
			route.pinned?.target !== undefined ||
			routeBendCount(line.points) === 0 ||
			curvedSide(target, side) ||
			routedEdges.some(
				(other) =>
					other !== route &&
					((other.target === target && other.targetEdge === side) ||
						(other.source === target && other.sourceEdge === side)),
			)
		)
			continue;
		const [axis, across] = slotAxis(side) === "x" ? (["x", "y"] as const) : (["y", "x"] as const);
		const middle = center(target)[axis];
		const half = (axis === "x" ? target.width : target.height) / 2;
		const end = line.points.at(-1)!;
		const along = end[axis] - middle;
		if (Math.abs(along) <= (3 / 4) * half) continue;
		const radius = target.id.startsWith("node:") ? canvasCornerRadius(target) : 0;
		const limit = Math.min(half - Math.max(PORT_PADDING, radius), (3 / 4) * half);
		// Just past each thing that stands across the last run's way into the side.
		const last = straightRuns(line.points).at(-2)!;
		const [near, far] = [Math.min(last[across], end[across]), Math.max(last[across], end[across])];
		const [size, depth] =
			axis === "x" ? (["width", "height"] as const) : (["height", "width"] as const);
		const blockers = [
			...current.nodeShapes.filter(
				(node) => node.nodeId !== target.nodeId && node.nodeId !== source.nodeId,
			),
			...groupObstacles(groups, route),
			...branchLabelObstacles(routedEdges, current.portOffsets!).filter(
				(label) => label.nodeId !== `branch-label:${route.edge.id}`,
			),
		].filter(
			(box) =>
				box[across] < far &&
				box[across] + box[depth] > near &&
				box[axis] < middle + half &&
				box[axis] + box[size] > middle - half,
		);
		const ports = [
			...new Set([
				0,
				...blockers.flatMap((box) => [
					box[axis] - PORT_SPACING - middle,
					box[axis] + box[size] + PORT_SPACING - middle,
				]),
			]),
		]
			.filter(
				(offset) =>
					Math.abs(offset) <= limit + AXIS_ALIGNED_EPSILON &&
					Math.abs(offset) < Math.abs(along) - AXIS_ALIGNED_EPSILON &&
					!blockers.some(
						(box) => box[axis] < middle + offset && box[axis] + box[size] > middle + offset,
					),
			)
			.sort((a, b) => Math.abs(a) - Math.abs(b))
			.slice(0, CENTERED_PORT_TRIES);
		const key = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		const fixed = new Map(
			current.edgeArrows.filter((arrow) => arrow !== line).map((arrow) => [arrow.edgeId, arrow]),
		);
		const order = routedEdges
			.map((_, at) => at)
			.sort((a, b) => Number(a === index) - Number(b === index));
		for (const offset of ports) {
			const offsets = new Map(current.portOffsets).set(key, offset);
			const arrows = routeAllEdges(
				routedEdges,
				"orthogonal",
				offsets,
				current.nodeShapes,
				{ ...routeOptions, midway: true },
				order,
				fixed,
			);
			const points = arrows[index]!.points;
			if (
				routeBendCount(points) > routeBendCount(line.points) ||
				routeLength(points) >
					routeLength(line.points) + Math.abs(offset - along) + AXIS_ALIGNED_EPSILON
			)
				continue;
			const kept = withStepMoved(
				{ ...current, edgeArrows: arrows, portOffsets: offsets },
				index,
				current,
				scale,
				defectsOf,
				fewer,
				finished,
			);
			if (kept) {
				current = kept;
				break;
			}
		}
	}
	return current;
}

/**
 * A line's corners with its first sideways step that reads as a port jog
 * (portJogSteps) moved along the runs either side of it: midway between the
 * turns those runs start and end at, else just past the reach of the end it
 * sits within, away from that end, each a port's spacing or more from where
 * it was. Each keeps the line's stubs and jogs less as a whole.
 * A step beside an arrowhead or a port reads as a jog into it.
 */
function movedSteps(
	points: readonly ScenePoint[],
	reach: number,
	wide: number,
): [ScenePoint, ...ScenePoint[]][] {
	const corners = straightRuns(points);
	const jogs = portJogSteps(corners, reach, wide);
	const index = jogs[0];
	if (index === undefined) return [];
	const [before, from, to, after] = corners.slice(index - 1, index + 3) as [
		ScenePoint,
		ScenePoint,
		ScenePoint,
		ScenePoint,
	];
	const [axis, across] =
		Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON
			? (["x", "y"] as const)
			: (["y", "x"] as const);
	const heading = Math.sign(from[axis] - before[axis]);
	// Just past the reach of each end it sits within, away from that end.
	const [start, end] = [corners[0]!, corners.at(-1)!];
	const past = (point: ScenePoint, turn: ScenePoint, away: number) => {
		const room = reach ** 2 - (point[across] - turn[across]) ** 2;
		return Math.hypot(point.x - turn.x, point.y - turn.y) > reach || room < 0
			? []
			: [point[axis] + away * (Math.sqrt(room) + 1)];
	};
	const nearest = [...past(end, to, -heading), ...past(start, from, heading)].sort(
		(a, b) => Math.abs(a - from[axis]) - Math.abs(b - from[axis]),
	);
	return [...new Set([(before[axis] + after[axis]) / 2, ...nearest].map(Math.round))].flatMap(
		(at) => {
			// A step moved less than a port's spacing reads where it was.
			if (
				Math.abs(at - from[axis]) < PORT_SPACING ||
				Math.sign(at - before[axis]) !== heading ||
				Math.sign(after[axis] - at) !== heading
			)
				return [];
			const moved = corners.map((point, turn) =>
				turn === index || turn === index + 1 ? { ...point, [axis]: at } : point,
			);
			return keepsStubs(corners, moved) && portJogSteps(moved, reach, wide).length < jogs.length
				? [compactPoints(moved)]
				: [];
		},
	);
}

/**
 * The first of a layout's variants with one line's step moved clear of its
 * ends (movedSteps), then, when `finished` is given, the layout itself, each
 * finished, that crosses no more lines than `current`, draws no worse and
 * passes no nearer a node. A step moved within a finished layout keeps it
 * finished enough: the last clearance pass follows every polish.
 */
function withStepMoved(
	layout: DiagramLayout,
	index: number,
	current: DiagramLayout,
	scale: number,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
	finished?: (layout: DiagramLayout) => DiagramLayout,
): DiagramLayout | undefined {
	const { edgeArrows } = layout;
	const variants = [
		...movedSteps(edgeArrows[index]!.points, routingJogReach(scale), routingWideBend(scale)).map(
			(points) => edgeArrows.map((arrow, at) => (at === index ? { ...arrow, points } : arrow)),
		),
		...(finished ? [edgeArrows] : []),
	];
	for (const arrows of variants) {
		if (arrowCrossings(arrows) > arrowCrossings(current.edgeArrows)) continue;
		const candidate = finished
			? finished({ ...layout, edgeArrows: arrows })
			: { ...layout, edgeArrows: arrows };
		if (
			drawsNoWorse(candidate, current, defectsOf, fewer) &&
			nearOutlines(candidate) <= nearOutlines(current)
		)
			return candidate;
	}
	return undefined;
}

/**
 * The drawn layout with each line's sideways step that sits within a port
 * jog's reach of either end moved clear of both (withStepMoved), a line at a
 * time, its other runs and every other line as they lie. A family that
 * places its own boxes keeps its lines.
 */
export function stepsClearOfEnds(
	renderOptions: GraphRenderOptions,
	diagram: IntermediateDiagram,
	layout: DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): DiagramLayout {
	const { groups, lanes, nodeShapes, polish, routedEdges } = layout;
	if (!polish?.sides || lanes || renderOptions.placement) return layout;
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups)], layout.edgeArrows),
	);
	let current = layout;
	for (const [index, route] of routedEdges.entries())
		if (!isSelfLoop(route))
			current = withStepMoved(current, index, current, scale, defectsOf, fewer) ?? current;
	return current;
}

/** Runs that pass within the clearance of a node neither of their line's ends is. */
export function nearOutlines({ edgeArrows, nodeShapes }: DiagramLayout): number {
	return edgeArrows.reduce(
		(total, arrow) =>
			total +
			routeClearanceCount(
				arrow.points,
				nodeShapes,
				new Set([arrow.sourceNodeId, arrow.targetNodeId]),
			),
		0,
	);
}

/**
 * Pairs of lines drawn along one visible segment (sharedSegments), judged at
 * the export size of everything drawn.
 */
export function sharedSegmentCount({
	edgeArrows,
	groups,
	lanes,
	nodeShapes,
}: DiagramLayout): number {
	const scale = routingQualityScale(
		drawnSize([...nodeShapes, ...groupBlocks(groups), ...laneBlocks(lanes)], edgeArrows),
	);
	return sharedSegments(
		edgeArrows.map((arrow) => ({ id: arrow.id, points: arrow.points })),
		scale,
	).length;
}

/**
 * No more export defects, and no more crossings, reader findings, lines
 * through a head, hooks, detours, dips, crowded labels or lines drawn along
 * one segment, and no newly extreme aspect or longer a drawing. A line moved
 * onto another reads as one line, which a reader cannot follow, even where it
 * trades a finding for the corridor it draws.
 */
export function drawsNoWorse(
	candidate: DiagramLayout,
	current: DiagramLayout,
	defectsOf: (layout: DiagramLayout) => readonly [number, number],
	fewer: (a: readonly [number, number], b: readonly [number, number]) => boolean,
): boolean {
	const [labels, currentLabels] = [candidate, current].map(labelCrowding);
	return (
		!fewer(defectsOf(current), defectsOf(candidate)) &&
		routesNoWorse(candidate, current, false, true) &&
		headCrossers(candidate).size <= headCrossers(current).size &&
		hookedRoutes(candidate) <= hookedRoutes(current) &&
		detouredLines(candidate.edgeArrows) <= detouredLines(current.edgeArrows) &&
		dippedArrivals(candidate.edgeArrows).size <= dippedArrivals(current.edgeArrows).size &&
		labels!.every((count, index) => count <= currentLabels![index]!) &&
		drawnLongSide(candidate) <= drawnLongSide(current) + AXIS_ALIGNED_EPSILON &&
		sharedSegmentCount(candidate) <= sharedSegmentCount(current)
	);
}

/**
 * No more branch labels touching anything, and no label nearer another line,
 * by more, than it was: each label keeps its own room.
 */
export function labelsNoWorse(candidate: DiagramLayout, current: DiagramLayout): boolean {
	const [placed, was] = [candidate, current].map((layout) =>
		placedBranchLabels(
			[...layout.edgeArrows],
			layout.routedEdges,
			layout.nodeShapes,
			layout.groups,
			true,
			layout.lanes,
		),
	);
	const room = new Map(was!.shortfalls.map((label) => [label.index, label.shortfall]));
	return (
		placed!.touches <= was!.touches &&
		placed!.shortfalls.every(
			(label) => label.shortfall <= (room.get(label.index) ?? 0) + AXIS_ALIGNED_EPSILON,
		)
	);
}

/** Branch labels touching anything, then how far the labels fall short of their room. */
export function labelCrowding({
	edgeArrows,
	groups,
	lanes,
	nodeShapes,
	routedEdges,
}: DiagramLayout): [number, number] {
	const { shortfalls, touches } = placedBranchLabels(
		[...edgeArrows],
		routedEdges,
		nodeShapes,
		groups,
		true,
		lanes,
	);
	return [touches, shortfalls.reduce((total, label) => total + label.shortfall, 0)];
}

/** The drawing's width and height, labels included. */
export function drawnExtent(settled: DiagramLayout): { width: number; height: number } {
	return drawnSize(
		[...settled.nodeShapes, ...groupBlocks(settled.groups), ...laneBlocks(settled.lanes)],
		settled.edgeArrows,
		branchLabels(
			[...settled.edgeArrows],
			settled.routedEdges,
			settled.nodeShapes,
			settled.groups,
			true,
			settled.lanes,
		),
	);
}

/** The drawing's long side, labels included: a longer one shrinks all its text. */
export function drawnLongSide(settled: DiagramLayout): number {
	const { width, height } = drawnExtent(settled);
	return Math.max(width, height);
}
