import {
	type CanvasSpec,
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	flowchartFixture,
	parseFlowchartDiagram,
	zoneStressFixtures,
} from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderDiagram, renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import {
	createEditSession,
	DRAG_OFFSETS,
	diagramScenarios,
	distance,
	type EditorElement,
	type EditorScene,
	type ExcalidrawEditor,
	endDetached,
	endInside,
	type EditabilityMetrics,
	FIXED_BINDING_DISTANCE,
	isBoundArrow,
	isCurved,
	keptAsDrawn,
	measureEditability,
	type Point,
} from "@sketchi/diagram-scenarios";
import * as excalidraw from "@sketchi/excalidraw-internals";
import { describe, expect, it } from "vitest";

/**
 * Arrows in an exported diagram, edited with Excalidraw 0.18.1's own code: the
 * restore the editor loads a scene through, the drag and resize a pointer
 * gesture runs, and the update that re-places every arrow bound to a moved
 * shape. Each bound end must stay where it is drawn until something moves,
 * then stay on the outline a person sees, bound both ways. Every change runs
 * the canvas's own step after it, which releases a route a drag folds through
 * its own shape to Excalidraw's elbow routing.
 */

const internals = excalidraw as ExcalidrawEditor;
const session = createEditSession(internals);
const {
	absolute,
	boundShapes,
	change: canvasChange,
	drag,
	ends,
	keptWithin,
	open: openInExcalidraw,
	resize,
	routesAndShapes,
	snapshot,
} = session;

/** First-touch ends must match to float precision. */
const KEPT = 1e-9;

const originals = (scene: EditorScene) =>
	new Map(scene.getNonDeletedElements().map((element) => [element.id, structuredClone(element)]));

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
	scene: EditorScene,
	context: string,
	grown: ReadonlyMap<string, number> = new Map(),
) {
	let checked = 0;
	let crowded = 0;
	for (const end of session.readEnds(scene, { grown })) {
		const where = `${context}: ${end.arrow.id} ${end.key} on ${end.shapeId}`;
		expect(end.shape, where).toBeDefined();
		if (!end.shape) continue;
		expect(end.listed, `${where} is listed on its shape`).toBe(true);
		if (end.crowded) {
			crowded += 1;
			continue;
		}
		checked += 1;
		expect(end.off, `${where} stays outside its outline`).toBeGreaterThanOrEqual(-end.slack);
		expect(end.off, `${where} stays within its gap`).toBeLessThanOrEqual(end.reach + 0.05);
		if (end.drawnOff !== undefined)
			expect(end.drawnOff, `${where} stays outside the drawn shape`).toBeGreaterThan(-0.05);
		expect(endInside(end) || endDetached(end), `${where} reads as on its edge`).toBe(false);
	}
	expect(
		checked,
		`${context}: ends with an outline to meet, of ${checked + crowded}`,
	).toBeGreaterThan(0);
}

/**
 * No route Excalidraw still keeps as drawn passes through a shape it is bound
 * to: one a drag folds through its shape is released to Excalidraw's elbow
 * routing, which goes around it.
 */
function expectRoutesClearOfTheirShapes(scene: EditorScene, context: string) {
	expect(session.routesThroughShapes(scene), `${context}: routes through their shapes`).toEqual([]);
}

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

const offsets = DRAG_OFFSETS;

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
					.map((element) => [element.id, ends(element as unknown as EditorElement)] as const),
			);
			const routes = new Map(
				elements
					.filter(
						(element) =>
							element.type === "arrow" && (element["startBinding"] || element["endBinding"]),
					)
					.map((element) => [element.id, absolute(element as unknown as EditorElement)] as const),
			);
			// Loading changes no end.
			for (const [id, loaded] of snapshot(scene)) {
				const [start, end] = drawn.get(id)!;
				expect(distance(loaded[0], start), `${id} start on load`).toBeLessThanOrEqual(KEPT);
				expect(distance(loaded[1], end), `${id} end on load`).toBeLessThanOrEqual(KEPT);
			}
			expect(session.touch(scene), "routes released by the first touch").toEqual([]);
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

	/**
	 * What these drags do to a few scenarios, as the scenario CLI's editability
	 * metrics count it with every bound shape dragged. The scenarios package's
	 * editability.test.ts reads the same numbers from Excalidraw loaded into
	 * plain Node, as the CLI loads it; change both together.
	 */
	const measured: Record<string, EditabilityMetrics> = {
		"sketchi-onboarding-decision-flow": {
			editBoundRoutes: 5,
			editDragErrors: 0,
			editDrags: 5,
			editEndsInside: 0,
			editEndsOffEdge: 0,
			editFirstTouchMoves: 0,
			editReleasedRoutes: 0,
			editRouteMoves: 10,
			editRoutesThroughShape: 0,
			editStrayRouteMoves: 0,
		},
		"whole-company-org-chart-large": {
			editBoundRoutes: 79,
			editDragErrors: 0,
			editDrags: 80,
			editEndsInside: 0,
			editEndsOffEdge: 0,
			editFirstTouchMoves: 0,
			editReleasedRoutes: 30,
			editRouteMoves: 158,
			editRoutesThroughShape: 5,
			editStrayRouteMoves: 0,
		},
		"warehouse-automation-gantt-large": {
			editBoundRoutes: 74,
			editDragErrors: 0,
			editDrags: 60,
			editEndsInside: 0,
			editEndsOffEdge: 0,
			editFirstTouchMoves: 0,
			editReleasedRoutes: 35,
			editRouteMoves: 148,
			editRoutesThroughShape: 3,
			editStrayRouteMoves: 0,
		},
		"photosynthesis-study-mindmap-v2": {
			editBoundRoutes: 21,
			editDragErrors: 0,
			editDrags: 22,
			editEndsInside: 0,
			editEndsOffEdge: 0,
			editFirstTouchMoves: 0,
			editReleasedRoutes: 0,
			editRouteMoves: 164,
			editRoutesThroughShape: 0,
			editStrayRouteMoves: 0,
		},
	};

	it.each(scenarios.map((scene) => [scene.id, scene.elements] as const))(
		"keeps every arrow of %s on its outlines while each shape is dragged",
		(id, elements) => {
			const tally = { drags: 0, dragErrors: 0, released: 0, routeMoves: 0, through: 0 };
			for (const [index, target] of boundShapes(openInExcalidraw(elements)).entries()) {
				tally.drags += 1;
				const scene = openInExcalidraw(elements);
				const before = routesAndShapes(scene);
				let released: string[];
				try {
					released = drag(
						scene,
						scene.getNonDeletedElementsMap().get(target.id)!,
						offsets[index % offsets.length]!,
					);
				} catch (error) {
					// Excalidraw 0.18.1's elbow router finds no route for a few gantt bar drags
					// and throws, whatever the bindings.
					expect(String((error as Error).stack)).toContain("elbowArrow");
					tally.dragErrors += 1;
					continue;
				}
				expectEndsOnOutlines(scene, `after dragging ${target.id}`);
				expectRoutesClearOfTheirShapes(scene, `after dragging ${target.id}`);
				// A route whose shapes stayed put stays put.
				const moved = new Set<string>();
				for (const [id, after] of routesAndShapes(scene)) {
					const drawn = before.get(id)!;
					if (after.shapes !== drawn.shapes) {
						moved.add(id);
						continue;
					}
					expect(after.route, `${id} untouched by dragging ${target.id}`).toEqual(drawn.route);
				}
				tally.routeMoves += moved.size;
				tally.released += new Set(released).size;
				// Straight and elbow routes, released ones included, may still cross their shapes.
				tally.through += new Set(
					session
						.routesThroughShapes(scene, (arrow) => moved.has(arrow.id) && !isCurved(arrow))
						.map(([route]) => route),
				).size;
			}
			const expected = measured[id];
			if (!expected) return;
			expect(tally).toEqual({
				drags: expected.editDrags,
				dragErrors: expected.editDragErrors,
				released: expected.editReleasedRoutes,
				routeMoves: expected.editRouteMoves,
				through: expected.editRoutesThroughShape,
			});
			expect(measureEditability(session, elements, { cap: Infinity })).toEqual(expected);
		},
	);

	/** Diagrams with a route kept as drawn, without frames, which Excalidraw leaves unturned. */
	const turnable = scenarios.filter(
		({ elements }) =>
			!elements.some((element) => element.type === "frame") &&
			elements.some(
				(element) =>
					element.type === "arrow" &&
					(element["startBinding"] || element["endBinding"]) &&
					keptAsDrawn(element as unknown as EditorElement),
			),
	);

	it.each(turnable.map((scene) => [scene.id, scene.elements] as const))(
		"reads every route of %s where Excalidraw draws it once the diagram is rotated",
		(_id, elements) => {
			const scene = openInExcalidraw(elements);
			const pinned = new Set(
				scene
					.getNonDeletedElements()
					.filter((element) => element.elbowed && keptAsDrawn(element))
					.map((element) => element.id),
			);
			// Everything selected and turned a quarter about its middle by the rotate handle.
			const selected = scene.getNonDeletedElements().filter((element) => !element.containerId);
			const xs = selected.flatMap((element) => [element.x, element.x + element.width]);
			const ys = selected.flatMap((element) => [element.y, element.y + element.height]);
			const [centerX, centerY] = [
				(Math.min(...xs) + Math.max(...xs)) / 2,
				(Math.min(...ys) + Math.max(...ys)) / 2,
			];
			internals.transformElements(
				originals(scene),
				"rotation",
				selected,
				scene.getNonDeletedElementsMap(),
				scene,
				false,
				false,
				false,
				centerX + 100,
				centerY,
				centerX,
				centerY,
			);
			for (const shape of boundShapes(scene)) {
				expect(shape.angle, `${shape.id} turned`).toBeCloseTo(Math.PI / 2, 9);
			}
			// Excalidraw keeps an elbow arrow's pinned runs unturned; the canvas releases
			// those, and keeps every other route as the rotation leaves it.
			for (const id of canvasChange(scene, selected)) {
				expect(pinned.has(id), `${id} released by the rotation`).toBe(true);
			}
			expectRoutesClearOfTheirShapes(scene, "after the rotation");
			// Then each bound shape nudged a pixel, which folds no route.
			for (const target of boundShapes(scene)) {
				const before = routesAndShapes(scene);
				const nudged = `after nudging ${target.id}`;
				let released: string[];
				try {
					released = drag(scene, target, [1, 0]);
				} catch (error) {
					// Excalidraw 0.18.1's elbow router finds no route for a few gantt bar drags
					// and throws, whatever the bindings.
					expect(String((error as Error).stack)).toContain("elbowArrow");
					continue;
				}
				expect(released, `routes released ${nudged}`).toEqual([]);
				expectRoutesClearOfTheirShapes(scene, nudged);
				for (const [id, after] of routesAndShapes(scene)) {
					const drawn = before.get(id)!;
					if (after.shapes !== drawn.shapes) continue;
					expect(after.route, `${id} untouched ${nudged}`).toEqual(drawn.route);
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
					const place = (scene: EditorScene) =>
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
