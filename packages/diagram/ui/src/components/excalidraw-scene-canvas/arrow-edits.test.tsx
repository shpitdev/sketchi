import {
	type CanvasSpec,
	canvasShapeOutline,
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	flowchartFixture,
	isCanvasComposedShape,
	parseFlowchartDiagram,
	zoneStressFixtures,
} from "@sketchi/diagram-core";
import { convertSceneToExcalidraw, routeEntersShape } from "@sketchi/diagram-excalidraw";
import { renderDiagram, renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { diagramScenarios } from "@sketchi/diagram-scenarios";
import * as excalidraw from "@sketchi/excalidraw-internals";
import { describe, expect, it } from "vitest";
import { createRouteRelease, routeReleased } from "./route-release";

/**
 * Arrows in an exported diagram, edited with Excalidraw 0.18.1's own code: the
 * restore the editor loads a scene through, the drag and resize a pointer
 * gesture runs, and the update that re-places every arrow bound to a moved
 * shape. Each bound end must stay where it is drawn until something moves,
 * then stay on the outline a person sees, bound both ways. Every change runs
 * the canvas's own step after it, which releases a route a drag folds through
 * its own shape to Excalidraw's elbow routing.
 */

type Point = [number, number];
interface Binding {
	readonly elementId: string;
	readonly fixedPoint?: Point | null;
	readonly focus: number;
	readonly gap: number;
}
interface Element {
	readonly id: string;
	readonly type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
	points?: Point[];
	startBinding?: Binding | null;
	endBinding?: Binding | null;
	boundElements?: { id: string; type: string }[] | null;
	groupIds: string[];
	frameId?: string | null;
	containerId?: string | null;
	customData?: Record<string, unknown>;
	elbowed?: boolean;
	fixedSegments?: readonly unknown[] | null;
	isDeleted: boolean;
	roundness: { type: number; value?: number } | null;
}
interface Scene {
	replaceAllElements(elements: readonly Element[]): void;
	getElementsIncludingDeleted(): readonly Element[];
	getNonDeletedElements(): readonly Element[];
	getNonDeletedElementsMap(): Map<string, Element>;
	getElementsMapIncludingDeleted(): Map<string, Element>;
}
interface Internals {
	Scene_default: new () => Scene;
	dragSelectedElements(
		pointerDownState: { originalElements: Map<string, Element> },
		selected: readonly Element[],
		offset: { x: number; y: number },
		scene: Scene,
		snapOffset: { x: number; y: number },
		gridSize: number | null,
	): void;
	isBindableElement(element: Element): boolean;
	mutateElement: (element: Element, updates: { points: readonly Point[] }) => Element;
	restoreElements(
		elements: readonly unknown[],
		local: null,
		options: { refreshDimensions: boolean; repairBindings: boolean },
	): Element[];
	setCustomTextMetricsProvider(provider: {
		getLineWidth(text: string, font: string): number;
	}): void;
	transformElements(
		originalElements: Map<string, Element>,
		handle: string,
		selected: readonly Element[],
		elementsMap: Map<string, Element>,
		scene: Scene,
		rotateWithDiscreteAngle: boolean,
		resizeFromCenter: boolean,
		maintainAspectRatio: boolean,
		pointerX: number,
		pointerY: number,
		centerX: number,
		centerY: number,
	): boolean;
	updateBoundElements(element: Element, elementsMap: Map<string, Element>): void;
}

const internals = excalidraw as Internals;

// Text measurement only places labels; any monospace stand-in leaves arrows alone.
internals.setCustomTextMetricsProvider({
	getLineWidth: (text, font) => text.length * (Number.parseFloat(font) || 16) * 0.55,
});

/** How far Excalidraw keeps an elbow arrow end it has to re-place off its outline. */
const FIXED_BINDING_DISTANCE = 5;
/**
 * How far inside a rounded corner Excalidraw may leave an end: its curve
 * intersection finds one root, sometimes where the line leaves the corner, and
 * then drops the end on the focus point just inside it.
 */
const CORNER_SOLVE_SLACK = 1.5;
/** First-touch ends must match to float precision. */
const KEPT = 1e-9;

/**
 * How close Excalidraw's update keeps an end to where it is drawn: to float
 * precision, except an elbow end at a side's middle, whose fixed point
 * Excalidraw reads as 0.5001 of the side, a ten-thousandth across.
 */
function keptWithin(
	arrow: Element,
	key: "startBinding" | "endBinding",
	elements: Map<string, Element>,
): number {
	const binding = arrow[key];
	const shape = binding ? elements.get(binding.elementId) : undefined;
	const fixedPoint = arrow.elbowed ? binding?.fixedPoint : undefined;
	if (!shape || !fixedPoint) return KEPT;
	const middle = (ratio: number, size: number) =>
		Math.abs(ratio - 0.5001) < 1e-9 ? 1e-4 * size : 0;
	return KEPT + Math.hypot(middle(fixedPoint[0], shape.width), middle(fixedPoint[1], shape.height));
}

const releases = new WeakMap<Scene, ReturnType<typeof createRouteRelease>>();

/**
 * What the canvas does after each change: release the routes it folded through
 * their own shapes and have Excalidraw route them. Returns the released ids.
 */
function canvasChange(scene: Scene): string[] {
	const release = releases.get(scene)!;
	const { elements, released } = release(scene.getElementsIncludingDeleted() as never);
	if (released.length === 0) return [];
	scene.replaceAllElements(elements as unknown as Element[]);
	for (const arrow of released) routeReleased(internals.mutateElement as never, arrow);
	return released.map((arrow) => arrow.id);
}

/** The scene as Excalidraw's editor loads it from initial data, and the canvas sees it. */
function openInExcalidraw(elements: readonly unknown[]): Scene {
	const scene = new internals.Scene_default();
	scene.replaceAllElements(
		internals.restoreElements(structuredClone(elements), null, {
			refreshDimensions: false,
			repairBindings: true,
		}),
	);
	releases.set(scene, createRouteRelease());
	canvasChange(scene);
	return scene;
}

const isBoundArrow = (element: Element) =>
	element.type === "arrow" &&
	!element.isDeleted &&
	Boolean(element.startBinding || element.endBinding);

function ends(arrow: Element): [Point, Point] {
	const points = arrow.points ?? [[0, 0]];
	const [first, last] = [points[0]!, points[points.length - 1]!];
	return [
		[arrow.x + first[0], arrow.y + first[1]],
		[arrow.x + last[0], arrow.y + last[1]],
	];
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const absolute = (arrow: Element): Point[] =>
	(arrow.points ?? []).map(([x, y]): Point => [arrow.x + x, arrow.y + y]);

function snapshot(scene: Scene) {
	return new Map(
		scene
			.getNonDeletedElements()
			.filter(isBoundArrow)
			.map((arrow) => [arrow.id, ends(arrow)] as const),
	);
}

/** Excalidraw's adaptive and proportional corner radius. */
function cornerRadius(shape: Element): number {
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
function drawnOutline(shape: Element): Point[] {
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

/**
 * Every bound end in the scene sits outside the outline a person sees, no
 * farther than its binding's gap (an elbow end: on the outline, or
 * FIXED_BINDING_DISTANCE out where Excalidraw re-placed it), and the shape
 * still lists the arrow. An end whose shapes overlap has no outline to meet and
 * is left out, as is a curved arrow's end that Excalidraw aims from inside its
 * own shape: it bends through its points, which a drag can carry its shape
 * over, and the canvas leaves curves as they are.
 */
function expectEndsOnOutlines(
	scene: Scene,
	context: string,
	grown: ReadonlyMap<string, number> = new Map(),
) {
	const elements = scene.getNonDeletedElementsMap();
	let checked = 0;
	let crowded = 0;
	for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
		const points = (arrow.points ?? []).map(([x, y]): Point => [arrow.x + x, arrow.y + y]);
		for (const [key, end, neighbour] of [
			["startBinding", points[0]!, points[1]!],
			["endBinding", points[points.length - 1]!, points[points.length - 2]!],
		] as const) {
			const binding = arrow[key];
			if (!binding) continue;
			const shape = elements.get(binding.elementId);
			const where = `${context}: ${arrow.id} ${key} on ${binding.elementId}`;
			expect(shape, where).toBeDefined();
			if (!shape || !internals.isBindableElement(shape)) continue;
			expect(
				shape.boundElements?.some((bound) => bound.id === arrow.id),
				`${where} is listed on its shape`,
			).toBe(true);
			// An end that is not elbowed sits on Excalidraw's outline grown by its gap,
			// whose corners stay square on a sharp box: up to the gap's diagonal out. An
			// elbow end sits on the outline or FIXED_BINDING_DISTANCE out, a distance
			// that grows with its shape when Excalidraw scales the fixed point.
			const reach = arrow.elbowed
				? FIXED_BINDING_DISTANCE * (grown.get(shape.id) ?? 1)
				: binding.gap * Math.SQRT2;
			const other = elements.get(
				(key === "startBinding" ? arrow.endBinding : arrow.startBinding)?.elementId ?? "",
			);
			const curved = !arrow.elbowed && arrow.roundness !== null && (arrow.points?.length ?? 0) > 2;
			if (
				(curved && within(neighbour, shape, reach)) ||
				(other && other !== shape && overlap(shape, other, reach))
			) {
				crowded += 1;
				continue;
			}
			checked += 1;
			const off = signedDistance(end, drawnOutline(shape));
			const slack = inRoundedCorner(end, shape, reach) ? CORNER_SOLVE_SLACK : 0.05;
			expect(off, `${where} stays outside its outline`).toBeGreaterThanOrEqual(-slack);
			expect(off, `${where} stays within its gap`).toBeLessThanOrEqual(reach + 0.05);
			const composed = shape.customData?.["sketchiShape"];
			if (typeof composed === "string" && isCanvasComposedShape(composed) && shape.angle === 0) {
				const drawn = canvasShapeOutline({ ...shape, shape: composed }).map(({ x, y }): Point => [
					x,
					y,
				]);
				expect(
					signedDistance(end, drawn),
					`${where} stays outside the drawn shape`,
				).toBeGreaterThan(-0.05);
			}
		}
	}
	expect(
		checked,
		`${context}: ends with an outline to meet, of ${checked + crowded}`,
	).toBeGreaterThan(0);
}

/** A route Excalidraw keeps as drawn: a sharp polyline, or an elbow arrow with pinned runs. */
const keptAsDrawn = (arrow: Element) =>
	arrow.elbowed
		? (arrow.fixedSegments?.length ?? 0) > 0
		: (arrow.points?.length ?? 0) > 2 && arrow.roundness === null;

/**
 * No route Excalidraw still keeps as drawn passes through a shape it is bound
 * to: one a drag folds through its shape is released to Excalidraw's elbow
 * routing, which goes around it.
 */
function expectRoutesClearOfTheirShapes(scene: Scene, context: string) {
	const elements = scene.getNonDeletedElementsMap();
	for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
		if (!keptAsDrawn(arrow)) continue;
		for (const end of ["start", "end"] as const) {
			const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
			const shape = binding ? elements.get(binding.elementId) : undefined;
			if (!shape) continue;
			expect(
				routeEntersShape(absolute(arrow), shape, end),
				`${context}: ${arrow.id} runs through ${shape.id}`,
			).toBe(false);
		}
	}
}

/** Every bound route and the shapes it binds to, as they stand. */
function routesAndShapes(scene: Scene) {
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

function inRoundedCorner(point: Point, shape: Element, pad: number): boolean {
	const radius = shape.type === "rectangle" ? cornerRadius(shape) : 0;
	if (radius === 0) return false;
	const reach = radius + pad;
	const nearX = point[0] < shape.x + reach || point[0] > shape.x + shape.width - reach;
	const nearY = point[1] < shape.y + reach || point[1] > shape.y + shape.height - reach;
	return nearX && nearY;
}

const within = (point: Point, shape: Element, pad: number) =>
	point[0] > shape.x - pad &&
	point[0] < shape.x + shape.width + pad &&
	point[1] > shape.y - pad &&
	point[1] < shape.y + shape.height + pad;

const overlap = (a: Element, b: Element, pad: number) =>
	a.x - pad < b.x + b.width &&
	b.x - pad < a.x + a.width &&
	a.y - pad < b.y + b.height &&
	b.y - pad < a.y + a.height;

/** What a click on a shape selects: its outermost group, else the shape. */
function selection(scene: Scene, shape: Element): Element[] {
	const group = shape.groupIds.at(-1);
	return group
		? scene.getNonDeletedElements().filter((element) => element.groupIds.includes(group))
		: [shape];
}

const originals = (scene: Scene) =>
	new Map(scene.getNonDeletedElements().map((element) => [element.id, structuredClone(element)]));

/**
 * A pointer drag of what a click on `shape` selects, through Excalidraw's drag,
 * one pointer move every two pixels or so.
 */
function drag(scene: Scene, shape: Element, offset: Point) {
	const steps = Math.max(1, Math.ceil(Math.hypot(offset[0], offset[1]) / 2));
	const pointerDownState = { originalElements: originals(scene) };
	const selected = selection(scene, shape);
	for (let step = 1; step <= steps; step += 1) {
		internals.dragSelectedElements(
			pointerDownState,
			selected,
			{ x: (offset[0] * step) / steps, y: (offset[1] * step) / steps },
			scene,
			{ x: 0, y: 0 },
			null,
		);
		canvasChange(scene);
	}
}

/** A pointer drag of a selection handle, through Excalidraw's resize. */
function resize(scene: Scene, shape: Element, handle: "nw" | "se", offset: Point) {
	const steps = Math.max(1, Math.ceil(Math.hypot(offset[0], offset[1]) / 2));
	const originalElements = originals(scene);
	const selected = selection(scene, shape);
	const left = Math.min(...selected.map((element) => element.x));
	const top = Math.min(...selected.map((element) => element.y));
	const right = Math.max(...selected.map((element) => element.x + element.width));
	const bottom = Math.max(...selected.map((element) => element.y + element.height));
	const [cornerX, cornerY] = handle === "se" ? [right, bottom] : [left, top];
	for (let step = 1; step <= steps; step += 1) {
		internals.transformElements(
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
		canvasChange(scene);
	}
}

const boundShapes = (scene: Scene) =>
	scene
		.getNonDeletedElements()
		.filter(
			(element) =>
				internals.isBindableElement(element) &&
				element.boundElements?.some((bound) => bound.type === "arrow"),
		);

const exported = (scene: ReturnType<typeof renderDiagram>) =>
	convertSceneToExcalidraw(scene).elements;

/** Every maintained scenario that draws a bound arrow. */
const scenarios = diagramScenarios
	.map((scenario) => ({
		id: scenario.id,
		elements: exported(renderDiagram(scenario.expectedDiagram)),
	}))
	.filter(({ elements }) =>
		elements.some((element) => element.type === "arrow" && element["startBinding"]),
	);

/** An agent-drawn canvas: lines bound straight, off-centre and elbowed to each shape kind. */
const canvas: CanvasSpec = {
	kind: "canvas",
	version: 1,
	diagramId: "bound-lines",
	title: "Bound lines",
	width: 760,
	height: 420,
	accentColor: "#111827",
	backgroundColor: "#ffffff",
	elements: [
		{
			type: "node",
			id: "box",
			nodeId: "box",
			shape: "rectangle",
			x: 40,
			y: 40,
			width: 160,
			height: 70,
			label: "Box",
		},
		{
			type: "node",
			id: "oval",
			nodeId: "oval",
			shape: "ellipse",
			x: 320,
			y: 30,
			width: 150,
			height: 90,
			label: "Oval",
		},
		{
			type: "node",
			id: "gem",
			nodeId: "gem",
			shape: "diamond",
			x: 560,
			y: 20,
			width: 150,
			height: 110,
			label: "Gem",
		},
		{
			type: "node",
			id: "db",
			nodeId: "db",
			shape: "cylinder",
			x: 40,
			y: 260,
			width: 150,
			height: 100,
			label: "Store",
		},
		{
			type: "node",
			id: "s3",
			nodeId: "s3",
			shape: "bucket",
			x: 320,
			y: 260,
			width: 160,
			height: 110,
			label: "Bucket",
		},
		{
			type: "line",
			id: "box-oval",
			points: [
				{ x: 200, y: 75 },
				{ x: 320, y: 75 },
			],
			startBinding: { elementId: "box" },
			endBinding: { elementId: "oval" },
			endArrowhead: "arrow",
		},
		{
			type: "line",
			id: "box-db",
			points: [
				{ x: 104, y: 110 },
				{ x: 104, y: 260 },
			],
			startBinding: { elementId: "box" },
			endBinding: { elementId: "db" },
			endArrowhead: "arrow",
		},
		{
			type: "line",
			id: "oval-s3",
			points: [
				{ x: 395, y: 120 },
				{ x: 395, y: 190 },
				{ x: 400, y: 190 },
				{ x: 400, y: 260 },
			],
			startBinding: { elementId: "oval" },
			endBinding: { elementId: "s3" },
			endArrowhead: "arrow",
		},
		{
			type: "line",
			id: "gem-s3",
			points: [
				{ x: 635, y: 130 },
				{ x: 635, y: 315 },
				{ x: 480, y: 315 },
			],
			startBinding: { elementId: "gem" },
			endBinding: { elementId: "s3" },
			endArrowhead: "arrow",
		},
	],
	layers: [],
	layouts: [],
	zOrder: ["box", "oval", "gem", "db", "s3", "box-oval", "box-db", "oval-s3", "gem-s3"],
};

/** One of each shape a person drags: box, diamond, ellipse, cylinder, bucket, logo node, zoned node. */
const shapeKinds = [
	{
		id: "flowchart",
		elements: exported(renderIntermediateDiagram(flowchartFixture)),
	},
	{
		id: "zones with a database and a bucket",
		elements: exported(renderIntermediateDiagram(zoneStressFixtures["depth-four"])),
	},
	{
		id: "logo nodes",
		elements: exported(
			embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) => ({
				name: slug,
				svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${slug}</title></svg>`,
			})).scene,
		),
	},
	{
		id: "fan-out to infrastructure",
		elements: exported(
			renderIntermediateDiagram(
				parseFlowchartDiagram({
					id: "fan-out-infrastructure",
					title: "Fan-out to infrastructure",
					type: "flowchart",
					nodes: [
						{ id: "api", label: "API", kind: "start" },
						{ id: "cache", label: "Cache", kind: "end" },
						{ id: "db", label: "Orders", kind: "end", shape: "database" },
						{ id: "files", label: "Uploads", kind: "end", shape: "storage" },
						{ id: "queue", label: "Jobs", kind: "end", shape: "queue" },
					],
					edges: [
						{ id: "api-cache", source: "api", target: "cache" },
						{ id: "api-db", source: "api", target: "db" },
						{ id: "api-files", source: "api", target: "files" },
						{ id: "api-queue", source: "api", target: "queue" },
					],
					layout: { direction: "TB", edgeRouting: "orthogonal" },
				}),
			),
		),
	},
	{ id: "agent canvas", elements: convertSceneToExcalidraw(canvas).elements },
];

const offsets: readonly Point[] = [
	[48, 0],
	[0, 36],
	[-52, 0],
	[0, -44],
	[64, 40],
	[-70, -30],
	[180, 140],
];

describe("arrows in a diagram a person edits in Excalidraw", () => {
	it.each([...scenarios, ...shapeKinds].map((scene) => [scene.id, scene.elements] as const))(
		"leaves every bound arrow of %s where it is drawn on the first touch",
		(_id, elements) => {
			const scene = openInExcalidraw(elements);
			const drawn = new Map(
				elements
					.filter(
						(element) =>
							element.type === "arrow" && (element["startBinding"] || element["endBinding"]),
					)
					.map((element) => [element.id, ends(element as unknown as Element)] as const),
			);
			const routes = new Map(
				elements
					.filter(
						(element) =>
							element.type === "arrow" && (element["startBinding"] || element["endBinding"]),
					)
					.map((element) => [element.id, absolute(element as unknown as Element)] as const),
			);
			// Loading changes no end.
			for (const [id, loaded] of snapshot(scene)) {
				const [start, end] = drawn.get(id)!;
				expect(distance(loaded[0], start), `${id} start on load`).toBeLessThanOrEqual(KEPT);
				expect(distance(loaded[1], end), `${id} end on load`).toBeLessThanOrEqual(KEPT);
			}
			for (const shape of boundShapes(scene)) {
				internals.updateBoundElements(shape, scene.getNonDeletedElementsMap());
			}
			expect(canvasChange(scene), "routes released by the first touch").toEqual([]);
			const loaded = scene.getNonDeletedElementsMap();
			for (const [id, touched] of snapshot(scene)) {
				const [start, end] = drawn.get(id)!;
				const arrow = loaded.get(id)!;
				expect(distance(touched[0], start), `${id} start after a touch`).toBeLessThanOrEqual(
					keptWithin(arrow, "startBinding", loaded),
				);
				expect(distance(touched[1], end), `${id} end after a touch`).toBeLessThanOrEqual(
					keptWithin(arrow, "endBinding", loaded),
				);
				// And the route between them, every bend where it is drawn.
				const route = routes.get(id)!;
				const after = absolute(arrow);
				expect(after, `${id} keeps its points`).toHaveLength(route.length);
				const slack = Math.max(
					keptWithin(arrow, "startBinding", loaded),
					keptWithin(arrow, "endBinding", loaded),
				);
				for (const [index, point] of route.entries()) {
					expect(
						distance(after[index]!, point),
						`${id} point ${index} after a touch`,
					).toBeLessThanOrEqual(slack);
				}
			}
			expectEndsOnOutlines(scene, "untouched");
		},
	);

	it.each(scenarios.map((scene) => [scene.id, scene.elements] as const))(
		"keeps every arrow of %s on its outlines while each shape is dragged",
		(_id, elements) => {
			for (const [index, target] of boundShapes(openInExcalidraw(elements)).entries()) {
				const scene = openInExcalidraw(elements);
				const before = routesAndShapes(scene);
				try {
					drag(
						scene,
						scene.getNonDeletedElementsMap().get(target.id)!,
						offsets[index % offsets.length]!,
					);
				} catch (error) {
					// Excalidraw 0.18.1's elbow router finds no route for a few gantt bar drags
					// and throws, whatever the bindings.
					expect(String((error as Error).stack)).toContain("elbowArrow");
					continue;
				}
				expectEndsOnOutlines(scene, `after dragging ${target.id}`);
				expectRoutesClearOfTheirShapes(scene, `after dragging ${target.id}`);
				// A route whose shapes stayed put stays put.
				for (const [id, after] of routesAndShapes(scene)) {
					const drawn = before.get(id)!;
					if (after.shapes !== drawn.shapes) continue;
					expect(after.route, `${id} untouched by dragging ${target.id}`).toEqual(drawn.route);
				}
			}
		},
	);

	/** ER tables and class boxes, whose rows and sides an end is drawn to. */
	const rowScenarios = scenarios.filter(({ elements }) =>
		elements.some((element) =>
			["er-table", "class-box"].includes(
				String(
					(element["customData"] as Record<string, unknown> | undefined)?.["sketchiRendererRole"],
				),
			),
		),
	);

	it.each(rowScenarios.map((scene) => [scene.id, scene.elements] as const))(
		"keeps every line of %s on its row when a table or class moves off the line's axis",
		(_id, elements) => {
			const tables = boundShapes(openInExcalidraw(elements)).filter((shape) =>
				["er-table", "class-box"].includes(String(shape.customData?.["sketchiRendererRole"])),
			);
			expect(tables.length).toBeGreaterThan(0);
			for (const table of tables) {
				for (const offset of [
					[30, 120],
					[-40, -90],
				] as Point[]) {
					const scene = openInExcalidraw(elements);
					const shape = scene.getNonDeletedElementsMap().get(table.id)!;
					// Where each end bound to the table meets it, along the table.
					const place = (scene: Scene) =>
						new Map(
							scene
								.getNonDeletedElements()
								.filter(isBoundArrow)
								.flatMap((arrow) => {
									const [start, end] = ends(arrow);
									const moved = scene.getNonDeletedElementsMap().get(table.id)!;
									return (
										[
											["startBinding", start],
											["endBinding", end],
										] as const
									)
										.filter(([key]) => arrow[key]?.elementId === table.id)
										.map(
											([key, point]) =>
												[`${arrow.id} ${key}`, [point[0] - moved.x, point[1] - moved.y]] as const,
										);
								}),
						);
					const before = place(scene);
					drag(scene, shape, offset);
					for (const [end, [x, y]] of place(scene)) {
						const [drawnX, drawnY] = before.get(end)!;
						// The row is the end's height on a side, and its place across a top or bottom.
						const onSide = Math.abs(drawnX) < 6 || Math.abs(drawnX - shape.width) < 6;
						const along = onSide ? [y, drawnY] : [x, drawnX];
						// Excalidraw reads a side's middle as 0.5001 of it, a ten-thousandth across.
						const middle = 1e-4 * (onSide ? shape.height : shape.width);
						expect(
							Math.abs(along[0]! - along[1]!),
							`${end} keeps its row after ${table.id} moves ${offset.join(",")}`,
						).toBeLessThanOrEqual(middle + 1e-6);
					}
				}
			}
		},
	);

	it.each(shapeKinds.map((scene) => [scene.id, scene.elements] as const))(
		"keeps every arrow of %s on its outlines through drags in every direction, resizes and far-end drags",
		(_id, elements) => {
			for (const target of boundShapes(openInExcalidraw(elements))) {
				for (const offset of offsets) {
					const scene = openInExcalidraw(elements);
					const shape = scene.getNonDeletedElementsMap().get(target.id)!;
					drag(scene, shape, offset);
					expectEndsOnOutlines(scene, `${target.id} dragged by ${offset.join(",")}`);
					expectRoutesClearOfTheirShapes(scene, `${target.id} dragged by ${offset.join(",")}`);
					// Then the shape at the far end of each of its arrows.
					for (const arrow of scene.getNonDeletedElements().filter(isBoundArrow)) {
						const ids = [arrow.startBinding?.elementId, arrow.endBinding?.elementId];
						if (!ids.includes(target.id)) continue;
						const far = ids.find((id) => id !== target.id);
						const farShape = far ? scene.getNonDeletedElementsMap().get(far) : undefined;
						if (!farShape || !internals.isBindableElement(farShape)) continue;
						drag(scene, farShape, [-offset[1], offset[0]]);
						expectEndsOnOutlines(scene, `${far} dragged after ${target.id}`);
						expectRoutesClearOfTheirShapes(scene, `${far} dragged after ${target.id}`);
					}
				}
				// Shrunk below its label, a shape grows back to fit it after Excalidraw has
				// re-placed its arrows, which is Excalidraw's own resize; grown, it keeps them.
				for (const [handle, offset] of [
					["se", [40, 30]],
					["se", [32, 0]],
					["nw", [-36, -24]],
					["nw", [0, -28]],
				] as const) {
					const scene = openInExcalidraw(elements);
					const before = { ...scene.getNonDeletedElementsMap().get(target.id)! };
					resize(scene, scene.getNonDeletedElementsMap().get(target.id)!, handle, [...offset]);
					const after = scene.getNonDeletedElementsMap().get(target.id)!;
					const growth = Math.max(after.width / before.width, after.height / before.height, 1);
					expectEndsOnOutlines(
						scene,
						`${target.id} resized from ${handle} by ${offset.join(",")}`,
						new Map([[target.id, growth]]),
					);
				}
			}
		},
	);

	it.each(shapeKinds.map((scene) => [scene.id, scene.elements] as const))(
		"brings every arrow of %s back where it was drawn when a shape is dragged away and back, however often",
		(_id, elements) => {
			for (const target of boundShapes(openInExcalidraw(elements))) {
				const scene = openInExcalidraw(elements);
				const drawn = snapshot(scene);
				const shape = scene.getNonDeletedElementsMap().get(target.id)!;
				const rounds: Map<string, [Point, Point]>[] = [];
				for (let round = 0; round < 8; round += 1) {
					drag(scene, shape, [60, 45]);
					drag(scene, shape, [-60, -45]);
					rounds.push(snapshot(scene));
				}
				const kept = new Map(
					openInExcalidraw(elements)
						.getNonDeletedElements()
						.filter(isBoundArrow)
						.map((arrow) => [arrow.id, keptAsDrawn(arrow)] as const),
				);
				for (const [id, [start, end]] of rounds.at(-1)!) {
					const [firstStart, firstEnd] = rounds[0]!.get(id)!;
					const [lastStart, lastEnd] = rounds.at(-2)!.get(id)!;
					const [drawnStart, drawnEnd] = drawn.get(id)!;
					const arrow = scene.getNonDeletedElementsMap().get(id)!;
					// A route the drag released ends where Excalidraw puts an elbow end at its
					// drawn port: on the outline, or FIXED_BINDING_DISTANCE out.
					const back = kept.get(id) && !keptAsDrawn(arrow) ? FIXED_BINDING_DISTANCE : 1;
					expect(distance(start, lastStart), `${id} start settles`).toBeLessThanOrEqual(1e-9);
					expect(distance(end, lastEnd), `${id} end settles`).toBeLessThanOrEqual(1e-9);
					expect(distance(start, firstStart), `${id} start drifts`).toBeLessThanOrEqual(0.05);
					expect(distance(end, firstEnd), `${id} end drifts`).toBeLessThanOrEqual(0.05);
					// Excalidraw aims each end of a straight arrow from where the other end was a
					// pointer move earlier, so a drag back ends within a move's lag of the drawing.
					expect(distance(start, drawnStart), `${id} start returns`).toBeLessThanOrEqual(back);
					expect(distance(end, drawnEnd), `${id} end returns`).toBeLessThanOrEqual(back);
				}
				expectEndsOnOutlines(scene, `${target.id} dragged away and back`);
			}
		},
	);
});
