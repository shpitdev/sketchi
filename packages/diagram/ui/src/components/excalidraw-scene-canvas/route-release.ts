import type {
	ExcalidrawArrowElement,
	ExcalidrawElbowArrowElement,
	ExcalidrawElement,
	FixedPointBinding,
	OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { elbowFixedPointAt, routeEntersShape } from "@sketchi/diagram-excalidraw";

type Point = readonly [number, number];
type Arrow = OrderedExcalidrawElement & ExcalidrawArrowElement;
type ReleasedArrow = OrderedExcalidrawElement & ExcalidrawElbowArrowElement;
type Binding = ExcalidrawArrowElement["startBinding"];

/** Excalidraw's mutateElement, from the module the editor runs. */
export type MutateElement = typeof import("@excalidraw/excalidraw").mutateElement;

/**
 * How much deeper a rotated route must run through its shape to fold. Excalidraw
 * turns a rotated arrow about the middle of its drawn stroke, which the sketch's
 * wobble moves from the middle of its points by up to about a pixel (1.1px over
 * every maintained scenario's polylines). Turned about the points' middle, a
 * route reads up to twice that off.
 */
const TURNED_SLACK = 3;

const isArrow = (element: OrderedExcalidrawElement): element is Arrow =>
	element.type === "arrow" && !element.isDeleted;

/**
 * A bound route Excalidraw keeps as drawn when its shapes move: a sharp
 * polyline, which it re-aims only at the moved end, or an elbow arrow with
 * pinned inner runs, which it keeps and reconnects square.
 */
function keepsItsRoute(arrow: Arrow): boolean {
	if (!arrow.startBinding && !arrow.endBinding) return false;
	return arrow.elbowed
		? ((arrow as ExcalidrawElbowArrowElement).fixedSegments?.length ?? 0) > 0
		: arrow.points.length > 2 && arrow.roundness === null;
}

/**
 * The route's points in the scene. Excalidraw keeps a rotated arrow's points in
 * its own frame and turns them about their middle.
 */
function scenePoints(arrow: ExcalidrawArrowElement): Point[] {
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
function portsOf(
	arrow: ExcalidrawArrowElement,
	shapes: ReadonlyMap<string, ExcalidrawElement>,
): Ports {
	const points = scenePoints(arrow);
	const port = (binding: Binding, point: Point): Port | null => {
		if (!binding) return null;
		const { elementId } = binding;
		const fixedPoint = (binding as FixedPointBinding).fixedPoint;
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
	return (
		elements: readonly OrderedExcalidrawElement[],
		selectedElementIds: Readonly<Record<string, true>> = {},
	) => {
		const shapes = new Map(
			elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]),
		);
		const routes = elements.filter(isArrow).filter(keepsItsRoute);
		drawn ??= new Map(routes.map((route) => [route.id, portsOf(route, shapes)]));
		const released = new Map<string, ReleasedArrow>();
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
			const binding = (side: 0 | 1): FixedPointBinding | null => {
				const bound = side === 0 ? arrow.startBinding : arrow.endBinding;
				if (!bound) return null;
				// A shape with no size has no port; Excalidraw snaps its middle to the outline.
				const [x, y] = [ports[side], current[side]].find(
					(port) => port?.elementId === bound.elementId,
				)?.fixedPoint ?? [0.5001, 0.5001];
				return { ...bound, fixedPoint: [x, y] as FixedPointBinding["fixedPoint"] };
			};
			const [x, y] = points[0]!;
			const local = points.map(([px, py]) => [px - x, py - y] as const);
			released.set(arrow.id, {
				...arrow,
				angle: 0,
				elbowed: true,
				endBinding: binding(1),
				endIsSpecial: null,
				fixedSegments: [],
				height: Math.max(...local.map(([, py]) => py)) - Math.min(...local.map(([, py]) => py)),
				points: local as unknown as ReleasedArrow["points"],
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
 * its ends move.
 */
export function routeReleased(mutateElement: MutateElement, arrow: ExcalidrawArrowElement) {
	mutateElement(arrow, { points: [arrow.points[0]!, arrow.points.at(-1)!] });
}

/**
 * Releases folded routes from an Excalidraw editor's onChange, live during a
 * drag: the step runs on every change and costs well under a millisecond, and
 * Excalidraw routes a released arrow afresh on each later pointer move. Make
 * one per mounted editor, with the mutateElement of the module it runs. Returns
 * the elements as they now stand in the scene.
 */
export function createFoldedRouteRelease(mutateElement: MutateElement) {
	const release = createRouteRelease();
	return (
		api: Pick<ExcalidrawImperativeAPI, "getSceneElementsIncludingDeleted" | "updateScene">,
		elements: readonly OrderedExcalidrawElement[],
		selectedElementIds?: Readonly<Record<string, true>>,
	): readonly OrderedExcalidrawElement[] => {
		const { elements: next, released } = release(elements, selectedElementIds);
		if (released.length === 0) return elements;
		api.updateScene({ elements: next });
		const live = new Map(
			api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]),
		);
		for (const { id } of released) {
			const arrow = live.get(id);
			if (arrow && isArrow(arrow)) routeReleased(mutateElement, arrow);
		}
		return next;
	};
}
