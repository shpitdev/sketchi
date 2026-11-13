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

/** Excalidraw's mutateElement, from the module the editor runs. */
export type MutateElement = typeof import("@excalidraw/excalidraw").mutateElement;

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

const absolute = (arrow: ExcalidrawArrowElement): Point[] =>
	arrow.points.map(([x, y]): Point => [arrow.x + x, arrow.y + y]);

type Ports = readonly [Point | null, Point | null];

/**
 * Where each bound end meets its shape, as the fixed point an elbow arrow binds
 * with: an elbow arrow's own, else the end's place on its shape.
 */
function portsOf(
	arrow: ExcalidrawArrowElement,
	shapes: ReadonlyMap<string, ExcalidrawElement>,
): Ports {
	const points = absolute(arrow);
	const port = (binding: ExcalidrawArrowElement["startBinding"], point: Point) => {
		const fixedPoint = (binding as FixedPointBinding | null)?.fixedPoint;
		if (arrow.elbowed && fixedPoint) return [fixedPoint[0], fixedPoint[1]] as const;
		const shape = binding ? shapes.get(binding.elementId) : undefined;
		return shape && shape.width > 0 && shape.height > 0 ? elbowFixedPointAt(shape, point) : null;
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
 * becomes an elbow arrow with nothing pinned, bound at the ports where it is
 * drawn to meet its shapes, which Excalidraw routes around them now and on
 * every later move. A polyline's end slides along its shape's side as the
 * shape moves, so the port is where the scene opened with it.
 *
 * Only routes the scene opened with are released, so arrows a person draws keep
 * the kind they chose, and never a selected one, which a person is editing.
 * Each call takes the editor's elements and returns them with any released
 * routes replaced, and those routes, for `routeReleased` once they are in the
 * scene.
 */
export function createRouteRelease() {
	let opened: ReadonlyMap<string, Ports> | undefined;
	let versions = new Map<string, number>();
	return (
		elements: readonly OrderedExcalidrawElement[],
		selectedElementIds: Readonly<Record<string, true>> = {},
	) => {
		const shapes = new Map(
			elements.filter((element) => !element.isDeleted).map((element) => [element.id, element]),
		);
		const routes = elements.filter(isArrow).filter(keepsItsRoute);
		opened ??= new Map(routes.map((route) => [route.id, portsOf(route, shapes)]));
		const released = new Map<string, ReleasedArrow>();
		for (const arrow of routes) {
			const drawn = opened.get(arrow.id);
			const version = versions.get(arrow.id);
			if (!drawn || version === undefined || version === arrow.version) continue;
			if (selectedElementIds[arrow.id]) continue;
			const points = absolute(arrow);
			const folds = (["start", "end"] as const).some((end) => {
				const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
				const shape = binding && shapes.get(binding.elementId);
				return shape !== undefined && shape !== null && routeEntersShape(points, shape, end);
			});
			if (!folds) continue;
			const ports = portsOf(arrow, shapes);
			// A shape with no size has no port; Excalidraw snaps its middle to the outline.
			const binding = (side: 0 | 1): FixedPointBinding | null => {
				const current = side === 0 ? arrow.startBinding : arrow.endBinding;
				const [x, y] = drawn[side] ?? ports[side] ?? [0.5001, 0.5001];
				return current && { ...current, fixedPoint: [x, y] as FixedPointBinding["fixedPoint"] };
			};
			released.set(arrow.id, {
				...arrow,
				elbowed: true,
				endBinding: binding(1),
				endIsSpecial: null,
				fixedSegments: [],
				roundness: null,
				startBinding: binding(0),
				startIsSpecial: null,
				version: arrow.version + 1,
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
