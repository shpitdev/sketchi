import { describe, expect, it } from "vitest";

import {
	canvasBoundTextBox,
	canvasBoundTextInset,
	canvasNodeIconBox,
	deployPipelineLogoFlowchart,
	embedCanvasIcons,
	type CanvasShapeElement,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	validateExcalidrawScene,
	type ExcalidrawElement,
} from "./convert";

const svgFor = (slug: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>${slug} ✓</title></svg>`;

function logoScene(available: (slug: string) => boolean = () => true) {
	return embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) =>
		available(slug) ? { name: slug, svg: svgFor(slug) } : undefined,
	).scene;
}

function byId(elements: readonly ExcalidrawElement[], id: string) {
	const element = elements.find((entry) => entry.id === id);
	if (!element) throw new Error(`Missing element ${id}.`);
	return element;
}

function decodeDataUrl(dataURL: string): string {
	const base64 = dataURL.replace(/^data:image\/svg\+xml;base64,/u, "");
	return new TextDecoder().decode(
		Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
	);
}

describe("node logos in Excalidraw output", () => {
	it("emits one image per logo node backed by an SVG file", () => {
		const scene = logoScene();
		const excalidraw = convertSceneToExcalidraw(scene);
		const images = excalidraw.elements.filter((element) => element.type === "image");
		const logoNodes = scene.elements.filter(
			(element): element is CanvasShapeElement =>
				element.type === "node" && element.icon !== undefined,
		);

		expect(images.map((image) => image.id)).toEqual(
			logoNodes.map((node) => `node-${node.nodeId}-icon`),
		);
		for (const node of logoNodes) {
			const image = byId(excalidraw.elements, `node-${node.nodeId}-icon`);
			const box = canvasNodeIconBox(node);
			const file = excalidraw.files?.[String(image.fileId)];

			expect(image).toMatchObject({
				...box,
				status: "saved",
				scale: [1, 1],
				crop: null,
				customData: { sketchiNodeIcon: node.icon?.slug },
			});
			expect(file).toMatchObject({
				id: image.fileId,
				mimeType: "image/svg+xml",
			});
			expect(decodeDataUrl(String(file?.dataURL))).toBe(svgFor(node.icon?.slug ?? ""));
		}
		expect(validateExcalidrawScene(excalidraw)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("groups each logo with its shape and label and layers it between them", () => {
		const excalidraw = convertSceneToExcalidraw(logoScene());
		const ids = excalidraw.elements.map((element) => element.id);

		for (const nodeId of ["push", "build", "tests", "ship"]) {
			const shape = byId(excalidraw.elements, `node:${nodeId}`);
			const image = byId(excalidraw.elements, `node-${nodeId}-icon`);
			const label = byId(excalidraw.elements, `label:${nodeId}`);
			const group = `node:${nodeId}:logo`;

			expect(shape.groupIds).toEqual([group]);
			expect(image.groupIds).toEqual([group]);
			expect(label.groupIds).toEqual([group]);
			expect(ids.indexOf(image.id)).toBe(ids.indexOf(shape.id) + 1);
			expect(String(image.index) > String(shape.index)).toBe(true);
			expect(String(label.index) > String(image.index)).toBe(true);
		}
		expect(byId(excalidraw.elements, "node:fix").groupIds).toEqual([]);
		expect(excalidraw.elements.some((element) => element.id === "node-fix-icon")).toBe(false);
	});

	it("bottom-aligns logo labels where Excalidraw's own layout puts them", () => {
		const scene = logoScene();
		const excalidraw = convertSceneToExcalidraw(scene);

		for (const node of scene.elements.filter(
			(element): element is CanvasShapeElement =>
				element.type === "node" && element.icon !== undefined,
		)) {
			const label = byId(excalidraw.elements, `label:${node.nodeId}`);
			const image = byId(excalidraw.elements, `node-${node.nodeId}-icon`);
			const bottom = node.y + canvasBoundTextInset(node).y + canvasBoundTextBox(node).height;

			expect(label.verticalAlign).toBe("bottom");
			expect(Number(label.y) + Number(label.height)).toBeCloseTo(bottom);
			expect(Number(label.y)).toBeGreaterThan(Number(image.y) + Number(image.height));
		}
	});

	it("shares one file per artwork and writes files into the drawing file", () => {
		const scene = logoScene();
		const excalidraw = convertSceneToExcalidraw({
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" && element.icon
					? { ...element, icon: { ...element.icon, slug: "github" } }
					: element,
			),
		});

		expect(Object.keys(excalidraw.files ?? {})).toHaveLength(1);
		expect(createExcalidrawFile(excalidraw).files).toBe(excalidraw.files);
		expect(convertSceneToExcalidraw(scene)).toEqual(convertSceneToExcalidraw(scene));
	});

	it("ignores prototype members of the icons map", () => {
		const scene = logoScene();
		for (const slug of ["constructor", "toString", "__proto__"]) {
			const excalidraw = convertSceneToExcalidraw({
				...scene,
				elements: scene.elements.map((element) =>
					element.type === "node" && element.nodeId === "build"
						? { ...element, icon: { slug, size: 28 } }
						: element,
				),
			});
			// The other three logos remain; the prototype-named slug paints nothing.
			expect(
				excalidraw.elements.filter((element) => element.type === "image"),
				slug,
			).toHaveLength(3);
			expect(validateExcalidrawScene(excalidraw).ok, slug).toBe(true);
		}
	});

	it("flags images whose file id names a prototype member", () => {
		const excalidraw = convertSceneToExcalidraw(logoScene());
		const image = excalidraw.elements.find((element) => element.type === "image");
		if (!image) throw new Error("Missing logo image.");
		for (const fileId of ["constructor", "toString", "__proto__"]) {
			const issues = validateExcalidrawScene({
				...excalidraw,
				elements: excalidraw.elements.map((element) =>
					element === image ? { ...element, fileId } : element,
				),
			}).issues;
			expect(issues, fileId).toEqual([
				expect.objectContaining({
					code: "missing-image-file",
					elementId: image.id,
				}),
			]);
		}
	});

	it("skips logos without an embedded asset and flags images without files", () => {
		const scene = logoScene((slug) => slug !== "docker");
		const excalidraw = convertSceneToExcalidraw({
			...scene,
			icons: { ...scene.icons },
			elements: scene.elements.map((element) =>
				element.type === "node" && element.nodeId === "build"
					? { ...element, icon: { slug: "docker", size: 28 } }
					: element,
			),
		});

		expect(excalidraw.elements.some((element) => element.id === "node-build-icon")).toBe(false);
		expect(byId(excalidraw.elements, "node:build").groupIds).toEqual([]);
		expect(validateExcalidrawScene({ ...excalidraw, files: {} }).issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-image-file",
					elementId: "node-push-icon",
				}),
			]),
		);
	});
});
