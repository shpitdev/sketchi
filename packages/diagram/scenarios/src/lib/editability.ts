import {
	DRAG_OFFSETS,
	distance,
	type EditorElement,
	type EditorScene,
	type EditSession,
	endDetached,
	endInside,
	isBoundArrow,
	isCurved,
	type Point,
} from "./edit-session.js";

/**
 * How a delivered Excalidraw scene holds up when a person drags its shapes in
 * the editor, as counts. A scene with no bound route reports only
 * `editBoundRoutes: 0`; the rest have nothing to count.
 */
export interface EditabilityMetrics {
	/** Arrows bound to a shape at one end or both. */
	readonly editBoundRoutes: number;
	/** Shape drags run: one per shape holding a bound route, up to the drag cap. */
	readonly editDrags?: number;
	/** Routes the drags carried, summed over drags: each route bound to a shape that moved. */
	readonly editRouteMoves?: number;
	/** Routes the first touch moves off their drawing, before any shape moves. */
	readonly editFirstTouchMoves?: number;
	/** Route moves that leave an end inside the outline of the shape it is bound to. */
	readonly editEndsInside?: number;
	/** Route moves that leave an end off its shape's edge: farther out than its binding keeps it, or unbound. */
	readonly editEndsOffEdge?: number;
	/** Route moves that leave a straight, polyline or elbow route running through a shape it binds to. */
	readonly editRoutesThroughShape?: number;
	/** Routes a drag moves although neither of their shapes moved, summed over drags. */
	readonly editStrayRouteMoves?: number;
	/** Route moves the editor released to Excalidraw's elbow routing because the drag folded them through a shape. */
	readonly editReleasedRoutes?: number;
	/** Drags Excalidraw's own elbow router threw on. */
	readonly editDragErrors?: number;
}

/**
 * The most shapes dragged per scene. Each drag opens the scene afresh and moves
 * one shape 36-76px (one in seven 228px), one pointer move every 2px, so the
 * cost grows with the shapes dragged times the routes each move re-places. A
 * capped scene drags shapes spread evenly through it, each with the offset it
 * takes uncapped, so its drags are a subset of the full schedule's.
 */
export const EDIT_DRAG_CAP = 16;

const sameRoute = (a: readonly Point[], b: readonly Point[]) =>
	a.length === b.length &&
	a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);

/** The schedule's shapes: every one, or `cap` spread evenly, each with its index in the full schedule. */
function schedule<T>(shapes: readonly T[], cap: number): (readonly [number, T])[] {
	if (shapes.length <= cap) return shapes.map((shape, index) => [index, shape] as const);
	return Array.from({ length: cap }, (_, step) => {
		const index = Math.floor((step * shapes.length) / cap);
		return [index, shapes[index]!] as const;
	});
}

/** Excalidraw's elbow router finds no route for a few drags and throws, whatever the bindings. */
const isElbowRouterError = (error: unknown) =>
	String(error instanceof Error ? error.stack : error).includes("elbowArrow");

/**
 * Measures a scene's editability with the session's editor: the first touch,
 * then each bound shape dragged by its schedule's offset from a freshly opened
 * scene, with the canvas's step after every pointer move. The same input
 * always gives the same counts.
 */
export function measureEditability(
	session: EditSession,
	elements: readonly unknown[],
	{ cap = EDIT_DRAG_CAP }: { readonly cap?: number } = {},
): EditabilityMetrics {
	const scene = session.open(elements);
	try {
		return measureOpened(session, scene, elements, cap);
	} finally {
		session.close(scene);
	}
}

/** The metrics of a scene `measureEditability` opened, which it closes after. */
function measureOpened(
	session: EditSession,
	scene: EditorScene,
	elements: readonly unknown[],
	cap: number,
): EditabilityMetrics {
	const routes = scene.getNonDeletedElements().filter(isBoundArrow);
	if (routes.length === 0) return { editBoundRoutes: 0 };

	const drawn = new Map(
		(elements as EditorElement[])
			.filter(isBoundArrow)
			.map((element) => [element.id, session.absolute(element)] as const),
	);
	const touched = new Set(session.touch(scene));
	const loaded = scene.getNonDeletedElementsMap();
	let firstTouchMoves = 0;
	for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
		const route = drawn.get(arrow.id);
		const after = session.absolute(arrow);
		const slack = session.routeKeptWithin(arrow, loaded);
		const moved =
			touched.has(arrow.id) ||
			!route ||
			after.length !== route.length ||
			distance(after[0]!, route[0]!) > session.keptWithin(arrow, "startBinding", loaded) ||
			distance(after.at(-1)!, route.at(-1)!) > session.keptWithin(arrow, "endBinding", loaded) ||
			route.some((point, index) => distance(after[index]!, point) > slack);
		if (moved) firstTouchMoves += 1;
	}

	const counts: DragCounts = {
		editDragErrors: 0,
		editDrags: 0,
		editEndsInside: 0,
		editEndsOffEdge: 0,
		editReleasedRoutes: 0,
		editRouteMoves: 0,
		editRoutesThroughShape: 0,
		editStrayRouteMoves: 0,
	};
	for (const [index, target] of schedule(session.boundShapes(scene), cap)) {
		counts.editDrags += 1;
		const dragged = session.open(elements);
		try {
			measureDrag(session, dragged, target, DRAG_OFFSETS[index % DRAG_OFFSETS.length]!, counts);
		} finally {
			session.close(dragged);
		}
	}
	return { editBoundRoutes: routes.length, editFirstTouchMoves: firstTouchMoves, ...counts };
}

/** The counts a drag adds to. */
type DragCounts = {
	-readonly [
		Key in Exclude<keyof EditabilityMetrics, "editBoundRoutes" | "editFirstTouchMoves">
	]-?: number;
};

/** Drags `target` in a freshly opened scene and adds what the drag did to the counts. */
function measureDrag(
	session: EditSession,
	dragged: EditorScene,
	target: EditorElement,
	offset: Point,
	counts: DragCounts,
) {
	const before = session.routesAndShapes(dragged);
	let released: string[];
	try {
		released = session.drag(dragged, dragged.getNonDeletedElementsMap().get(target.id)!, offset);
	} catch (error) {
		if (!isElbowRouterError(error)) throw error;
		counts.editDragErrors += 1;
		return;
	}
	const moved = new Set<string>();
	for (const [id, after] of session.routesAndShapes(dragged)) {
		const drawnRoute = before.get(id);
		if (!drawnRoute) continue;
		if (after.shapes !== drawnRoute.shapes) moved.add(id);
		else if (!sameRoute(after.route, drawnRoute.route)) counts.editStrayRouteMoves += 1;
	}
	counts.editRouteMoves += moved.size;
	const ends = session.readEnds(dragged, { which: (arrow) => moved.has(arrow.id) });
	counts.editEndsInside += new Set(ends.filter(endInside).map((end) => end.arrow.id)).size;
	counts.editEndsOffEdge += new Set(ends.filter(endDetached).map((end) => end.arrow.id)).size;
	counts.editRoutesThroughShape += new Set(
		session
			.routesThroughShapes(dragged, (arrow) => moved.has(arrow.id) && !isCurved(arrow))
			.map(([id]) => id),
	).size;
	counts.editReleasedRoutes += new Set(released).size;
}
