import type { Point } from "./excalidraw-binding.js";
import { elbowFixedPointAt, routeEntersShape } from "./route-folds.js";

/** The fields of an Excalidraw element the release step reads. */
export interface ReleasableElement {
	readonly angle: number;
	readonly height: number;
	readonly id: string;
	readonly isDeleted: boolean;
	readonly type: string;
	readonly version: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}

/** An arrow end's binding, as Excalidraw keeps it. */
interface ReleasableBinding {
	readonly elementId: string;
	readonly fixedPoint?: Point | null;
}

/** The fields of an Excalidraw arrow the release step reads and rewrites. */
interface ReleasableArrow extends ReleasableElement {
	readonly elbowed?: boolean;
	readonly endBinding: ReleasableBinding | null;
	readonly fixedSegments?: readonly unknown[] | null;
	readonly points: readonly Point[];
	readonly roundness: unknown;
	readonly startBinding: ReleasableBinding | null;
	readonly type: "arrow";
}

/**
 * How much deeper a rotated route must run through its shape to fold. Excalidraw
 * turns a rotated arrow about the middle of its drawn stroke, which the sketch's
 * wobble moves from the middle of its points by up to about a pixel (1.1px over
 * every maintained scenario's polylines). Turned about the points' middle, a
 * route reads up to twice that off.
 */
const TURNED_SLACK = 3;

const isArrow = <Element extends ReleasableElement>(
	element: Element,
): element is Element & ReleasableArrow => element.type === "arrow" && !element.isDeleted;

/**
 * A bound route Excalidraw keeps as drawn when its shapes move: a sharp
 * polyline, which it re-aims only at the moved end, or an elbow arrow with
 * pinned inner runs, which it keeps and reconnects square.
 */
function keepsItsRoute(arrow: ReleasableArrow): boolean {
	if (!arrow.startBinding && !arrow.endBinding) return false;
	return arrow.elbowed
		? (arrow.fixedSegments?.length ?? 0) > 0
		: arrow.points.length > 2 && arrow.roundness === null;
}

/**
 * The route's points in the scene. Excalidraw keeps a rotated arrow's points in
 * its own frame and turns them about their middle.
 */
function scenePoints(arrow: ReleasableArrow): Point[] {
	const points = arrow.points.map(([x, y]): Point => [arrow.x + x, arrow.y + y]);
	if (!arrow.angle) return points;
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const [cx, cy] = [
		(Math.min(...xs) + Math.max(...xs)) / 2,
		(Math.min(...ys) + Math.max(...ys)) / 2,
	];
	const [cos, sin] = [Math.cos(arrow.angle), Math.sin(arrow.angle)];
	return points.map(([x, y]): Point => [
		cx + (x - cx) * cos - (y - cy) * sin,
		cy + (x - cx) * sin + (y - cy) * cos,
	]);
}

/** Where a bound end meets its shape, as the fixed point an elbow arrow binds with. */
interface Port {
	readonly elementId: string;
	readonly fixedPoint: Point;
}
type Ports = readonly [Port | null, Port | null];

/** Each bound end's port: an elbow arrow's own fixed point, else the end's place on its shape. */
function portsOf(arrow: ReleasableArrow, shapes: ReadonlyMap<string, ReleasableElement>): Ports {
	const points = scenePoints(arrow);
	const port = (binding: ReleasableBinding | null, point: Point): Port | null => {
		if (!binding) return null;
		const { elementId, fixedPoint } = binding;
		if (arrow.elbowed && fixedPoint)
			return { elementId, fixedPoint: [fixedPoint[0], fixedPoint[1]] };
		const shape = shapes.get(elementId);
		return shape && shape.width > 0 && shape.height > 0
			? { elementId, fixedPoint: elbowFixedPointAt(shape, point) }
			: null;
	};
	return [port(arrow.startBinding, points[0]!), port(arrow.endBinding, points.at(-1)!)];
}

/**
 * Releases a route a drag has folded through its own shape to Excalidraw's
 * elbow routing, so it goes around the shape.
 *
 * Excalidraw keeps a sharp polyline's bends and an elbow arrow's pinned runs
 * where they are drawn, and moves only the run into a moved shape. Carried over
 * one of its own bends or runs, the shape swallows the route: a polyline's end
 * then lands inside the shape, and a pinned run passes behind it. Such a route
 * becomes an unrotated elbow arrow with nothing pinned, bound at the ports
 * where it is drawn to meet its shapes, which Excalidraw routes around them now
 * and on every later move.
 *
 * A polyline's end slides along its shape's side as the shape moves, so each
 * port is kept from where the scene opened, or from where a person last edited
 * the route: a selected route that changes is being edited, and its ports are
 * read again. A port holds only while its end stays bound to the same shape; an
 * end bound elsewhere meets its new shape where it is.
 *
 * Only routes the scene opened with are released, so arrows a person draws keep
 * the kind they chose, and never one selected for editing. An elbow arrow's
 * pinned runs do not turn with its shapes, though: rotated with them, it loops
 * wide of them or through them, so one whose shape turns is released even while
 * it is selected. Each call takes the editor's elements and returns them with
 * any released routes replaced, and those routes, for `routeReleased` once they
 * are in the scene.
 */
export function createRouteRelease() {
	let drawn: Map<string, Ports> | undefined;
	let versions = new Map<string, number>();
	let angles = new Map<string, number>();
	return <Element extends ReleasableElement>(
		elements: readonly Element[],
		selectedElementIds: Readonly<Record<string, true>> = {},
	): { readonly elements: readonly Element[]; readonly released: Element[] } => {
		const shapes = new Map<string, ReleasableElement>(
			elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]),
		);
		const routes = elements.filter(isArrow).filter(keepsItsRoute);
		drawn ??= new Map(routes.map((route) => [route.id, portsOf(route, shapes)]));
		const released = new Map<string, Element>();
		for (const arrow of routes) {
			const ports = drawn.get(arrow.id);
			const version = versions.get(arrow.id);
			if (!ports || version === undefined || version === arrow.version) continue;
			const turned =
				arrow.elbowed &&
				[arrow.startBinding, arrow.endBinding].some((bound) => {
					if (!bound) return false;
					const angle = angles.get(bound.elementId);
					return angle !== undefined && angle !== shapes.get(bound.elementId)?.angle;
				});
			if (!turned && selectedElementIds[arrow.id]) {
				drawn.set(arrow.id, portsOf(arrow, shapes));
				continue;
			}
			const points = scenePoints(arrow);
			const slack = arrow.angle ? TURNED_SLACK : 0;
			const folds =
				turned ||
				(["start", "end"] as const).some((end) => {
					const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
					const shape = binding && shapes.get(binding.elementId);
					return (
						shape !== undefined && shape !== null && routeEntersShape(points, shape, end, slack)
					);
				});
			if (!folds) continue;
			const current = portsOf(arrow, shapes);
			const binding = (side: 0 | 1): ReleasableBinding | null => {
				const bound = side === 0 ? arrow.startBinding : arrow.endBinding;
				if (!bound) return null;
				// A shape with no size has no port; Excalidraw snaps its middle to the outline.
				const [x, y] = [ports[side], current[side]].find(
					(port) => port?.elementId === bound.elementId,
				)?.fixedPoint ?? [0.5001, 0.5001];
				return { ...bound, fixedPoint: [x, y] };
			};
			const [x, y] = points[0]!;
			const local = points.map(([px, py]): Point => [px - x, py - y]);
			released.set(arrow.id, {
				...arrow,
				angle: 0,
				elbowed: true,
				endBinding: binding(1),
				endIsSpecial: null,
				fixedSegments: [],
				height: Math.max(...local.map(([, py]) => py)) - Math.min(...local.map(([, py]) => py)),
				points: local,
				roundness: null,
				startBinding: binding(0),
				startIsSpecial: null,
				version: arrow.version + 1,
				width: Math.max(...local.map(([px]) => px)) - Math.min(...local.map(([px]) => px)),
				x,
				y,
			});
		}
		const next = released.size
			? elements.map((element) => released.get(element.id) ?? element)
			: elements;
		versions = new Map(
			next
				.filter(isArrow)
				.filter(keepsItsRoute)
				.map((arrow) => [arrow.id, arrow.version]),
		);
		angles = new Map([...shapes].map(([id, shape]) => [id, shape.angle]));
		return { elements: next, released: [...released.values()] };
	};
}

/**
 * Has Excalidraw route a released arrow, once it is in the editor's scene: an
 * elbow arrow with nothing pinned is routed afresh from its bindings whenever
 * its ends move. Takes the mutateElement of the Excalidraw module the editor runs.
 */
export function routeReleased<Arrow extends { readonly points: readonly unknown[] }>(
	mutateElement: (arrow: Arrow, updates: { points: Arrow["points"] }) => unknown,
	arrow: Arrow,
): void {
	mutateElement(arrow, { points: [arrow.points[0], arrow.points.at(-1)] as Arrow["points"] });
}
