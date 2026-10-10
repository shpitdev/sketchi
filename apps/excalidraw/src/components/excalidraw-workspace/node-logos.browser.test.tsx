import { loadFromBlob, MIME_TYPES } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { deployPipelineLogoFlowchart, embedCanvasIcons } from "@sketchi/diagram-core";
import {
	convertSceneToExcalidraw,
	createExcalidrawFile,
	type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import "@sketchi/diagram-ui/styles.css";
import "../../styles/app.css";

afterEach(cleanup);

/** One solid color per logo so a canvas pixel proves which mark painted. */
const LOGO_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
	cloudflare: [244, 129, 32],
	docker: [36, 150, 237],
	github: [24, 23, 23],
	vitest: [114, 159, 27],
};

function solidLogo([red, green, blue]: readonly [number, number, number]) {
	// Normalized like catalog assets: an intrinsic size matching the viewBox.
	return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="rgb(${red},${green},${blue})"/></svg>`;
}

function logoScene(): ExcalidrawScene {
	return convertSceneToExcalidraw(
		embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) => {
			const color = LOGO_COLORS[slug];
			return color ? { name: slug, svg: solidLogo(color) } : undefined;
		}).scene,
	);
}

async function renderCanvas(scene: ExcalidrawScene) {
	await page.viewport(1280, 960);
	let editorApi: ExcalidrawImperativeAPI | null = null;
	const view = render(
		<div style={{ height: 960, width: 1280 }}>
			<ExcalidrawSceneCanvas
				onApiChange={(api) => {
					editorApi = api;
				}}
				scene={scene}
				title="Deploy pipeline with node logos"
				viewModeEnabled
			/>
		</div>,
	);
	const api = await waitFor(
		() => {
			if (!editorApi) throw new Error("Excalidraw API is not ready.");
			return editorApi;
		},
		{ timeout: 20_000 },
	);
	return { api, view };
}

/** The static canvas pixel under a scene coordinate. */
function pixelAt(
	container: HTMLElement,
	api: ExcalidrawImperativeAPI,
	sceneX: number,
	sceneY: number,
): readonly [number, number, number] {
	const canvas = container.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
	const context = canvas?.getContext("2d");
	if (!canvas || !context) throw new Error("Missing static canvas.");
	const { scrollX, scrollY, zoom } = api.getAppState();
	const scale = canvas.width / canvas.getBoundingClientRect().width;
	const x = Math.round((sceneX + scrollX) * zoom.value * scale);
	const y = Math.round((sceneY + scrollY) * zoom.value * scale);
	const [red = 0, green = 0, blue = 0] = context.getImageData(x, y, 1, 1).data;
	return [red, green, blue];
}

function imageCenters(scene: ExcalidrawScene) {
	return scene.elements
		.filter((element) => element.type === "image")
		.map((element) => ({
			slug: String((element.customData as { sketchiNodeIcon?: string }).sketchiNodeIcon),
			x: Number(element.x) + Number(element.width) / 2,
			y: Number(element.y) + Number(element.height) / 2,
		}));
}

async function expectLogosPainted(
	container: HTMLElement,
	api: ExcalidrawImperativeAPI,
	scene: ExcalidrawScene,
) {
	const centers = imageCenters(scene);
	expect(centers.map((center) => center.slug).sort()).toEqual(Object.keys(LOGO_COLORS).sort());
	await waitFor(
		() => {
			for (const center of centers) {
				const [red, green, blue] = pixelAt(container, api, center.x, center.y);
				const expected = LOGO_COLORS[center.slug] ?? [0, 0, 0];
				expect(Math.abs(red - expected[0]), center.slug).toBeLessThan(12);
				expect(Math.abs(green - expected[1]), center.slug).toBeLessThan(12);
				expect(Math.abs(blue - expected[2]), center.slug).toBeLessThan(12);
			}
		},
		{ timeout: 10_000 },
	);
}

describe("node logos in the real Excalidraw editor", () => {
	it("paint inside their nodes on first load", async () => {
		const scene = logoScene();
		const { api, view } = await renderCanvas(scene);

		expect(Object.keys(api.getFiles()).sort()).toEqual(Object.keys(scene.files ?? {}).sort());
		await expectLogosPainted(view.container, api, scene);
	});

	it("survive a .excalidraw export and import", async () => {
		const exported = JSON.stringify(createExcalidrawFile(logoScene()));
		const restored = await loadFromBlob(
			new Blob([exported], { type: MIME_TYPES.excalidraw }),
			null,
			null,
		);
		const images = restored.elements.filter((element) => element.type === "image");

		expect(images).toHaveLength(4);
		for (const image of images) {
			expect(image).toMatchObject({ status: "saved", scale: [1, 1] });
			expect("fileId" in image && image.fileId ? restored.files[image.fileId] : null).toMatchObject(
				{ mimeType: "image/svg+xml" },
			);
		}

		const reimported: ExcalidrawScene = {
			appState: { viewBackgroundColor: restored.appState.viewBackgroundColor },
			elements: restored.elements,
			files: restored.files,
		};
		const { api, view } = await renderCanvas(reimported);
		await expectLogosPainted(view.container, api, reimported);
	});
});
