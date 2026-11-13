import { canvasShapeOutline, isCanvasComposedShape } from "@sketchi/diagram-core";
import { createRouteRelease, routeEntersShape, routeReleased } from "@sketchi/diagram-excalidraw";

/**
 * A person's edits of an exported diagram, run through Excalidraw 0.18.1's own
 * code: the restore the editor loads a scene through, the drag and resize a
 * pointer gesture runs, and the update that re-places every arrow bound to a
 * moved shape. Every change runs the canvas's own step after it
 * (`createRouteRelease`), which releases a route a drag folds through its own
 * shape to Excalidraw's elbow routing. The editor tests and the scenario CLI's
 * editability metrics both edit diagrams through this one session.
 */

export type Point = [number, number];

export interface EditorBinding {
	readonly elementId: string;
	readonly fixedPoint?: Point | null;
	readonly focus: number;
	readonly gap: number;
}

/** The fields of an Excalidraw element the session reads. */
export interface EditorElement {
	readonly id: string;
	readonly type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
	points?: Point[];
	startBinding?: EditorBinding | null;
	endBinding?: EditorBinding | null;
	boundElements?: { id: string; type: string }[] | null;
	groupIds: string[];
	frameId?: string | null;
	containerId?: string | null;
	customData?: Record<string, unknown>;
	elbowed?: boolean;
	fixedSegments?: readonly unknown[] | null;
	isDeleted: boolean;
	roundness: { type: number; value?: number } | null;
	version: number;
}

/** Excalidraw's Scene, which holds the elements an edit changes. */
export interface EditorScene {
	replaceAllElements(elements: readonly EditorElement[]): void;
	getElementsIncludingDeleted(): readonly EditorElement[];
	getNonDeletedElements(): readonly EditorElement[];
	getNonDeletedElementsMap(): Map<string, EditorElement>;
	getElementsMapIncludingDeleted(): Map<string, EditorElement>;
}

/** The parts of Excalidraw 0.18.1's editor a person's edits run through. */
export interface ExcalidrawEditor {
	Scene_default: new () => EditorScene;
	dragSelectedElements(
		pointerDownState: { originalElements: Map<string, EditorElement> },
		selected: readonly EditorElement[],
		offset: { x: number; y: number },
		scene: EditorScene,
		snapOffset: { x: number; y: number },
		gridSize: number | null,
	): void;
	isBindableElement(element: EditorElement): boolean;
	LinearElementEditor: {
		getPointsGlobalCoordinates(
			element: EditorElement,
			elementsMap: Map<string, EditorElement>,
		): Point[];
	};
	mutateElement(element: EditorElement, updates: { points: Point[] }): EditorElement;
	restoreElements(
		elements: readonly unknown[],
		local: null,
		options: { refreshDimensions: boolean; repairBindings: boolean },
	): EditorElement[];
	setCustomTextMetricsProvider(provider: {
		getLineWidth(text: string, font: string): number;
	}): void;
	transformElements(
		originalElements: Map<string, EditorElement>,
		handle: string,
		selected: readonly EditorElement[],
		elementsMap: Map<string, EditorElement>,
		scene: EditorScene,
		rotateWithDiscreteAngle: boolean,
		resizeFromCenter: boolean,
		maintainAspectRatio: boolean,
		pointerX: number,
		pointerY: number,
		centerX: number,
		centerY: number,
	): boolean;
	updateBoundElements(element: EditorElement, elementsMap: Map<string, EditorElement>): void;
}

/** How far Excalidraw keeps an elbow arrow end it has to re-place off its outline. */
export const FIXED_BINDING_DISTANCE = 5;
/**
 * How far inside a rounded corner Excalidraw may leave an end: its curve
 * intersection finds one root, sometimes where the line leaves the corner, and
 * then drops the end on the focus point just inside it.
 */
const CORNER_SOLVE_SLACK = 1.5;
/** First-touch ends must match to float precision. */
const KEPT = 1e-9;
/** How far past its gap, or inside its outline, a bound end may read. */
const OUTLINE_SLACK = 0.05;

/**
 * The drag offsets a person's gestures are drawn from: each bound shape takes
 * the one at its index, in turn.
 */
export const DRAG_OFFSETS: readonly Point[] = [
	[48, 0],
	[0, 36],
	[-52, 0],
	[0, -44],
	[64, 40],
	[-70, -30],
	[180, 140],
];

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const isBoundArrow = (element: EditorElement) =>
	element.type === "arrow" &&
	!element.isDeleted &&
	Boolean(element.startBinding || element.endBinding);

/** A route Excalidraw keeps as drawn: a sharp polyline, or an elbow arrow with pinned runs. */
export const keptAsDrawn = (arrow: EditorElement) =>
	arrow.elbowed
		? (arrow.fixedSegments?.length ?? 0) > 0
		: (arrow.points?.length ?? 0) > 2 && arrow.roundness === null;

/** A curved arrow, which bends through its points and which the canvas leaves as it is. */
export const isCurved = (arrow: EditorElement) =>
	!arrow.elbowed && arrow.roundness !== null && (arrow.points?.length ?? 0) > 2;

/** Excalidraw's adaptive and proportional corner radius. */
function cornerRadius(shape: EditorElement): number {
	const size = Math.min(shape.width, shape.height);
	const roundness = shape.roundness;
	if (roundness?.type === 1 || roundness?.type === 2) return size * 0.25;
	if (roundness?.type === 3) {
		const fixed = roundness.value ?? 32;
		return size <= fixed / 0.25 ? size * 0.25 : fixed;
	}
	return 0;
}

/**
 * The outline Excalidraw draws for a shape, as a closed polyline: a box with
 * its quadratic corners, a diamond on Excalidraw's corners (a pixel past the
 * box's middle), an ellipse.
 */
function drawnOutline(shape: EditorElement): Point[] {
	const { x, y, width: w, height: h } = shape;
	if (shape.type === "ellipse") {
		return Array.from({ length: 721 }, (_, step) => {
			const angle = (step / 720) * 2 * Math.PI;
			return [x + w / 2 + (w / 2) * Math.cos(angle), y + h / 2 + (h / 2) * Math.sin(angle)];
		});
	}
	if (shape.type === "diamond") {
		const topX = x + Math.floor(w / 2) + 1;
		const sideY = y + Math.floor(h / 2) + 1;
		return [
			[topX, y],
			[x + w, sideY],
			[topX, y + h],
			[x, sideY],
			[topX, y],
		];
	}
	const r = cornerRadius(shape);
	const corner = (from: Point, at: Point, to: Point): Point[] =>
		Array.from({ length: 33 }, (_, step) => {
			const t = step / 32;
			return [
				(1 - t) ** 2 * from[0] + 2 * (1 - t) * t * at[0] + t ** 2 * to[0],
				(1 - t) ** 2 * from[1] + 2 * (1 - t) * t * at[1] + t ** 2 * to[1],
			];
		});
	return [
		...corner([x, y + r], [x, y], [x + r, y]),
		...corner([x + w - r, y], [x + w, y], [x + w, y + r]),
		...corner([x + w, y + h - r], [x + w, y + h], [x + w - r, y + h]),
		...corner([x + r, y + h], [x, y + h], [x, y + h - r]),
		[x, y + r],
	];
}

/** Distance from a closed polyline, negative inside it. */
function signedDistance(point: Point, outline: readonly Point[]): number {
	let nearest = Infinity;
	let inside = false;
	for (let index = 1; index < outline.length; index += 1) {
		const [from, to] = [outline[index - 1]!, outline[index]!];
		const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
		const t = Math.max(
			0,
			Math.min(
				1,
				((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / (dx * dx + dy * dy || 1),
			),
		);
		nearest = Math.min(
			nearest,
			Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dy),
		);
		// A ray just off the point's height never runs through a vertex.
		const rayY = point[1] + 1e-7;
		if (from[1] > rayY !== to[1] > rayY && point[0] < from[0] + ((rayY - from[1]) * dx) / dy)
			inside = !inside;
	}
	return inside ? -nearest : nearest;
}

function inRoundedCorner(point: Point, shape: EditorElement, pad: number): boolean {
	const radius = shape.type === "rectangle" ? cornerRadius(shape) : 0;
	if (radius === 0) return false;
	const reach = radius + pad;
	const nearX = point[0] < shape.x + reach || point[0] > shape.x + shape.width - reach;
	const nearY = point[1] < shape.y + reach || point[1] > shape.y + shape.height - reach;
	return nearX && nearY;
}

const within = (point: Point, shape: EditorElement, pad: number) =>
	point[0] > shape.x - pad &&
	point[0] < shape.x + shape.width + pad &&
	point[1] > shape.y - pad &&
	point[1] < shape.y + shape.height + pad;

const overlap = (a: EditorElement, b: EditorElement, pad: number) =>
	a.x - pad < b.x + b.width &&
	b.x - pad < a.x + a.width &&
	a.y - pad < b.y + b.height &&
	b.y - pad < a.y + a.height;

/** What a click on a shape selects: its outermost group, else the shape. */
export function selection(scene: EditorScene, shape: EditorElement): EditorElement[] {
	const group = shape.groupIds.at(-1);
	return group
		? scene.getNonDeletedElements().filter((element) => element.groupIds.includes(group))
		: [shape];
}

const originals = (scene: EditorScene) =>
	new Map(scene.getNonDeletedElements().map((element) => [element.id, structuredClone(element)]));

/**
 * Where a bound end sits against the shape it is bound to, after an edit. An
 * end that is not elbowed belongs on Excalidraw's outline grown by its gap,
 * whose corners stay square on a sharp box: up to the gap's diagonal out. An
 * elbow end belongs on the outline or FIXED_BINDING_DISTANCE out, a distance
 * that grows with its shape when Excalidraw scales the fixed point.
 */
export interface EndReading {
	readonly arrow: EditorElement;
	readonly key: "startBinding" | "endBinding";
	readonly shapeId: string;
	/** The bound shape, absent when the binding names no shape in the scene. */
	readonly shape: EditorElement | undefined;
	/** Whether the shape lists the arrow among its bound elements. */
	readonly listed: boolean;
	/**
	 * Whether the end has no outline to meet: its shapes overlap, or a curved
	 * arrow, which Excalidraw aims from its neighbouring point, bends through
	 * one inside its shape.
	 */
	readonly crowded: boolean;
	/** The end's distance from the outline Excalidraw draws, negative inside it. */
	readonly off: number;
	/** How far inside the outline the end may read: Excalidraw's corner solve leaves a little. */
	readonly slack: number;
	/** How far outside the outline its binding keeps the end. */
	readonly reach: number;
	/** The end's distance from a composed shape's drawn stroke (a database, a bucket), when it has one. */
	readonly drawnOff: number | undefined;
}

/** An end inside the outline a person sees. */
export const endInside = (end: EndReading) =>
	!end.crowded &&
	(end.off < -end.slack || (end.drawnOff !== undefined && end.drawnOff <= -OUTLINE_SLACK));

/** An end its shape no longer holds: unlisted, gone, or farther out than its binding reaches. */
export const endDetached = (end: EndReading) =>
	!end.shape || !end.listed || (!end.crowded && end.off > end.reach + OUTLINE_SLACK);

/** Excalidraw's editor, as the canvas runs it, for opening and editing exported scenes. */
export function createEditSession(editor: ExcalidrawEditor) {
	// Text measurement only places labels; any monospace stand-in leaves arrows alone.
	editor.setCustomTextMetricsProvider({
		getLineWidth: (text, font) => text.length * (Number.parseFloat(font) || 16) * 0.55,
	});
	const releases = new WeakMap<EditorScene, ReturnType<typeof createRouteRelease>>();

	/** An arrow's points in the scene, turned with the arrow as Excalidraw draws them. */
	const absolute = (arrow: EditorElement): Point[] =>
		arrow.points?.length
			? editor.LinearElementEditor.getPointsGlobalCoordinates(arrow, new Map())
			: [];

	function ends(arrow: EditorElement): [Point, Point] {
		const points = absolute(arrow);
		return [points[0] ?? [arrow.x, arrow.y], points.at(-1) ?? [arrow.x, arrow.y]];
	}

	/**
	 * What the canvas does after each change, with what is selected: release the
	 * routes it folded through their own shapes and have Excalidraw route them.
	 * Returns the released ids.
	 */
	function change(scene: EditorScene, selected: readonly EditorElement[] = []): string[] {
		const release = releases.get(scene)!;
		const { elements, released } = release(
			scene.getElementsIncludingDeleted(),
			Object.fromEntries(selected.map((element) => [element.id, true as const])),
		);
		if (released.length === 0) return [];
		scene.replaceAllElements(elements);
		for (const arrow of released)
			routeReleased(
				(element, updates) => editor.mutateElement(element, updates),
				arrow as EditorElement & { points: Point[] },
			);
		return released.map((arrow) => arrow.id);
	}

	/** The scene as Excalidraw's editor loads it from initial data, and the canvas sees it. */
	function open(elements: readonly unknown[]): EditorScene {
		const scene = new editor.Scene_default();
		scene.replaceAllElements(
			editor.restoreElements(structuredClone(elements), null, {
				refreshDimensions: false,
				repairBindings: true,
			}),
		);
		releases.set(scene, createRouteRelease());
		change(scene);
		return scene;
	}

	/** Shapes a person can drag that hold a bound arrow. */
	const boundShapes = (scene: EditorScene) =>
		scene
			.getNonDeletedElements()
			.filter(
				(element) =>
					editor.isBindableElement(element) &&
					element.boundElements?.some((bound) => bound.type === "arrow"),
			);

	/**
	 * The first touch of a shape: Excalidraw re-places every arrow bound to it
	 * before anything moves. Returns the routes the canvas released.
	 */
	function touch(scene: EditorScene): string[] {
		for (const shape of boundShapes(scene)) {
			editor.updateBoundElements(shape, scene.getNonDeletedElementsMap());
		}
		return change(scene);
	}

	/**
	 * A pointer drag of what a click on `shape` selects, through Excalidraw's drag,
	 * one pointer move every two pixels or so. Returns the routes it released.
	 */
	function drag(scene: EditorScene, shape: EditorElement, offset: Point): string[] {
		const steps = Math.max(1, Math.ceil(Math.hypot(offset[0], offset[1]) / 2));
		const pointerDownState = { originalElements: originals(scene) };
		const selected = selection(scene, shape);
		const released: string[] = [];
		for (let step = 1; step <= steps; step += 1) {
			editor.dragSelectedElements(
				pointerDownState,
				selected,
				{ x: (offset[0] * step) / steps, y: (offset[1] * step) / steps },
				scene,
				{ x: 0, y: 0 },
				null,
			);
			released.push(...change(scene));
		}
		return released;
	}

	/** A pointer drag of a selection handle, through Excalidraw's resize. */
	function resize(scene: EditorScene, shape: EditorElement, handle: "nw" | "se", offset: Point) {
		const steps = Math.max(1, Math.ceil(Math.hypot(offset[0], offset[1]) / 2));
		const originalElements = originals(scene);
		const selected = selection(scene, shape);
		const left = Math.min(...selected.map((element) => element.x));
		const top = Math.min(...selected.map((element) => element.y));
		const right = Math.max(...selected.map((element) => element.x + element.width));
		const bottom = Math.max(...selected.map((element) => element.y + element.height));
		const [cornerX, cornerY] = handle === "se" ? [right, bottom] : [left, top];
		for (let step = 1; step <= steps; step += 1) {
			editor.transformElements(
				originalElements,
				handle,
				selected,
				scene.getNonDeletedElementsMap(),
				scene,
				false,
				false,
				false,
				cornerX + (offset[0] * step) / steps,
				cornerY + (offset[1] * step) / steps,
				(left + right) / 2,
				(top + bottom) / 2,
			);
			change(scene);
		}
	}

	/** Each bound arrow's ends, by id. */
	const snapshot = (scene: EditorScene) =>
		new Map(
			scene
				.getNonDeletedElements()
				.filter(isBoundArrow)
				.map((arrow) => [arrow.id, ends(arrow)] as const),
		);

	/** Every bound route and the shapes it binds to, as they stand. */
	function routesAndShapes(scene: EditorScene) {
		const elements = scene.getNonDeletedElementsMap();
		return new Map(
			scene
				.getNonDeletedElements()
				.filter(isBoundArrow)
				.map((arrow) => {
					const shapes = [arrow.startBinding, arrow.endBinding].map((binding) => {
						const shape = binding ? elements.get(binding.elementId) : undefined;
						return shape ? [shape.x, shape.y, shape.width, shape.height].join(",") : "";
					});
					return [arrow.id, { route: absolute(arrow), shapes: shapes.join("|") }] as const;
				}),
		);
	}

	/**
	 * Where each bound end of the arrows `which` picks (every one, by default)
	 * sits against its bindable shape. `grown` gives how much a resize grew a
	 * shape, which scales an elbow end's reach.
	 */
	function readEnds(
		scene: EditorScene,
		{
			grown = new Map(),
			which = () => true,
		}: {
			readonly grown?: ReadonlyMap<string, number>;
			readonly which?: (arrow: EditorElement) => boolean;
		} = {},
	): EndReading[] {
		const elements = scene.getNonDeletedElementsMap();
		const readings: EndReading[] = [];
		for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
			if (!which(arrow)) continue;
			const points = absolute(arrow);
			for (const [key, end, neighbour] of [
				["startBinding", points[0]!, points[1]!],
				["endBinding", points[points.length - 1]!, points[points.length - 2]!],
			] as const) {
				const binding = arrow[key];
				if (!binding) continue;
				const shape = elements.get(binding.elementId);
				const reading = { arrow, key, shapeId: binding.elementId };
				if (!shape) {
					readings.push({
						...reading,
						shape,
						listed: false,
						crowded: false,
						off: Infinity,
						slack: 0,
						reach: 0,
						drawnOff: undefined,
					});
					continue;
				}
				if (!editor.isBindableElement(shape)) continue;
				const reach = arrow.elbowed
					? FIXED_BINDING_DISTANCE * (grown.get(shape.id) ?? 1)
					: binding.gap * Math.SQRT2;
				const other = elements.get(
					(key === "startBinding" ? arrow.endBinding : arrow.startBinding)?.elementId ?? "",
				);
				const composed = shape.customData?.["sketchiShape"];
				readings.push({
					...reading,
					shape,
					listed: shape.boundElements?.some((bound) => bound.id === arrow.id) ?? false,
					crowded:
						(isCurved(arrow) && within(neighbour, shape, reach)) ||
						(other !== undefined && other !== shape && overlap(shape, other, reach)),
					off: signedDistance(end, drawnOutline(shape)),
					slack: inRoundedCorner(end, shape, reach) ? CORNER_SOLVE_SLACK : OUTLINE_SLACK,
					reach,
					drawnOff:
						typeof composed === "string" && isCanvasComposedShape(composed) && shape.angle === 0
							? signedDistance(
									end,
									canvasShapeOutline({ ...shape, shape: composed }).map(({ x, y }): Point => [
										x,
										y,
									]),
								)
							: undefined,
				});
			}
		}
		return readings;
	}

	/**
	 * Each bound route that `which` picks and that runs through a shape it is
	 * bound to, as [route, shape] ids: by default the routes Excalidraw still
	 * keeps as drawn, which the canvas releases once a drag folds them.
	 */
	function routesThroughShapes(
		scene: EditorScene,
		which: (arrow: EditorElement) => boolean = keptAsDrawn,
	): [string, string][] {
		const elements = scene.getNonDeletedElementsMap();
		const through: [string, string][] = [];
		for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
			if (!which(arrow)) continue;
			for (const end of ["start", "end"] as const) {
				const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
				const shape = binding ? elements.get(binding.elementId) : undefined;
				if (shape && routeEntersShape(absolute(arrow), shape, end))
					through.push([arrow.id, shape.id]);
			}
		}
		return through;
	}

	/**
	 * How close Excalidraw's update keeps an end to where it is drawn: to float
	 * precision, except an elbow end at a side's middle, whose fixed point
	 * Excalidraw reads as 0.5001 of the side, a ten-thousandth across.
	 */
	function keptWithin(
		arrow: EditorElement,
		key: "startBinding" | "endBinding",
		elements: Map<string, EditorElement>,
	): number {
		const binding = arrow[key];
		const shape = binding ? elements.get(binding.elementId) : undefined;
		const fixedPoint = arrow.elbowed ? binding?.fixedPoint : undefined;
		if (!shape || !fixedPoint) return KEPT;
		const middle = (ratio: number, size: number) =>
			Math.abs(ratio - 0.5001) < 1e-9 ? 1e-4 * size : 0;
		return (
			KEPT + Math.hypot(middle(fixedPoint[0], shape.width), middle(fixedPoint[1], shape.height))
		);
	}

	/** How far from its drawing a touched route may read: the larger of its ends' kept distances. */
	const routeKeptWithin = (arrow: EditorElement, elements: Map<string, EditorElement>) =>
		Math.max(
			keptWithin(arrow, "startBinding", elements),
			keptWithin(arrow, "endBinding", elements),
		);

	return {
		absolute,
		boundShapes,
		change,
		drag,
		editor,
		ends,
		keptWithin,
		open,
		readEnds,
		resize,
		routeKeptWithin,
		routesAndShapes,
		routesThroughShapes,
		snapshot,
		touch,
	};
}

export type EditSession = ReturnType<typeof createEditSession>;
