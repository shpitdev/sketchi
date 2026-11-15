/** Owns node-side and port assignment, including lane handoffs, branches and paired returns. */
import {
	type RoutedEdge,
	type LayoutEdge,
	type LaneLayout,
	type LayoutDirection,
	type ConnectionEdge,
	type Wrap,
	type PortSlot,
	type PortPreference,
	type PortOrder,
	type GroupLayout,
} from "./layout-types.js";
import {
	FORWARD_SIDE,
	EDGE_NORMAL,
	isSelfLoop,
	center,
	PORT_SPACING,
	slotAxis,
	OPPOSITE_EDGE,
	portKey,
	farCoordinate,
	pairRank,
	connectionKey,
	portOffset,
	PORT_PADDING,
	ROUTE_STUB_LENGTH,
	clamp,
	loopCorner,
	pointOnEdge,
	pointAwayFromEdge,
	curvedSide,
	ARRIVAL_SPACING,
	connectionEdges,
	routeEndpoints,
	reservedArrivals,
	reservedDepartures,
	endRunOf,
} from "./geometry.js";
import { branches, branchLabelMetrics, markerSize, squareChoice } from "./measure.js";
import {
	AXIS_ALIGNED_EPSILON,
	type CanvasShapeElement as NodeSceneElement,
	type CanvasPoint as ScenePoint,
	canvasFrameNameBox,
	type CanvasConnectorElement as ArrowSceneElement,
} from "@sketchi/drawing";
import { type GraphInput } from "./input.js";
import { type GraphLayout } from "./topology.js";
import { labelBox } from "./label-geometry.js";
import { groupChain, obstacleBox } from "./containers.js";

/**
 * Each branch of a decision in lanes leaves by the vertex that faces its
 * target: the vertex across the flow toward a target in another lane, or the
 * forward vertex for one in the decision's own lane. Lanes hold targets where
 * their actors are, so two may lie on one side. A straight handoff keeps that
 * vertex first, then the branch furthest back along the flow; of the others,
 * one running ahead leaves forward, and one looping back leaves by the other
 * vertex across the flow, to run around rather than double back.
 */
export function assignLaneBranchSides(
	routes: readonly RoutedEdge[],
	lanes: LaneLayout,
	direction: LayoutDirection,
): void {
	const [across, along] = lanes.vertical ? (["x", "y"] as const) : (["y", "x"] as const);
	const forward = FORWARD_SIDE[direction];
	const ahead = EDGE_NORMAL[forward][along];
	const lateral = (sign: number): ConnectionEdge =>
		lanes.vertical ? (sign < 0 ? "left" : "right") : sign < 0 ? "top" : "bottom";
	for (const source of new Set(
		routes.filter((r) => branches(r.source.kind)).map((r) => r.source),
	)) {
		const own = routes.filter((route) => route.source === source && !isSelfLoop(route));
		if (own.length > 3) continue;
		const sideOf = (route: RoutedEdge) =>
			lanes.laneOf.get(route.target.nodeId) === lanes.laneOf.get(source.nodeId)
				? 0
				: Math.sign(center(route.target)[across] - center(source)[across]);
		const progress = (route: RoutedEdge) =>
			(center(route.target)[along] - center(source)[along]) * ahead;
		const size = lanes.vertical ? "height" : "width";
		const straight = (route: RoutedEdge) =>
			Math.min(source[along] + source[size], route.target[along] + route.target[size]) -
				Math.max(source[along], route.target[along]) >
			AXIS_ALIGNED_EPSILON;
		const taken = new Set<ConnectionEdge>();
		const pending: RoutedEdge[] = [];
		for (const sign of [-1, 1]) {
			const wanting = own
				.filter((route) => sideOf(route) === sign)
				.sort((a, b) => Number(straight(b)) - Number(straight(a)) || progress(a) - progress(b));
			if (wanting[0]) {
				wanting[0].sourceEdge = lateral(sign);
				taken.add(lateral(sign));
			}
			pending.push(...wanting.slice(1));
		}
		pending.push(...own.filter((route) => sideOf(route) === 0));
		for (const route of pending.sort((a, b) => progress(a) - progress(b))) {
			const sides =
				progress(route) < 0
					? [lateral(1), lateral(-1), forward]
					: [forward, lateral(-1), lateral(1)];
			route.sourceEdge = sides.find((side) => !taken.has(side)) ?? forward;
			taken.add(route.sourceEdge);
		}
	}
}

/**
 * In lanes no step takes lines in and sends lines out by one side: a
 * departure sharing a side with an arrival moves forward, or else to a side
 * across the flow, preferring one no other line leaves by.
 */
export function separateLaneRoles(routes: readonly RoutedEdge[], direction: LayoutDirection): void {
	const forward = FORWARD_SIDE[direction];
	const across: readonly ConnectionEdge[] =
		direction === "TB" || direction === "BT" ? ["left", "right"] : ["top", "bottom"];
	for (const route of routes) {
		if (isSelfLoop(route) || route.pinned !== undefined) continue;
		const node = route.source;
		const arrives = (side: ConnectionEdge) =>
			routes.some((other) => other.target === node && other.targetEdge === side);
		const leaves = (side: ConnectionEdge) =>
			routes.some((other) => other !== route && other.source === node && other.sourceEdge === side);
		if (!arrives(route.sourceEdge)) continue;
		const sides = [forward, ...across].filter((side) => !arrives(side));
		route.sourceEdge = sides.find((side) => !leaves(side)) ?? sides[0] ?? route.sourceEdge;
	}
}

/**
 * Each continuation of a wrapped laned diagram runs through the gap after its
 * source's pool, the gap's continuations side by side in edge order.
 */
export function assignLaneContinuations(
	routes: readonly RoutedEdge[],
	lanes: LaneLayout,
	wrap: Wrap,
): void {
	const across = lanes.vertical ? "x" : "y";
	const size = lanes.vertical ? "width" : "height";
	const continuations = routes.filter((route) => wrap.continuations.has(route.edge.id));
	for (const route of continuations) {
		const pool = wrap.bandOf.get(route.source.nodeId) ?? 0;
		const [before, after] = [lanes.pools[pool]!, lanes.pools[pool + 1]];
		if (!after) continue;
		const sharing = continuations.filter(
			(other) => (wrap.bandOf.get(other.source.nodeId) ?? 0) === pool,
		);
		const middle = (before[across] + before[size] + after[across]) / 2;
		route.lane = {
			at: middle + (sharing.indexOf(route) - (sharing.length - 1) / 2) * PORT_SPACING,
			vertical: lanes.vertical,
		};
	}
}

/**
 * Whether a route hands off straight across a lane boundary: between steps of
 * two lanes that share their extent along the flow, by the sides that face
 * each other across it.
 */
export function straightHandoff(route: RoutedEdge, lanes: LaneLayout): boolean {
	const { source, target } = route;
	const [along, size] = lanes.vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	return (
		lanes.laneOf.get(source.nodeId) !== lanes.laneOf.get(target.nodeId) &&
		slotAxis(route.sourceEdge) === along &&
		route.targetEdge === OPPOSITE_EDGE[route.sourceEdge] &&
		Math.min(source[along] + source[size], target[along] + target[size]) -
			Math.max(source[along], target[along]) >
			AXIS_ALIGNED_EPSILON
	);
}

/**
 * A handoff to a step in the same column of another lane runs straight across
 * the lane boundary: it leaves and arrives by the sides that face each other
 * across the flow.
 */
export function assignLaneSides(routes: readonly RoutedEdge[], lanes: LaneLayout): void {
	const [along, size] = lanes.vertical ? (["y", "height"] as const) : (["x", "width"] as const);
	for (const route of routes) {
		const { source, target } = route;
		if (
			isSelfLoop(route) ||
			lanes.continuations.has(route.edge.id) ||
			lanes.laneOf.get(source.nodeId) === lanes.laneOf.get(target.nodeId)
		)
			continue;
		const shared =
			Math.min(source[along] + source[size], target[along] + target[size]) -
			Math.max(source[along], target[along]);
		if (shared <= AXIS_ALIGNED_EPSILON) continue;
		const ahead = lanes.vertical
			? center(target).x > center(source).x
			: center(target).y > center(source).y;
		route.sourceEdge = lanes.vertical ? (ahead ? "right" : "left") : ahead ? "bottom" : "top";
		route.targetEdge = OPPOSITE_EDGE[route.sourceEdge];
	}
}

export function portOffsetsForRoutes(
	routes: readonly RoutedEdge[],
	sharedDecisionPitch = false,
): Map<string, number> {
	const connectionsByPort = new Map<
		string,
		Array<{ edgeId: string; endpoint: "source" | "target"; coordinate: number }>
	>();

	for (const route of routes) {
		const sourcePortKey = portKey(route.source.nodeId, route.sourceEdge);
		const targetPortKey = portKey(route.target.nodeId, route.targetEdge);

		connectionsByPort.set(sourcePortKey, [
			...(connectionsByPort.get(sourcePortKey) ?? []),
			{
				edgeId: route.edge.id,
				endpoint: "source",
				coordinate: farCoordinate(route, "source"),
			},
		]);
		connectionsByPort.set(targetPortKey, [
			...(connectionsByPort.get(targetPortKey) ?? []),
			{
				edgeId: route.edge.id,
				endpoint: "target",
				coordinate: farCoordinate(route, "target"),
			},
		]);
	}

	const offsets = new Map<string, number>();
	for (const connections of connectionsByPort.values()) {
		const departures = connections.filter((c) => c.endpoint === "source");
		const labeled = departures
			.map((c) => routes.find((r) => r.edge.id === c.edgeId)!)
			.filter((r) => r.edge.label);
		// Decision branches usually get a vertex each; two labeled ones sharing a side need room.
		const pitch =
			departures.length > 1 &&
			labeled.length > 0 &&
			(!branches(labeled[0]!.source.kind) || (sharedDecisionPitch && labeled.length > 1))
				? Math.max(
						PORT_SPACING,
						...labeled.map((r) => {
							const metrics = branchLabelMetrics(r.edge);
							return (
								(r.sourceEdge === "top" || r.sourceEdge === "bottom"
									? metrics.width
									: metrics.height) + 24
							);
						}),
					)
				: PORT_SPACING;
		connections
			.sort(
				(a, b) =>
					a.coordinate - b.coordinate || pairRank(routes, a.edgeId) - pairRank(routes, b.edgeId),
			)
			.forEach((connection, index) => {
				offsets.set(
					connectionKey(connection),
					(portOffset(index, connections.length) * pitch) / PORT_SPACING,
				);
			});
	}

	return offsets;
}

function slotSide(slot: PortSlot): ConnectionEdge {
	return slot.endpoint === "source" ? slot.route.sourceEdge : slot.route.targetEdge;
}

export function portLimit(node: NodeSceneElement, side: ConnectionEdge): number {
	return (slotAxis(side) === "x" ? node.width : node.height) / 2 - PORT_PADDING;
}

function slotStubLength(slot: PortSlot, point: ScenePoint): number {
	return slot.endpoint === "source"
		? sourceStubLength(slot.route, point, ROUTE_STUB_LENGTH)
		: targetStubLength(slot.route, point, ROUTE_STUB_LENGTH);
}

/**
 * Pool adjacent violators with each block held inside its bounds: the closest
 * nondecreasing sequence that respects nondecreasing lower and upper bounds.
 */
function boundedNondecreasingFit(
	values: readonly number[],
	low: readonly number[],
	high: readonly number[],
): number[] {
	const blocks: { count: number; high: number; low: number; sum: number; value: number }[] = [];
	for (const [index, value] of values.entries()) {
		blocks.push({
			count: 1,
			high: high[index]!,
			low: low[index]!,
			sum: value,
			value: clamp(value, low[index]!, Math.max(low[index]!, high[index]!)),
		});
		while (blocks.length > 1 && blocks.at(-2)!.value > blocks.at(-1)!.value) {
			const last = blocks.pop()!;
			const block = blocks.at(-1)!;
			block.count += last.count;
			block.sum += last.sum;
			block.low = Math.max(block.low, last.low);
			block.high = Math.min(block.high, last.high);
			block.value = clamp(block.sum / block.count, block.low, Math.max(block.low, block.high));
		}
	}
	return blocks.flatMap((block) => Array<number>(block.count).fill(block.value));
}

const FREE_PORT: PortPreference = { desired: 0, high: Infinity, low: -Infinity, priority: 0 };

/**
 * Ordered offsets on one side, at least `gaps` apart and near their desired
 * offsets. Bounds are kept by priority while they stay jointly satisfiable. A
 * side that cannot hold every gap is centered and widened by the capacity pass.
 */
function spreadPorts(
	preferences: readonly PortPreference[],
	gaps: readonly number[],
	limit: number,
): number[] {
	const before = preferences.map((_, index) =>
		gaps.slice(0, index).reduce((sum, gap) => sum + gap, 0),
	);
	const total = before.at(-1) ?? 0;
	if (total > 2 * limit) return before.map((offset) => offset - total / 2);
	// Work in gap-free coordinates, where ordered ports with gaps become nondecreasing.
	const low = preferences.map(() => -Infinity);
	const high = preferences.map(() => Infinity);
	const envelope = () => {
		const lows = low.map((value, index) => Math.max(value - before[index]!, -limit));
		const highs = high.map((value, index) => Math.min(value - before[index]!, limit - total));
		for (let index = 1; index < lows.length; index += 1)
			lows[index] = Math.max(lows[index]!, lows[index - 1]!);
		for (let index = highs.length - 2; index >= 0; index -= 1)
			highs[index] = Math.min(highs[index]!, highs[index + 1]!);
		return { highs, lows };
	};
	const constrained = preferences
		.map((preference, index) => ({ index, priority: preference.priority }))
		.filter(({ priority }) => priority > 0)
		.sort((a, b) => b.priority - a.priority || a.index - b.index);
	for (const { index } of constrained) {
		low[index] = preferences[index]!.low;
		high[index] = preferences[index]!.high;
		const { highs, lows } = envelope();
		if (lows.some((value, at) => value > highs[at]! + AXIS_ALIGNED_EPSILON)) {
			low[index] = -Infinity;
			high[index] = Infinity;
		}
	}
	const { highs, lows } = envelope();
	return boundedNondecreasingFit(
		preferences.map((preference, index) => preference.desired - before[index]!),
		lows,
		highs,
	).map((value, index) => value + before[index]!);
}

/**
 * Where a port lets its edge leave or arrive without a jog: past the other end's
 * stub for an L-shaped route, or straight across from a facing port. A lone port
 * on a diamond or ellipse keeps its vertex unless it faces another lone one.
 */
function slotPreference(
	slot: PortSlot,
	offsets: ReadonlyMap<string, number>,
	slotsBySide: ReadonlyMap<string, readonly PortSlot[]>,
): PortPreference {
	const preference = lineSlotPreference(slot, offsets, slotsBySide);
	const node = slot.route[slot.endpoint];
	if (node.kind !== "composite" || slotSide(slot) !== "top") return preference;
	// A composite's frame carries its name above its top-left corner; ports on
	// its top keep right of the name.
	const name = canvasFrameNameBox({ ...node, name: node.label });
	const low = name.x + name.width + PORT_SPACING - center(node).x;
	return {
		...preference,
		desired: Math.max(low, preference.desired),
		low: Math.max(low, preference.low),
		high: Math.max(low, preference.high),
		priority: 3,
	};
}

function lineSlotPreference(
	slot: PortSlot,
	offsets: ReadonlyMap<string, number>,
	slotsBySide: ReadonlyMap<string, readonly PortSlot[]>,
): PortPreference {
	const other: PortSlot = {
		endpoint: slot.endpoint === "source" ? "target" : "source",
		key: connectionKey({
			edgeId: slot.route.edge.id,
			endpoint: slot.endpoint === "source" ? "target" : "source",
		}),
		route: slot.route,
	};
	const node = slot.route[slot.endpoint];
	const side = slotSide(slot);
	const otherSide = slotSide(other);
	const axis = slotAxis(side);
	const normal = EDGE_NORMAL[side];
	if (isSelfLoop(slot.route)) {
		const corner = loopCorner(slot.route, slot.endpoint) * Math.max(0, portLimit(node, side));
		return { desired: corner, high: corner, low: corner, priority: 2 };
	}
	const here = pointOnEdge(node, side, offsets.get(slot.key) ?? 0);
	const there = pointOnEdge(slot.route[other.endpoint], otherSide, offsets.get(other.key) ?? 0);
	const ahead = (there.x - here.x) * normal.x + (there.y - here.y) * normal.y;
	if (slotAxis(otherSide) !== axis && ahead >= slotStubLength(slot, here)) {
		const reach = pointAwayFromEdge(there, otherSide, slotStubLength(other, there));
		const toward = EDGE_NORMAL[otherSide][axis];
		const bound = reach[axis] - center(node)[axis];
		return {
			desired: 0,
			high: toward < 0 ? bound : Infinity,
			lane: toward * ahead,
			low: toward > 0 ? bound : -Infinity,
			priority: 1,
		};
	}
	const lone = (target: PortSlot, sideOfTarget: ConnectionEdge) =>
		curvedSide(target.route[target.endpoint], sideOfTarget) &&
		slotsBySide.get(portKey(target.route[target.endpoint].nodeId, sideOfTarget))?.length === 1;
	const facing = otherSide === OPPOSITE_EDGE[side] && ahead > 0;
	if (lone(slot, side) && !(facing && slot.endpoint === "target" && lone(other, otherSide)))
		return { desired: 0, high: 0, low: 0, priority: 2 };
	const straight = there[axis] - center(node)[axis];
	return facing && Math.abs(straight) <= portLimit(node, side)
		? { desired: straight, high: straight, low: straight, priority: 2 }
		: FREE_PORT;
}

/**
 * Side order that avoids crossings: by the far node along the side or, `byApproach`,
 * by where each route leaves the far node past its stub, so a decision branch
 * leaving a vertex beside a node in line with this one lands on the side it
 * approaches from. L-shaped arrivals travelling the same way nest, the farthest
 * cross run outermost.
 */
function orderedSlots(
	slots: readonly PortSlot[],
	preferences: ReadonlyMap<PortSlot, PortPreference>,
	offsets: ReadonlyMap<string, number>,
	byApproach: PortOrder,
): PortSlot[] {
	const far = (slot: PortSlot) => {
		const endpoint = slot.endpoint === "source" ? "target" : "source";
		if (!byApproach || isSelfLoop(slot.route)) return farCoordinate(slot.route, slot.endpoint);
		const node = slot.route[endpoint];
		const side = endpoint === "source" ? slot.route.sourceEdge : slot.route.targetEdge;
		const key = connectionKey({ edgeId: slot.route.edge.id, endpoint });
		const departure = pointAwayFromEdge(
			pointOnEdge(node, side, offsets.get(key) ?? 0),
			side,
			ROUTE_STUB_LENGTH,
		);
		return departure[slotAxis(slotSide(slot))];
	};
	const ordered = [...slots].sort(
		(a, b) => far(a) - far(b) || (a.route.pair ?? 0) - (b.route.pair ?? 0),
	);
	// Nested, lines that leave this side and come back into the same side of
	// another node beyond this one along it run around in lanes, the one
	// reaching farther outermost: those heading the same way nest, the farthest
	// reaching leaving from farthest along the way they head, so none crosses
	// another's turn.
	const node = slots[0]?.route[slots[0].endpoint];
	if (byApproach === "nested" && node && slots.length > 1) {
		const axis = slotAxis(slotSide(slots[0]!));
		const size = axis === "x" ? "width" : "height";
		const around = (slot: PortSlot) => {
			const otherSide = slot.endpoint === "source" ? slot.route.targetEdge : slot.route.sourceEdge;
			if (isSelfLoop(slot.route) || otherSide !== slotSide(slot)) return 0;
			const reach = farCoordinate(slot.route, slot.endpoint);
			return reach < node[axis] ? -1 : reach > node[axis] + node[size] ? 1 : 0;
		};
		for (const toward of [1, -1]) {
			const nesting = ordered
				.map((slot, index) => ({ index, slot }))
				.filter(({ slot }) => around(slot) === toward);
			const nested = [...nesting].sort((a, b) => far(b.slot) - far(a.slot));
			nesting.forEach(({ index }, at) => {
				ordered[index] = nested[at]!.slot;
			});
		}
	}
	for (const toward of [1, -1]) {
		const lanes = ordered
			.map((slot, index) => ({ index, lane: preferences.get(slot)!.lane, slot }))
			.filter(({ lane }) => lane !== undefined && Math.sign(lane) === toward);
		const nested = [...lanes].sort((a, b) => a.lane! - b.lane!);
		lanes.forEach(({ index }, at) => {
			ordered[index] = nested[at]!.slot;
		});
	}
	return ordered;
}

/**
 * Orthogonal port offsets that keep edges straight into their arrowheads. Sides
 * are revisited a few times so facing ports settle on one shared coordinate.
 */
export function alignedPortOffsets(
	routes: readonly RoutedEdge[],
	sharedDecisionPitch: boolean,
	byApproach: PortOrder = false,
	arrivalSpacing = ARRIVAL_SPACING,
): Map<string, number> {
	const offsets = portOffsetsForRoutes(routes, sharedDecisionPitch);
	const slotsBySide = new Map<string, PortSlot[]>();
	for (const route of routes)
		for (const endpoint of ["source", "target"] as const) {
			const key = portKey(
				route[endpoint].nodeId,
				endpoint === "source" ? route.sourceEdge : route.targetEdge,
			);
			slotsBySide.set(key, [
				...(slotsBySide.get(key) ?? []),
				{ endpoint, key: connectionKey({ edgeId: route.edge.id, endpoint }), route },
			]);
		}
	// Crowded sides settle first; lone ports then line up with them.
	const sides = [...slotsBySide.values()].sort((a, b) => b.length - a.length);
	for (let sweep = 0; sweep < 3; sweep += 1)
		for (const unordered of sides) {
			const side = slotSide(unordered[0]!);
			const node = unordered[0]!.route[unordered[0]!.endpoint];
			const preferences = new Map(
				unordered.map((slot) => [slot, slotPreference(slot, offsets, slotsBySide)]),
			);
			const slots = orderedSlots(unordered, preferences, offsets, byApproach);
			const departures = slots.filter((slot) => slot.endpoint === "source");
			const labeled = departures.filter((slot) => slot.route.edge.label);
			const labelPitch =
				departures.length > 1 &&
				labeled.length > 0 &&
				(!branches(labeled[0]!.route.source.kind) || (sharedDecisionPitch && labeled.length > 1))
					? Math.max(
							...labeled.map((slot) => {
								const metrics = branchLabelMetrics(slot.route.edge);
								return (slotAxis(side) === "x" ? metrics.width : metrics.height) + 24;
							}),
						)
					: 0;
			if (node.kind === "state") outerLabelSides(slots);
			const positions = spreadPorts(
				slots.map((slot) => preferences.get(slot)!),
				slots
					.slice(1)
					.map((slot, index) =>
						Math.max(
							node.kind === "state" ? stateLabelGap(slots[index]!, slot, side) : labelPitch,
							slot.endpoint === "target" || slots[index]!.endpoint === "target"
								? arrivalSpacing
								: PORT_SPACING,
						),
					),
				portLimit(node, side),
			);
			slots.forEach((slot, index) => offsets.set(slot.key, positions[index]!));
		}
	return offsets;
}

/**
 * A state's outermost departures on a side carry their labels outside the
 * others: the lowest toward the low end (left or above), the highest toward the
 * high end, so neighboring lines need no room for a label between them.
 */
function outerLabelSides(slots: readonly PortSlot[]): void {
	for (const [index, slot] of slots.entries()) {
		const { route } = slot;
		if (slot.endpoint !== "source" || route.pair !== undefined || isSelfLoop(route)) continue;
		const outer = index === 0 ? -1 : index === slots.length - 1 ? 1 : undefined;
		if (slots.length > 1 && outer !== undefined) route.labelSide = outer;
		else delete route.labelSide;
	}
}

/** The side of its line a route's label sits on: right of a vertical stub, above a horizontal one. */
function labelSideOf(route: RoutedEdge): -1 | 1 {
	const horizontal = route.sourceEdge === "left" || route.sourceEdge === "right";
	return route.labelSide ?? route.pair ?? (horizontal ? -1 : 1);
}

/**
 * Room a state keeps between two neighboring ports on one side for the labels
 * that sit between them: a departure's label lies right of a vertical stub and
 * above a horizontal one, or on its own side of a pair.
 */
function stateLabelGap(low: PortSlot, high: PortSlot, side: ConnectionEdge): number {
	const reach = (slot: PortSlot, toward: -1 | 1) => {
		const { route } = slot;
		const vertical = slotAxis(side) === "x";
		if (slot.endpoint !== "source" || !route.edge.label || isSelfLoop(route)) return 0;
		if (labelSideOf(route) !== toward) return 0;
		const metrics = branchLabelMetrics(route.edge, branches(route.source.kind));
		return (vertical ? metrics.width : metrics.height) + 24;
	};
	return Math.max(reach(low, 1), reach(high, -1));
}

export function routeForEdge(
	edge: LayoutEdge,
	index: number,
	shapesByNodeId: ReadonlyMap<string, NodeSceneElement>,
	direction: GraphInput["layout"]["direction"],
	continuation = false,
): RoutedEdge {
	const source = shapesByNodeId.get(edge.source);
	const target = shapesByNodeId.get(edge.target);

	if (!source || !target) {
		throw new Error(`Cannot render edge "${edge.id}" with unresolved nodes.`);
	}

	// A continuation leaves forward and arrives forward, like the line break it is.
	const { sourceEdge, targetEdge } = continuation
		? { sourceEdge: FORWARD_SIDE[direction], targetEdge: OPPOSITE_EDGE[FORWARD_SIDE[direction]] }
		: connectionEdges(source, target, direction);

	return {
		edge,
		index,
		source,
		sourceEdge,
		target,
		targetEdge,
	};
}

/** Size the dimension along each assigned side before offsets can be clamped. */
export function portCapacityForRoutes(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): Map<string, { width: number; height: number }> {
	const sizes = new Map<string, { width: number; height: number }>();
	for (const route of routes) {
		for (const endpoint of ["source", "target"] as const) {
			const node = route[endpoint];
			// A marker keeps its size; its one transition takes the middle of a side.
			if (markerSize(node) !== undefined) continue;
			const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
			const dimension = side === "top" || side === "bottom" ? "width" : "height";
			const required =
				2 *
				(PORT_PADDING +
					Math.abs(offsets.get(connectionKey({ edgeId: route.edge.id, endpoint })) ?? 0));
			if (required <= (sizes.get(node.nodeId)?.[dimension] ?? node[dimension])) continue;
			const size = sizes.get(node.nodeId) ?? { width: node.width, height: node.height };
			size[dimension] = required;
			sizes.set(node.nodeId, node.kind === "choice" && !node.label ? squareChoice(size, 0) : size);
		}
	}
	return sizes;
}

/** A direct segment has no intermediate bends; test diagonals as well as axis-aligned lines. */
export function directSegmentCrossesNode(
	start: ScenePoint,
	end: ScenePoint,
	node: NodeSceneElement,
): boolean {
	let enter = 0,
		leave = 1;
	for (const [coordinate, size] of [
		["x", "width"],
		["y", "height"],
	] as const) {
		const minimum = node[coordinate] + AXIS_ALIGNED_EPSILON;
		const maximum = node[coordinate] + node[size] - AXIS_ALIGNED_EPSILON;
		const delta = end[coordinate] - start[coordinate];
		if (Math.abs(delta) <= AXIS_ALIGNED_EPSILON) {
			if (start[coordinate] <= minimum || start[coordinate] >= maximum) return false;
		} else {
			const a = (minimum - start[coordinate]) / delta;
			const b = (maximum - start[coordinate]) / delta;
			enter = Math.max(enter, Math.min(a, b));
			leave = Math.min(leave, Math.max(a, b));
		}
	}
	return enter < leave;
}

function directEndpointFacesOut(
	node: NodeSceneElement,
	side: ConnectionEdge,
	point: ScenePoint,
	other: ScenePoint,
): boolean {
	const x = (point.x - center(node).x) / (node.width / 2);
	const y = (point.y - center(node).y) / (node.height / 2);
	const normal =
		node.shape === "ellipse" || node.shape === "circle"
			? { x: x / node.width, y: y / node.height }
			: node.shape === "diamond"
				? { x: Math.sign(x) / node.width, y: Math.sign(y) / node.height }
				: {
						x: side === "left" ? -1 : side === "right" ? 1 : 0,
						y: side === "top" ? -1 : side === "bottom" ? 1 : 0,
					};
	return (
		(normal.x * (other.x - point.x) + normal.y * (other.y - point.y)) /
			Math.hypot(normal.x, normal.y) >=
		-AXIS_ALIGNED_EPSILON
	);
}

/** Collinear overlap also matters for diagonal direct edges, not just orthogonal segments. */
function directSegmentsOverlap(
	start: ScenePoint,
	end: ScenePoint,
	a: ScenePoint,
	b: ScenePoint,
): boolean {
	const dx = end.x - start.x,
		dy = end.y - start.y,
		length = Math.hypot(dx, dy);
	if (length <= AXIS_ALIGNED_EPSILON) return false;
	const distance = (p: ScenePoint) =>
		Math.abs(dx * (p.y - start.y) - dy * (p.x - start.x)) / length;
	if (distance(a) > AXIS_ALIGNED_EPSILON || distance(b) > AXIS_ALIGNED_EPSILON) return false;
	const projection = (p: ScenePoint) => ((p.x - start.x) * dx + (p.y - start.y) * dy) / length;
	const from = projection(a),
		to = projection(b);
	return (
		Math.min(length, Math.max(from, to)) - Math.max(0, Math.min(from, to)) > AXIS_ALIGNED_EPSILON
	);
}

/** Keep facing ports unless a direct feedback segment needs an obstacle-safe boundary pair. */
export function assignDirectFeedbackPorts(
	layoutGraph: GraphLayout,
	routes: RoutedEdge[],
	nodes: readonly NodeSceneElement[],
	repairForward = false,
): { offsets: Map<string, number>; minimumSizes: Map<string, { width: number; height: number }> } {
	const diagram = layoutGraph.input;

	const minimumSizes = new Map<string, { width: number; height: number }>();
	const feedback = layoutGraph.feedback;
	const sides: ConnectionEdge[] =
		diagram.layout.direction === "TB" || diagram.layout.direction === "BT"
			? ["right", "left", "top", "bottom"]
			: ["bottom", "top", "left", "right"];
	// Reserve forward endpoints too: later feedback side changes must not move defaults
	// onto endpoints that an earlier candidate already checked and selected.
	const chosenOffsets = portOffsetsForRoutes(routes);
	// With repair on, a forward line that crosses a node or turns back into its own
	// node gets the same obstacle-safe port search as feedback.
	const blocked = (route: RoutedEdge) => {
		const { start, end } = routeEndpoints(route, chosenOffsets);
		return (
			!directEndpointFacesOut(route.source, route.sourceEdge, start, end) ||
			!directEndpointFacesOut(route.target, route.targetEdge, end, start) ||
			nodes.some(
				(n) => n !== route.source && n !== route.target && directSegmentCrossesNode(start, end, n),
			)
		);
	};
	for (const route of routes.filter(
		(r) => feedback.has(r.edge.id) || (repairForward && blocked(r)),
	)) {
		const original = { sourceEdge: route.sourceEdge, targetEdge: route.targetEdge };
		const sourceKey = connectionKey({ edgeId: route.edge.id, endpoint: "source" });
		const targetKey = connectionKey({ edgeId: route.edge.id, endpoint: "target" });
		let fallback:
			| { sides: typeof original; sourceOffset: number; targetOffset: number }
			| undefined;
		const sidePairs = [
			original,
			...sides.map((side) => ({ sourceEdge: side, targetEdge: side })),
			...sides.flatMap((sourceEdge) => sides.map((targetEdge) => ({ sourceEdge, targetEdge }))),
		];
		// Try every ordinary port pair before using inset boundary extremes.
		const candidates = [false, true].flatMap((spread) =>
			sidePairs.map((pair) => ({ ...pair, spread })),
		);
		let found = false;
		for (const candidate of candidates) {
			Object.assign(route, { sourceEdge: candidate.sourceEdge, targetEdge: candidate.targetEdge });
			const offsets = new Map(chosenOffsets);
			const alternatives = (node: NodeSceneElement, side: ConnectionEdge, key: string) => {
				const limit =
					(side === "top" || side === "bottom" ? node.width : node.height) / 2 - PORT_PADDING;
				return candidate.spread ? [offsets.get(key) ?? 0, -limit, limit] : [offsets.get(key) ?? 0];
			};
			const sourceOffsets = alternatives(route.source, route.sourceEdge, sourceKey);
			const targetOffsets = alternatives(route.target, route.targetEdge, targetKey);
			for (const sourceOffset of sourceOffsets) {
				for (const targetOffset of targetOffsets) {
					offsets.set(sourceKey, sourceOffset);
					offsets.set(targetKey, targetOffset);
					const { start, end } = routeEndpoints(route, offsets);
					if (
						!directEndpointFacesOut(route.source, route.sourceEdge, start, end) ||
						!directEndpointFacesOut(route.target, route.targetEdge, end, start)
					)
						continue;
					if (
						nodes.some(
							(n) =>
								n !== route.source && n !== route.target && directSegmentCrossesNode(start, end, n),
						)
					)
						continue;
					if (
						routes.some((other) => {
							if (other === route) return false;
							const { start: a, end: b } = routeEndpoints(other, offsets);
							const sharedPoint = [
								[route.source, start, other.source, a],
								[route.source, start, other.target, b],
								[route.target, end, other.source, a],
								[route.target, end, other.target, b],
							] as const;
							return (
								sharedPoint.some(
									([node, p, otherNode, q]) =>
										node === otherNode && Math.hypot(p.x - q.x, p.y - q.y) <= AXIS_ALIGNED_EPSILON,
								) || directSegmentsOverlap(start, end, a, b)
							);
						})
					)
						continue;
					const labelObstacles = branchLabelObstacles(routes, offsets);
					const ownLabel = labelObstacles.find(
						(label) => label.nodeId === `branch-label:${route.edge.id}`,
					);
					if (ownLabel && directSegmentCrossesNode(start, end, ownLabel)) continue;
					fallback ??= { sides: candidate, sourceOffset, targetOffset };
					if (
						labelObstacles.some(
							(label) =>
								label.nodeId !== `branch-label:${route.edge.id}` &&
								directSegmentCrossesNode(start, end, label),
						)
					)
						continue;
					chosenOffsets.set(sourceKey, sourceOffset);
					chosenOffsets.set(targetKey, targetOffset);
					found = true;
					break;
				}
				if (found) break;
			}
			if (found) break;
		}
		if (!found && !feedback.has(route.edge.id)) {
			Object.assign(route, fallback?.sides ?? original);
			if (fallback) {
				chosenOffsets.set(sourceKey, fallback.sourceOffset);
				chosenOffsets.set(targetKey, fallback.targetOffset);
			}
		} else if (!found) {
			Object.assign(route, fallback?.sides ?? original);
			if (fallback) {
				chosenOffsets.set(sourceKey, fallback.sourceOffset);
				chosenOffsets.set(targetKey, fallback.targetOffset);
			} else {
				const vertical = diagram.layout.direction === "TB" || diagram.layout.direction === "BT";
				const coordinate = vertical ? "x" : "y",
					dimension = vertical ? "width" : "height";
				const origin = center(route.source)[coordinate];
				const extent = Math.max(
					...nodes.flatMap((n) => [
						Math.abs(n[coordinate] - origin),
						Math.abs(n[coordinate] + n[dimension] - origin),
					]),
				);
				minimumSizes.set(route.source.nodeId, {
					width: route.source.width,
					height: route.source.height,
					[dimension]: 2 * (extent + PORT_PADDING + PORT_SPACING),
				});
			}
		}
	}
	return { offsets: chosenOffsets, minimumSizes };
}

/**
 * How far the reserved endpoint stubs reach past each node side's bounding
 * box, and a self-loop's label, or with `labels` every branch label, beside
 * its stub.
 */
export function stubReachForRoutes(
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
	labels = false,
): Map<string, number> {
	const reach = new Map<string, number>();
	for (const route of routes) {
		const { start, end } = routeEndpoints(route, portOffsets);
		for (const [node, side, length] of [
			[route.source, route.sourceEdge, sourceStubLength(route, start, ROUTE_STUB_LENGTH)],
			[route.target, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)],
		] as const) {
			const point = node === route.source ? start : end;
			const tip = pointAwayFromEdge(point, side, length);
			const beyond =
				side === "left"
					? node.x - tip.x
					: side === "right"
						? tip.x - node.x - node.width
						: side === "top"
							? node.y - tip.y
							: tip.y - node.y - node.height;
			const key = portKey(node.nodeId, side);
			reach.set(key, Math.max(reach.get(key) ?? 0, beyond));
		}
		// A self-loop's label sits outside its loop.
		if (route.edge.label && (labels || isSelfLoop(route))) {
			const node = route.source;
			const box = labelBox(
				branchLabelPosition(route, start),
				branchLabelMetrics(route.edge, branches(node.kind)),
			);
			for (const [side, beyond] of [
				["left", node.x - box.x],
				["right", box.x + box.width - node.x - node.width],
				["top", node.y - box.y],
				["bottom", box.y + box.height - node.y - node.height],
			] as const) {
				const key = portKey(node.nodeId, side);
				if (beyond > 0) reach.set(key, Math.max(reach.get(key) ?? 0, beyond));
			}
		}
	}
	return reach;
}

/** Reserve fixed endpoint approaches before any route can occupy a later route's stub. */
export function endpointStubsForRoutes(
	routes: readonly RoutedEdge[],
	portOffsets: ReadonlyMap<string, number>,
): ArrowSceneElement[] {
	return routes.flatMap((route): ArrowSceneElement[] => {
		const { start, end } = routeEndpoints(route, portOffsets);
		const arrow = {
			type: "arrow" as const,
			id: `edge:${route.edge.id}`,
			edgeId: route.edge.id,
			sourceNodeId: route.edge.source,
			targetNodeId: route.edge.target,
		};
		const arrival: ArrowSceneElement = {
			...arrow,
			points: [
				pointAwayFromEdge(end, route.targetEdge, targetStubLength(route, end, ROUTE_STUB_LENGTH)),
				end,
			],
		};
		const departure: ArrowSceneElement = {
			...arrow,
			endArrowhead: null,
			points: [
				start,
				pointAwayFromEdge(
					start,
					route.sourceEdge,
					sourceStubLength(route, start, ROUTE_STUB_LENGTH),
				),
			],
		};
		reservedArrivals.add(arrival);
		reservedDepartures.add(departure);
		return [departure, arrival];
	});
}

/** Clear the bounding box even when the port is inset on a diamond or ellipse. */
function endpointClearance(
	shape: NodeSceneElement,
	point: ScenePoint,
	side: ConnectionEdge,
	distance: number,
): number {
	switch (side) {
		case "left":
			return distance + point.x - shape.x;
		case "right":
			return distance + shape.x + shape.width - point.x;
		case "top":
			return distance + point.y - shape.y;
		case "bottom":
			return distance + shape.y + shape.height - point.y;
	}
}

/** An arrival's stub: at least `distance`, and the end run its line keeps. */
export function targetStubLength(route: RoutedEdge, point: ScenePoint, distance: number): number {
	return endpointClearance(
		route.target,
		point,
		route.targetEdge,
		Math.max(distance, endRunOf(route, "target")),
	);
}

export function sourceStubLength(route: RoutedEdge, point: ScenePoint, distance: number): number {
	// A self-loop's label sits outside its loop, not beside its stub.
	const labelSpace =
		route.edge.label && !isSelfLoop(route)
			? route.sourceEdge === "left" || route.sourceEdge === "right"
				? branchLabelMetrics(route.edge, branches(route.source.kind)).width + 16
				: Math.max(40, branchLabelMetrics(route.edge, branches(route.source.kind)).height + 24)
			: 0;
	// A label sits past the end run.
	return endpointClearance(
		route.source,
		point,
		route.sourceEdge,
		Math.max(
			distance,
			endRunOf(route, "source") + Math.min(labelSpace, choiceStubRoom(route, point)),
		),
	);
}

/**
 * How far a choice's departure stub may run before it passes the
 * stub its target arrives by from the facing side, which would force the line
 * to double back. A label longer than that slides along the line instead.
 */
function choiceStubRoom(route: RoutedEdge, point: ScenePoint): number {
	if (route.source.kind !== "choice" || route.targetEdge !== OPPOSITE_EDGE[route.sourceEdge])
		return Infinity;
	const normal = EDGE_NORMAL[route.sourceEdge];
	const axis = normal.x === 0 ? "y" : "x";
	const size = axis === "x" ? "width" : "height";
	const sign = normal[axis];
	// A line that can run straight into its target never doubles back.
	const [across, breadth] = axis === "x" ? (["y", "height"] as const) : (["x", "width"] as const);
	if (
		point[across] >= route.target[across] &&
		point[across] <= route.target[across] + route.target[breadth]
	)
		return Infinity;
	const near = sign > 0 ? route.target[axis] : route.target[axis] + route.target[size];
	const ahead = (near - point[axis]) * sign - ROUTE_STUB_LENGTH - PORT_SPACING;
	return ahead > ROUTE_STUB_LENGTH ? ahead : Infinity;
}

/**
 * Decision branches take distinct vertices: the two lateral vertices for the
 * outer branches and the forward vertex for an aligned or middle branch. LR and
 * RL mirror TB and BT only when `mirrored`: orthogonal stubs carry a branch out
 * of its vertex before turning, but a direct line from a top or bottom vertex
 * could cut back through the diamond.
 */
export function assignDecisionSides(
	routes: RoutedEdge[],
	direction: GraphInput["layout"]["direction"],
	mirrored = false,
): void {
	const vertical = direction === "TB" || direction === "BT";
	if (!vertical && !mirrored) return;
	const across = vertical ? "x" : "y";
	const along = vertical ? "y" : "x";
	const [low, high]: readonly [ConnectionEdge, ConnectionEdge] = vertical
		? ["left", "right"]
		: ["top", "bottom"];
	const forward: ConnectionEdge =
		direction === "TB"
			? "bottom"
			: direction === "BT"
				? "top"
				: direction === "LR"
					? "right"
					: "left";
	for (const source of new Set(
		routes.filter((r) => branches(r.source.kind)).map((r) => r.source),
	)) {
		const branches = routes
			.filter((r) => r.source === source)
			.sort(
				(a, b) =>
					center(a.target)[across] - center(b.target)[across] ||
					center(a.target)[along] - center(b.target)[along] ||
					a.index - b.index,
			);
		if (branches.length < 2) continue;
		branches.forEach((route, index) => {
			const alignedBranch = branches
				.filter((r) => Math.abs(center(r.target)[across] - center(source)[across]) < 1)
				.sort(
					(a, b) =>
						Math.abs(center(a.target)[along] - center(source)[along]) -
						Math.abs(center(b.target)[along] - center(source)[along]),
				)[0];
			const aligned = branches.length === 2 && route === alignedBranch;
			const otherAligned = branches.length === 2 && alignedBranch !== undefined && !aligned;
			route.sourceEdge = aligned
				? forward
				: otherAligned
					? center(route.target)[across] < center(source)[across]
						? low
						: high
					: index === 0
						? low
						: index === branches.length - 1
							? high
							: forward;
		});
	}
}

/** Feedback uses a lateral lane, not the forward departure/arrival side. */
export function assignFeedbackSides(
	layoutGraph: GraphLayout,
	routes: RoutedEdge[],
	directionOf: (route: RoutedEdge) => LayoutDirection = () => layoutGraph.input.layout.direction,
): void {
	const feedback = layoutGraph.feedback;
	for (const route of routes.filter((r) => feedback.has(r.edge.id) && !isSelfLoop(r))) {
		const direction = directionOf(route);
		const horizontal = direction === "LR" || direction === "RL";
		const before = horizontal
			? center(route.source).y < center(route.target).y
			: center(route.source).x < center(route.target).x;
		const lateral: ConnectionEdge[] = horizontal
			? before
				? ["top", "bottom"]
				: ["bottom", "top"]
			: before
				? ["left", "right"]
				: ["right", "left"];
		const candidates: ConnectionEdge[] = [
			...lateral,
			...(horizontal ? (["left", "right"] as const) : (["top", "bottom"] as const)),
		];
		const departures = new Set(
			routes.filter((r) => r !== route && r.source === route.target).map((r) => r.sourceEdge),
		);
		const arrivals = new Set(
			routes.filter((r) => r !== route && r.target === route.source).map((r) => r.targetEdge),
		);
		const targetArrivals = new Set(
			routes.filter((r) => r !== route && r.target === route.target).map((r) => r.targetEdge),
		);
		const siblingDepartures = new Set(
			routes.filter((r) => r !== route && r.source === route.source).map((r) => r.sourceEdge),
		);
		const sourceCandidates = branches(route.source.kind)
			? [route.sourceEdge, ...candidates]
			: candidates;

		route.targetEdge =
			candidates.find((side) => !departures.has(side) && !targetArrivals.has(side)) ??
			candidates.find((side) => !departures.has(side)) ??
			route.targetEdge;
		route.sourceEdge =
			sourceCandidates.find(
				(side) =>
					!arrivals.has(side) &&
					(!branches(route.source.kind) || !siblingDepartures.has(side)) &&
					(route.source !== route.target || side !== route.targetEdge),
			) ?? route.sourceEdge;
	}
}

/**
 * A self-loop leaves a side across the flow and returns into the side the flow
 * enters by, drawn as a loop around the corner between them: clear of the
 * departures and their labels on the side the flow leaves by. It takes the
 * side across the flow with fewer other ends, and a node's next loop the next
 * free corner.
 */
export function assignLoopSides(
	routes: RoutedEdge[],
	directionOf: (route: RoutedEdge) => LayoutDirection,
): void {
	const taken = new Map<string, Set<string>>();
	for (const route of routes.filter(isSelfLoop)) {
		const direction = directionOf(route);
		const entry = OPPOSITE_EDGE[FORWARD_SIDE[direction]];
		const across: readonly ConnectionEdge[] =
			direction === "TB" || direction === "BT" ? ["right", "left"] : ["bottom", "top"];
		const ends = (side: ConnectionEdge) =>
			routes.filter(
				(other) =>
					!isSelfLoop(other) &&
					((other.source === route.source && other.sourceEdge === side) ||
						(other.target === route.source && other.targetEdge === side)),
			).length;
		const lateral = [...across].sort((a, b) => ends(a) - ends(b));
		const corners = [
			...lateral.map((side) => [side, entry] as const),
			...lateral.map((side) => [side, FORWARD_SIDE[direction]] as const),
		];
		const used = taken.get(route.source.nodeId) ?? new Set<string>();
		const [sourceEdge, targetEdge] =
			corners.find(([side, other]) => !used.has(`${side}:${other}`)) ?? corners[0]!;
		used.add(`${sourceEdge}:${targetEdge}`);
		taken.set(route.source.nodeId, used);
		route.sourceEdge = sourceEdge;
		route.targetEdge = targetEdge;
	}
}

/**
 * A return whose transition runs the other way between the same two nodes, with
 * nothing between them, runs back alongside it between the sides they face
 * each other with, so the pair reads as one two-way link. The transition runs
 * on the low side (left or above) and the return on the high side, each label
 * outside the pair.
 */
export function assignPairedReturns(
	routes: RoutedEdge[],
	feedback: ReadonlySet<string>,
	nodes: readonly NodeSceneElement[],
	groups: GroupLayout | undefined,
	unpaired: ReadonlySet<string> | undefined,
): void {
	for (const route of routes) {
		if (!feedback.has(route.edge.id) || isSelfLoop(route) || unpaired?.has(route.edge.id)) continue;
		const forward = routes.find(
			(other) =>
				other.pair === undefined &&
				!unpaired?.has(other.edge.id) &&
				!feedback.has(other.edge.id) &&
				other.source === route.target &&
				other.target === route.source &&
				other.targetEdge === OPPOSITE_EDGE[other.sourceEdge],
		);
		if (!forward) continue;
		const [from, to] = [center(route.source), center(route.target)];
		const ends = new Set([route.source.nodeId, route.target.nodeId]);
		const owners = new Set(
			[...ends].flatMap((id) => (groups ? groupChain(groups, groups.groupOf.get(id) ?? id) : [id])),
		);
		const between = [
			...nodes.filter((node) => !ends.has(node.nodeId)),
			...(groups?.frames ?? [])
				.filter((frame) => !owners.has(frame.id))
				.map((frame) => obstacleBox(frame.elementId, frame.box)),
		];
		if (between.some((node) => directSegmentCrossesNode(from, to, node))) continue;
		route.sourceEdge = forward.targetEdge;
		route.targetEdge = forward.sourceEdge;
		forward.pair = -1;
		route.pair = 1;
	}
}

export function branchLabelPosition(route: RoutedEdge, start: ScenePoint): ScenePoint {
	const size = branchLabelMetrics(route.edge, branches(route.source.kind));
	const stub = pointAwayFromEdge(
		start,
		route.sourceEdge,
		sourceStubLength(route, start, ROUTE_STUB_LENGTH),
	);
	const horizontal = route.sourceEdge === "left" || route.sourceEdge === "right";
	if (isSelfLoop(route)) {
		// Outside the loop, beside its outer run: from the stub's tip to the stub
		// of the side it returns into.
		const entry = pointAwayFromEdge(
			pointOnEdge(route.target, route.targetEdge),
			route.targetEdge,
			ROUTE_STUB_LENGTH,
		);
		const outward = EDGE_NORMAL[route.sourceEdge];
		return horizontal
			? { x: stub.x + outward.x * (size.width / 2 + 8), y: (stub.y + entry.y) / 2 }
			: { x: (stub.x + entry.x) / 2, y: stub.y + outward.y * (size.height / 2 + 5) };
	}
	// A label sits above a horizontal stub and right of a vertical one, unless its
	// line is one of a pair, which keeps its label on its own side. It starts past
	// the end run, clear of any end marker.
	const side = labelSideOf(route);
	const from = pointAwayFromEdge(start, route.sourceEdge, endRunOf(route, "source"));
	return {
		x: (from.x + stub.x) / 2 + (horizontal ? 0 : side * (size.width / 2 + 8)),
		y: (from.y + stub.y) / 2 + (horizontal ? side * (size.height / 2 + 5) : 0),
	};
}

export function branchLabelObstacles(
	routes: readonly RoutedEdge[],
	offsets: ReadonlyMap<string, number>,
): NodeSceneElement[] {
	return routes
		.filter((route) => route.edge.label)
		.map((route) => {
			const start = pointOnEdge(
				route.source,
				route.sourceEdge,
				offsets.get(connectionKey({ edgeId: route.edge.id, endpoint: "source" })) ?? 0,
			);
			const position = branchLabelPosition(route, start);
			const metrics = branchLabelMetrics(route.edge, branches(route.source.kind));
			const width = metrics.width + 12;
			return {
				...route.source,
				id: `branch-label:${route.edge.id}`,
				nodeId: `branch-label:${route.edge.id}`,
				x: position.x - width / 2,
				y: position.y - metrics.height / 2 - 4,
				width,
				height: metrics.height + 8,
				shape: "rectangle",
			};
		});
}
