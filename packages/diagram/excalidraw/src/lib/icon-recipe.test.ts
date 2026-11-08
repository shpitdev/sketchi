import { describe, expect, it } from "vitest";

import {
	canvasGroupIconBox,
	canvasNodeIconBox,
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	type CanvasShapeElement,
	type IconRecipe,
} from "@sketchi/diagram-core";
import {
	renderIntermediateDiagram,
	type NodeSceneElement,
	type SceneElement,
} from "@sketchi/diagram-renderer";

import {
	convertSceneToExcalidraw,
	validateExcalidrawScene,
	type ExcalidrawElement,
} from "./convert";
import { iconRecipeElements } from "./icon-recipe";

const RECIPE: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 10, ry: 10, fill: "#1e1e1e" },
		{ kind: "rect", x: 4, y: 4, width: 16, height: 16, rounded: true },
		{
			kind: "stroke",
			smooth: true,
			closed: true,
			stroke: "paper",
			points: [
				[6, 6],
				[18, 6],
				[12, 18],
			],
		},
		{
			kind: "arrow",
			pen: 2,
			stroke: "#ff9900",
			points: [
				[3, 15],
				[20, 15],
			],
		},
		{ kind: "text", cx: 12, cy: 9, text: "aws", size: 10, color: "ink" },
	],
};

const draw = (size: number, roughness?: number) =>
	iconRecipeElements(RECIPE, {
		box: { x: 100, y: 50, size },
		id: "node-a-icon",
		groupIds: ["node:a:logo"],
		ink: "#123456",
		paper: "#fdfcf8",
		...(roughness === undefined ? {} : { roughness }),
	});

describe("drawing icon recipes", () => {
	it("places each part in the box as one grouped Excalidraw element", () => {
		const parts = draw(24);
		expect(parts.map((part) => [part.id, part.type])).toEqual([
			["node-a-icon-0", "ellipse"],
			["node-a-icon-1", "rectangle"],
			["node-a-icon-2", "line"],
			["node-a-icon-3", "arrow"],
			["node-a-icon-4", "text"],
		]);
		for (const part of parts) expect(part.groupIds).toEqual(["node-a-icon", "node:a:logo"]);
		expect(parts[0]).toMatchObject({ x: 102, y: 52, width: 20, height: 20 });
		expect(parts[1]).toMatchObject({ roundness: { type: 3 }, strokeColor: "#123456" });
		// Closed strokes return to their start; points are relative to it.
		expect(parts[2]).toMatchObject({
			x: 106,
			y: 56,
			points: [
				[0, 0],
				[12, 0],
				[6, 12],
				[0, 0],
			],
			roundness: { type: 2 },
			strokeColor: "#fdfcf8",
		});
		expect(parts[3]).toMatchObject({ endArrowhead: "arrow", strokeWidth: 4 });
		expect(parts[4]).toMatchObject({ strokeColor: "#123456", fontFamily: 5, textAlign: "center" });
	});

	it("draws with the scene's bold pen at any size and keeps small fills clean", () => {
		const small = draw(28);
		expect(small.map((part) => part.roughness)).toEqual([0, 1, 1, 1, 0]);
		expect(small.map((part) => part.strokeWidth)).toEqual([2, 2, 2, 4, 1]);
		const large = draw(112, 2);
		expect(large.map((part) => part.strokeWidth)).toEqual([2, 2, 2, 4, 1]);
		expect(large.map((part) => part.roughness)).toEqual([2, 2, 2, 2, 0]);
	});

	it("is deterministic", () => {
		expect(JSON.stringify(draw(28))).toBe(JSON.stringify(draw(28)));
		expect(new Set(draw(28).map((part) => part.seed)).size).toBe(RECIPE.parts.length);
	});
});

describe("hand-drawn node logos in Excalidraw output", () => {
	const scene = (exactIcons = false) =>
		embedCanvasIcons(
			renderIntermediateDiagram(deployPipelineLogoFlowchart),
			(slug) => ({
				name: slug,
				recipe: RECIPE,
				svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"/>`,
			}),
			{ exactIcons },
		).scene;

	const parts = (elements: readonly ExcalidrawElement[], iconId: string) =>
		elements.filter((element) => element.id.startsWith(`${iconId}-`));

	it("draws each logo as native parts inside the node's group, with no image or file", () => {
		const rendered = scene();
		const excalidraw = convertSceneToExcalidraw(rendered);
		expect(excalidraw.elements.some((element) => element.type === "image")).toBe(false);
		expect(excalidraw.files ?? {}).toEqual({});

		const logoNodes = rendered.elements.filter(
			(element): element is CanvasShapeElement =>
				element.type === "node" && element.icon !== undefined,
		);
		expect(logoNodes.length).toBeGreaterThan(0);
		const ids = excalidraw.elements.map((element) => element.id);
		for (const node of logoNodes) {
			const drawn = parts(excalidraw.elements, `node-${node.nodeId}-icon`);
			const box = canvasNodeIconBox(node)!;
			expect(drawn).toHaveLength(RECIPE.parts.length);
			expect(drawn[0]).toMatchObject({
				x: expect.closeTo(box.x + (2 * box.width) / 24, 2),
				width: expect.closeTo((20 * box.width) / 24, 2),
			});
			for (const part of drawn) {
				expect(part.groupIds).toEqual([`node-${node.nodeId}-icon`, `node:${node.nodeId}:logo`]);
				expect(part.customData).toMatchObject({ sketchiNodeIcon: node.icon?.slug });
			}
			// Parts layer between the node's shape and its label.
			const shape = ids.indexOf(`node:${node.nodeId}`);
			const label = ids.indexOf(`label:${node.nodeId}`);
			for (const part of drawn) {
				expect(ids.indexOf(part.id)).toBeGreaterThan(shape);
				expect(ids.indexOf(part.id)).toBeLessThan(label);
			}
		}
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it("embeds the exact SVG as one image when the diagram asks for exact logos", () => {
		const excalidraw = convertSceneToExcalidraw(scene(true));
		expect(excalidraw.elements.some((element) => element.id.startsWith("node-push-icon-"))).toBe(
			false,
		);
		expect(excalidraw.elements.find((element) => element.id === "node-push-icon")).toMatchObject({
			type: "image",
		});
		expect(Object.keys(excalidraw.files ?? {})).not.toHaveLength(0);
	});

	const canvasScene = (elements: SceneElement[], recipe = true) =>
		convertSceneToExcalidraw(
			embedCanvasIcons(
				{
					...renderIntermediateDiagram(deployPipelineLogoFlowchart),
					elements,
					zOrder: elements.map((element) => element.id),
				},
				() => ({
					name: "Docker",
					...(recipe
						? { recipe: RECIPE }
						: {
								svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"/>`,
							}),
				}),
			).scene,
		);
	const logoNode = (overrides: Partial<NodeSceneElement> = {}): NodeSceneElement => ({
		type: "node",
		id: "n",
		nodeId: "n",
		shape: "rectangle",
		x: 40,
		y: 40,
		width: 184,
		height: 96,
		label: "Build",
		icon: { slug: "docker", size: 28 },
		...overrides,
	});

	it("never gives a part the id of an element the scene already has", () => {
		const authored = {
			type: "text",
			id: "n-icon-0",
			x: 300,
			y: 40,
			text: "Note",
			fontSize: 16,
		} as const;
		const excalidraw = convertSceneToExcalidraw(
			embedCanvasIcons(
				{
					...renderIntermediateDiagram(deployPipelineLogoFlowchart),
					elements: [logoNode(), authored],
					zOrder: ["n", "n-icon-0"],
				},
				() => ({ name: "Docker", recipe: RECIPE }),
			).scene,
		);
		const ids = excalidraw.elements.map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		const parts = excalidraw.elements.filter((element) =>
			Boolean((element.customData as Record<string, unknown> | undefined)?.["sketchiIconPart"]),
		);
		expect(parts).toHaveLength(RECIPE.parts.length);
		expect(parts.map((part) => part.id)).not.toContain("n-icon-0");
		expect(excalidraw.elements.find((element) => element.id === "n-icon-0")).toMatchObject({
			type: "text",
		});
	});

	it("keeps a node's hand-drawn logo in the node's frame, as its SVG logo is", () => {
		const frame = {
			type: "frame",
			id: "f",
			name: "Build",
			x: 0,
			y: 0,
			width: 320,
			height: 200,
		} as const;
		for (const recipe of [true, false]) {
			const excalidraw = canvasScene([frame, logoNode({ frameId: "f" })], recipe);
			const logo = excalidraw.elements.filter((element) => element.id.startsWith("n-icon"));
			expect(logo.length).toBeGreaterThan(0);
			for (const part of logo) expect(part.frameId).toBe("f");
		}
	});

	it("draws a group's logo before its name inside the frame", () => {
		const frame = {
			type: "frame",
			id: "zone",
			name: "Vercel",
			icon: { slug: "vercel", size: 20 },
			x: 0,
			y: 0,
			width: 300,
			height: 200,
		} as const;
		const excalidraw = convertSceneToExcalidraw(
			embedCanvasIcons(
				{
					...renderIntermediateDiagram(deployPipelineLogoFlowchart),
					elements: [frame],
					zOrder: ["zone"],
				},
				() => ({ name: "Vercel", recipe: RECIPE }),
			).scene,
		);
		const drawn = parts(excalidraw.elements, "zone-icon");
		const box = canvasGroupIconBox(frame)!;
		expect(drawn).toHaveLength(RECIPE.parts.length);
		expect(drawn[0]).toMatchObject({
			frameId: "zone",
			groupIds: ["zone-icon"],
			x: expect.closeTo(box.x + (2 * box.width) / 24, 2),
		});
	});
});
