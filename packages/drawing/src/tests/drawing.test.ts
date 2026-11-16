import { describe, expect, it } from "vitest";

import {
	CANVAS_LIMITS,
	CANVAS_NODE_ICON,
	CANVAS_SPEC_VERSION,
	compileCanvasSpec,
	embedCanvasIcons,
	getCanvasValidationIssues,
	type CanvasIconAsset,
	type CanvasShapeElement,
	type CanvasSpec,
} from "../scene";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "../excalidraw";
import { iconRecipeFitIssues, iconRecipeIssues } from "../icon-recipe";

type Elements = CanvasSpec["elements"];

function canvas(elements: Elements, overrides: Partial<CanvasSpec> = {}): CanvasSpec {
	return {
		kind: "canvas",
		version: CANVAS_SPEC_VERSION,
		diagramId: "drawing-test",
		title: "Drawing test",
		width: 600,
		height: 400,
		accentColor: "#111827",
		backgroundColor: "#ffffff",
		elements,
		layers: [],
		layouts: [],
		zOrder: elements.map((element) => element.id),
		...overrides,
	};
}

function node(id: string, overrides: Partial<CanvasShapeElement> = {}): CanvasShapeElement {
	return {
		type: "node",
		id,
		nodeId: id,
		shape: "rectangle",
		x: 0,
		y: 0,
		width: 160,
		height: 80,
		label: id.toUpperCase(),
		...overrides,
	};
}

/** Two nodes a row layout places apart, an arrow between them and a free text. */
const flow = canvas(
	[
		node("a"),
		node("b"),
		{
			type: "arrow",
			id: "a-b",
			edgeId: "a-b",
			sourceNodeId: "a",
			targetNodeId: "b",
			points: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
		},
	],
	{ layouts: [{ type: "row", ids: ["a", "b"], x: 40, y: 120, gap: 200 }] },
);

type FileElement = ReturnType<typeof convertSceneToExcalidraw>["elements"][number];
type File = ReturnType<typeof convertSceneToExcalidraw>;

/** Serialized elements keep every field as unknown; these are the ones the checks read. */
const placed = (element: FileElement) =>
	element as FileElement & {
		x: number;
		y: number;
		width: number;
		points?: readonly (readonly [number, number])[];
		boundElements?: readonly { id: string }[] | null;
	};

describe("canvas in, Excalidraw file out", () => {
	it("compiles layouts and bindings into a file with no validator issues", () => {
		const compiled = compileCanvasSpec(flow);
		const file = convertSceneToExcalidraw(compiled);
		const byId = new Map(file.elements.map((element) => [element.id, element]));
		const [a, b, arrow] = ["a", "b", "a-b"].map((id) => placed(byId.get(id)!));

		expect(validateExcalidrawScene(file).issues).toEqual([]);
		expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(200);
		const points = arrow!.points!;
		const [start, end] = [arrow!.x + points[0]![0], arrow!.x + points.at(-1)![0]];
		// Bound ends stop within Excalidraw's binding gap of the shape they meet.
		expect(start - (a!.x + a!.width)).toSatisfy((gap: number) => gap >= 0 && gap < 10);
		expect(b!.x - end).toSatisfy((gap: number) => gap >= 0 && gap < 10);
	});
});

/** Rule 8: the file validator every family fuzz uses must detect each issue it reports. */
describe("Excalidraw file validator", () => {
	const valid = () => structuredClone(convertSceneToExcalidraw(compileCanvasSpec(flow)));
	const edit = (file: File, id: string, change: (element: FileElement) => FileElement) => ({
		...file,
		elements: file.elements.map((element) => (element.id === id ? change(element) : element)),
	});
	const labelOf = (file: File, containerId: string) =>
		file.elements.find((element) => element.type === "text" && element.containerId === containerId)!
			.id;
	const breakers: Record<string, (file: File) => File> = {
		"empty-scene": (file) => ({ ...file, elements: [] }),
		"missing-image-file": (file) => ({
			...file,
			elements: [
				...file.elements,
				{ ...file.elements[0]!, id: "logo", type: "image", fileId: "absent", boundElements: null },
			],
		}),
		"missing-arrow-binding": (file) =>
			edit(file, "a-b", (arrow) => ({
				...arrow,
				startBinding: { ...(arrow["startBinding"] as object), elementId: "ghost" },
			})),
		"missing-bound-arrow": (file) =>
			edit(file, "a", (shape) => ({
				...shape,
				boundElements: (placed(shape).boundElements ?? []).filter(({ id }) => id !== "a-b"),
			})),
		"arrow-endpoint-off-shape": (file) =>
			edit(file, "a-b", (arrow) => ({ ...arrow, y: placed(arrow).y + 300 })),
		"invalid-elbow-binding": (file) =>
			edit(file, "a-b", (arrow) => ({ ...arrow, elbowed: true, fixedSegments: "none" })),
		"missing-container": (file) =>
			edit(file, labelOf(file, "a"), (text) => ({ ...text, containerId: "ghost" })),
		"text-overflow": (file) => edit(file, labelOf(file, "a"), (text) => ({ ...text, width: 900 })),
		"arrow-segment-through-node": (file) => {
			const a = placed(file.elements.find((element) => element.id === "a")!);
			return {
				...file,
				elements: [
					...file.elements,
					{ ...a, id: "wall", x: a.x + a.width + 80, boundElements: null, groupIds: [] },
				],
			};
		},
		"overlapping-arrow-segment": (file) => {
			const arrow = file.elements.find((element) => element.id === "a-b")!;
			return {
				...file,
				elements: [
					...file.elements,
					{ ...arrow, id: "twin", startBinding: null, endBinding: null, y: arrow.y },
				],
			};
		},
	};

	it("passes the unbroken scene", () => {
		expect(validateExcalidrawScene(valid()).issues).toEqual([]);
	});

	it.each(Object.entries(breakers))("reports %s", (code, breakScene) => {
		const codes = validateExcalidrawScene(breakScene(valid())).issues.map((issue) => issue.code);
		expect(codes).toContain(code);
	});
});

/** Rule 7 and 8: the canvas validator, also the text-fit fuzz oracle, reports each code. */
describe("canvas validator", () => {
	const a = node("a");
	const cases: Record<string, CanvasSpec> = {
		empty_canvas: canvas([]),
		duplicate_element_id: canvas([a, node("a", { nodeId: "a2" })]),
		duplicate_layer_id: canvas([a], {
			layers: [
				{ id: "l", name: "L" },
				{ id: "l", name: "L" },
			],
		}),
		duplicate_z_order_element: canvas([a], { zOrder: ["a", "a"] }),
		missing_z_order_element: canvas([a, node("b")], { zOrder: ["a"] }),
		unknown_z_order_element: canvas([a], { zOrder: ["a", "ghost"] }),
		unknown_layout_target: canvas([a], {
			layouts: [{ type: "row", ids: ["a", "ghost"], x: 0, y: 0, gap: 10 }],
		}),
		invalid_binding: canvas([
			a,
			{
				type: "arrow",
				id: "a-x",
				edgeId: "a-x",
				sourceNodeId: "a",
				targetNodeId: "ghost",
				points: [
					{ x: 0, y: 0 },
					{ x: 1, y: 1 },
				],
			},
		]),
		invalid_composition: canvas([node("a", { frameId: "ghost" })]),
		label_overflow: canvas([
			node("a", { width: 60, height: 30, label: "Quality assurance review" }),
		]),
		invalid_geometry: canvas([node("a", { width: 0 })]),
		invalid_polygon: canvas([
			node("a", {
				shape: "polygon",
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 0 },
				],
			} as unknown as Partial<CanvasShapeElement>),
		]),
		invalid_icon: canvas([node("a", { icon: { slug: "docker", size: 28 } })], { icons: {} }),
		limit_exceeded: canvas([a], { width: CANVAS_LIMITS.maxDimension + 1 }),
	};

	it.each(Object.entries(cases))("reports %s", (code, spec) => {
		expect(getCanvasValidationIssues(spec).map((issue) => issue.code)).toContain(code);
	});
});

describe("icon embedding safety", () => {
	const DOCKER: CanvasIconAsset = {
		name: "Docker",
		svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>',
	};

	it("never resolves prototype members as icon assets", () => {
		const slugs = ["constructor", "__proto__", "toString", "hasOwnProperty"];
		const result = embedCanvasIcons(
			canvas(slugs.map((slug, index) => node(`n${index}`, { icon: { slug, size: 28 } }))),
			() => undefined,
		);
		expect(result.dropped.map(({ reason }) => reason)).toEqual(slugs.map(() => "unavailable"));
		expect(result.scene.icons).toBeUndefined();
		for (const slug of slugs) {
			const issues = getCanvasValidationIssues(
				canvas([node("a", { icon: { slug, size: 28 } })], { icons: {} }),
			);
			expect(issues.map((issue) => issue.code)).toEqual(["invalid_icon"]);
		}
		const own = embedCanvasIcons(
			canvas([node("a", { icon: { slug: "constructor", size: 28 } })]),
			() => DOCKER,
		);
		expect(Object.hasOwn(own.scene.icons ?? {}, "constructor")).toBe(true);
	});

	it("drops an oversized asset and icons past the scene budget", () => {
		const slugs = Array.from({ length: 14 }, (_, index) => `mark-${index}`);
		const result = embedCanvasIcons(
			canvas([
				node("huge", { icon: { slug: "huge", size: 28 } }),
				...slugs.map((slug) => node(slug, { icon: { slug, size: 28 } })),
			]),
			(slug) => ({
				name: slug,
				svg:
					slug === "huge"
						? "x".repeat(CANVAS_NODE_ICON.maxAssetBytes + 1)
						: `<svg>${"x".repeat(CANVAS_NODE_ICON.maxAssetBytes - 11)}</svg>`,
			}),
		);
		expect(result.dropped.map(({ slug, reason }) => [slug, reason])).toEqual([
			["huge", "unavailable"],
			["mark-12", "budget"],
			["mark-13", "budget"],
		]);
		expect(getCanvasValidationIssues(result.scene)).toEqual([]);
	});
});

/** Rule 7: icon recipe validators, which community publishing relies on. */
describe("icon recipe validators", () => {
	it.each([
		[{ parts: [{ kind: "blob" }] }, "recipe.parts[0].kind must be one of"],
		[{ parts: [{ kind: "ellipse", cx: 12, cy: 40, rx: 1, ry: 1 }] }, "must sit on the grid"],
		[
			{ parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 0, ry: 3 }] },
			"must be positive grid lengths",
		],
		[{ parts: [{ kind: "stroke", points: [[1, 1]] }] }, "points must hold 2-48 points"],
		[
			{ parts: [{ kind: "rect", x: 1, y: 1, width: 4, height: 4, stroke: "red" }] },
			"stroke must be",
		],
		[
			{ parts: [{ kind: "rect", x: 1, y: 1, width: 4, height: 4, extra: 1 }] },
			"is not a rect field",
		],
		[
			{ parts: [{ kind: "rect", x: 1, y: 1, width: 4, height: 4, stroke: "none" }] },
			"needs a fill",
		],
		[
			{ parts: [{ kind: "text", cx: 12, cy: 12, text: "far too long", size: 8 }] },
			"1-8 characters",
		],
		[{ parts: [] }, "recipe.parts must hold 1-8 parts."],
		[
			{ parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 1, ry: 1 }], scale: 2 },
			"not a recipe field",
		],
		[null, "recipe must be an object with a parts array."],
	])("reports %j", (recipe, issue) => {
		expect(iconRecipeIssues(recipe)).toEqual([expect.stringContaining(issue)]);
	});

	it("reports a word that would clip past the grid", () => {
		expect(
			iconRecipeFitIssues({
				parts: [{ kind: "text", cx: 12, cy: 10.5, text: "tinyhttp", size: 9 }],
			}),
		).toEqual([expect.stringContaining('"tinyhttp"')]);
		expect(
			iconRecipeFitIssues({ parts: [{ kind: "text", cx: 12, cy: 12, text: "db", size: 8 }] }),
		).toEqual([]);
	});
});
