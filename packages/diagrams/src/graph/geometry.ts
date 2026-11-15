import { type ConnectionEdge, type RoutedEdge } from "./layout-types.js";
import { type IntermediateDiagram } from "./intermediate.js";
import {
	type CanvasShapeElement as NodeSceneElement,
	type CanvasPoint as ScenePoint,
	isCanvasComposedShape,
	canvasComposedOutlinePoint,
	type CanvasConnectorElement as ArrowSceneElement,
	AXIS_ALIGNED_EPSILON,
} from "@sketchi/drawing";
import { branches } from "./measure.js";

export const PORT_SPACING = 18;

export const PORT_PADDING = 16;

export const ROUTE_STUB_LENGTH = 36;

/** Room past two facing stubs, when spread, for a lane each a corridor's width apart. */
export const FACING_LANES = 2 * ROUTE_STUB_LENGTH;

export const FORWARD_SIDE: Readonly<
	Record<IntermediateDiagram["layout"]["direction"], ConnectionEdge>
> = {
	TB: "bottom",
	BT: "top",
	LR: "right",
	RL: "left",
};

export function center(shape: NodeSceneElement): ScenePoint {
	return {
		x: shape.x + shape.width / 2,
		y: shape.y + shape.height / 2,
	};
}

function horizontalRangesOverlap(source: NodeSceneElement, target: NodeSceneElement): boolean {
	return (
		Math.min(source.x + source.width, target.x + target.width) - Math.max(source.x, target.x) > 0.01
	);
}

export function connectionEdges(
	source: NodeSceneElement,
	target: NodeSceneElement,
	direction: IntermediateDiagram["layout"]["direction"],
): {
	sourceEdge: ConnectionEdge;
	targetEdge: ConnectionEdge;
} {
	const sourceCenter = center(source);
	const targetCenter = center(target);
	const dx = targetCenter.x - sourceCenter.x;
	const dy = targetCenter.y - sourceCenter.y;
	const sourceKind = source.kind?.toLowerCase();

	if (direction === "LR" || direction === "RL") {
		return dx >= 0
			? { sourceEdge: "right", targetEdge: "left" }
			: { sourceEdge: "left", targetEdge: "right" };
	}

	if (dy < 0) {
		if (!horizontalRangesOverlap(source, target) && Math.abs(dx) > Math.abs(dy)) {
			return {
				sourceEdge: dx > 0 ? "right" : "left",
				targetEdge: "bottom",
			};
		}

		return {
			sourceEdge: "top",
			targetEdge: "bottom",
		};
	}

	const longDownwardDecisionBranch = branches(sourceKind) && dy > source.height + VERTICAL_GAP;

	if (branches(sourceKind) && dy > 0 && (dx !== 0 || longDownwardDecisionBranch)) {
		return {
			sourceEdge: dx < 0 ? "left" : "right",
			targetEdge: "top",
		};
	}

	if (dy > 0) {
		return { sourceEdge: "bottom", targetEdge: "top" };
	}

	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0
			? { sourceEdge: "right", targetEdge: "left" }
			: { sourceEdge: "left", targetEdge: "right" };
	}

	return { sourceEdge: "top", targetEdge: "bottom" };
}

/**
 * Whether a side curves, so a lone line meets it at its middle: every side of a
 * diamond or ellipse, a cylinder's lid and foot, a pipe's ends, a document's foot.
 */
export function curvedSide(shape: NodeSceneElement, side: ConnectionEdge): boolean {
	switch (shape.shape) {
		case "rectangle":
			return false;
		case "cylinder":
			return side === "top" || side === "bottom";
		case "pipe":
			return side === "left" || side === "right";
		case "document":
			return side === "bottom";
		default:
			return true;
	}
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function constrainedPortOffset(shape: NodeSceneElement, edge: ConnectionEdge, offset: number) {
	const limit =
		edge === "top" || edge === "bottom"
			? shape.width / 2 - PORT_PADDING
			: shape.height / 2 - PORT_PADDING;

	return limit > 0 ? clamp(offset, -limit, limit) : 0;
}

export function pointOnEdge(
	shape: NodeSceneElement,
	edge: ConnectionEdge,
	portOffset = 0,
): ScenePoint {
	// A composed shape's sides curve or taper in from its box: lines end on them.
	if (isCanvasComposedShape(shape.shape))
		return canvasComposedOutlinePoint(
			{ ...shape, shape: shape.shape },
			edge,
			pointOnEdge({ ...shape, shape: "rectangle" }, edge, portOffset),
		);
	const offset = constrainedPortOffset(shape, edge, portOffset);
	const centerPoint = center(shape);
	const halfWidth = shape.width / 2;
	const halfHeight = shape.height / 2;

	if (shape.shape === "diamond" && halfWidth > 0 && halfHeight > 0) {
		if (edge === "top" || edge === "bottom") {
			const x = centerPoint.x + offset;
			const boundaryOffset = halfHeight * (1 - Math.abs(offset) / halfWidth);
			return {
				x,
				y: edge === "top" ? centerPoint.y - boundaryOffset : centerPoint.y + boundaryOffset,
			};
		}

		const y = centerPoint.y + offset;
		const boundaryOffset = halfWidth * (1 - Math.abs(offset) / halfHeight);
		return {
			x: edge === "left" ? centerPoint.x - boundaryOffset : centerPoint.x + boundaryOffset,
			y,
		};
	}

	if ((shape.shape === "ellipse" || shape.shape === "circle") && halfWidth > 0 && halfHeight > 0) {
		if (edge === "top" || edge === "bottom") {
			const x = centerPoint.x + offset;
			const boundaryOffset = halfHeight * Math.sqrt(Math.max(0, 1 - (offset / halfWidth) ** 2));
			return {
				x,
				y: edge === "top" ? centerPoint.y - boundaryOffset : centerPoint.y + boundaryOffset,
			};
		}

		const y = centerPoint.y + offset;
		const boundaryOffset = halfWidth * Math.sqrt(Math.max(0, 1 - (offset / halfHeight) ** 2));
		return {
			x: edge === "left" ? centerPoint.x - boundaryOffset : centerPoint.x + boundaryOffset,
			y,
		};
	}

	switch (edge) {
		case "top":
			return { x: shape.x + shape.width / 2 + offset, y: shape.y };
		case "right":
			return {
				x: shape.x + shape.width,
				y: shape.y + shape.height / 2 + offset,
			};
		case "bottom":
			return {
				x: shape.x + shape.width / 2 + offset,
				y: shape.y + shape.height,
			};
		case "left":
			return { x: shape.x, y: shape.y + shape.height / 2 + offset };
	}
}

export function connectionKey(input: { endpoint: "source" | "target"; edgeId: string }): string {
	return `${input.edgeId}:${input.endpoint}`;
}

export function portKey(nodeId: string, edge: ConnectionEdge): string {
	return `${nodeId}:${edge}`;
}

export function portOffset(index: number, count: number): number {
	return (index - (count - 1) / 2) * PORT_SPACING;
}

export function isSelfLoop(route: RoutedEdge): boolean {
	return route.edge.source === route.edge.target;
}

/** A self-loop's ports sit toward the corner between its two sides. */
export function loopCorner(route: RoutedEdge, endpoint: "source" | "target"): number {
	const [side, other] =
		endpoint === "source"
			? [route.sourceEdge, route.targetEdge]
			: [route.targetEdge, route.sourceEdge];
	return EDGE_NORMAL[other][slotAxis(side)];
}

/**
 * Where an endpoint's far end lies along its side, which orders the ports on
 * that side: past the corner a self-loop turns around.
 */
export function farCoordinate(route: RoutedEdge, endpoint: "source" | "target"): number {
	const side = endpoint === "source" ? route.sourceEdge : route.targetEdge;
	if (isSelfLoop(route)) return loopCorner(route, endpoint) * 1e9;
	return center(endpoint === "source" ? route.target : route.source)[slotAxis(side)];
}

/** Lines of a pair side by side in pair order; every other line ranks 0. */
export function pairRank(routes: readonly RoutedEdge[], edgeId: string): number {
	return routes.find((route) => route.edge.id === edgeId)?.pair ?? 0;
}

/** Arrowheads are about 17 units wide; this keeps a visible gap beside an arrival. */
export const ARRIVAL_SPACING = 36;

/** In lanes, where handoffs and loops often meet one step, arrivals on a side sit farther apart. */
export const LANE_ARRIVAL_SPACING = 1.5 * ARRIVAL_SPACING;

export const OPPOSITE_EDGE: Readonly<Record<ConnectionEdge, ConnectionEdge>> = {
	top: "bottom",
	right: "left",
	bottom: "top",
	left: "right",
};

export const EDGE_NORMAL: Readonly<Record<ConnectionEdge, ScenePoint>> = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

export function slotAxis(side: ConnectionEdge): "x" | "y" {
	return side === "top" || side === "bottom" ? "x" : "y";
}

export function routeEndpoints(
	route: RoutedEdge,
	portOffsets: ReadonlyMap<string, number>,
): { start: ScenePoint; end: ScenePoint } {
	const { edge, source, sourceEdge, target, targetEdge } = route;
	return {
		start: pointOnEdge(
			source,
			sourceEdge,
			portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "source" })) ?? 0,
		),
		end: pointOnEdge(
			target,
			targetEdge,
			portOffsets.get(connectionKey({ edgeId: edge.id, endpoint: "target" })) ?? 0,
		),
	};
}

/** Arrival stubs reserved for lines not yet routed; their heads are drawn full size. */
export const reservedArrivals = new WeakSet<ArrowSceneElement>();

/** Departure stubs reserved for lines not yet routed. */
export const reservedDepartures = new WeakSet<ArrowSceneElement>();

/** The free end of a reserved stub, which its line runs on from: no bend until routed. */
export function openEnd(arrow: ArrowSceneElement): "start" | "end" | undefined {
	return reservedArrivals.has(arrow) ? "start" : reservedDepartures.has(arrow) ? "end" : undefined;
}

export function pointAwayFromEdge(
	point: ScenePoint,
	edge: ConnectionEdge,
	distance: number,
): ScenePoint {
	switch (edge) {
		case "top":
			return { x: point.x, y: point.y - distance };
		case "right":
			return { x: point.x + distance, y: point.y };
		case "bottom":
			return { x: point.x, y: point.y + distance };
		case "left":
			return { x: point.x - distance, y: point.y };
	}
}

/** The straight run a line keeps at one end: the end's own when pinned with one. */
export function endRunOf(route: RoutedEdge, endpoint: "source" | "target"): number {
	return route.runs?.[endpoint] ?? route.endRun ?? 0;
}

/**
 * The sideways steps of a line's corners, by the index of the corner each
 * starts at, that read as port jogs: between two runs heading the same way,
 * narrower than a deliberate bend, with a turn within a jog's reach of either
 * end of the line, counted once per end.
 */
export function portJogSteps(
	corners: readonly ScenePoint[],
	reach: number,
	wide: number,
): number[] {
	const [start, end] = [corners[0]!, corners.at(-1)!];
	const steps: number[] = [];
	for (let index = 1; index < corners.length - 2; index += 1) {
		const [before, from, to, after] = corners.slice(index - 1, index + 3) as [
			ScenePoint,
			ScenePoint,
			ScenePoint,
			ScenePoint,
		];
		const axis = Math.abs(before.y - from.y) <= AXIS_ALIGNED_EPSILON ? "x" : "y";
		const heading = Math.sign(from[axis] - before[axis]);
		if (
			heading !== 0 &&
			Math.sign(after[axis] - to[axis]) === heading &&
			Math.hypot(to.x - from.x, to.y - from.y) < wide
		) {
			if (Math.hypot(end.x - to.x, end.y - to.y) <= reach) steps.push(index);
			if (Math.hypot(from.x - start.x, from.y - start.y) <= reach) steps.push(index);
		}
	}
	return steps;
}

export const HORIZONTAL_GAP = 112;

export const VERTICAL_GAP = 96;
