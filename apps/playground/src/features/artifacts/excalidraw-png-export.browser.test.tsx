import { exportToBlob } from "@excalidraw/excalidraw";
import { deployPipelineLogoFlowchart, embedCanvasIcons } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { describe, expect, it } from "vitest";

import { exportDimensions, exportExcalidrawPngBase64 } from "./excalidraw-png-export";

/** One solid color per logo so the exported PNG proves which marks painted. */
const LOGO_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
	cloudflare: [244, 129, 32],
	docker: [36, 150, 237],
	github: [190, 30, 160],
	vitest: [114, 159, 27],
};

function logoScene(withFiles: boolean) {
	const excalidraw = convertSceneToExcalidraw(
		embedCanvasIcons(renderIntermediateDiagram(deployPipelineLogoFlowchart), (slug) => {
			const color = LOGO_COLORS[slug];
			return color
				? {
						name: slug,
						svg: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="rgb(${color.join(",")})"/></svg>`,
					}
				: undefined;
		}).scene,
	);
	return withFiles ? excalidraw : { ...excalidraw, files: {} };
}

async function colorCounts(base64: string) {
	const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
	const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Missing 2D context.");
	context.drawImage(bitmap, 0, 0);
	const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
	const counts = Object.fromEntries(Object.keys(LOGO_COLORS).map((slug) => [slug, 0]));
	for (let offset = 0; offset < data.length; offset += 4) {
		for (const [slug, [red, green, blue]] of Object.entries(LOGO_COLORS)) {
			if (
				Math.abs((data[offset] ?? 0) - red) <= 6 &&
				Math.abs((data[offset + 1] ?? 0) - green) <= 6 &&
				Math.abs((data[offset + 2] ?? 0) - blue) <= 6
			) {
				counts[slug] = (counts[slug] ?? 0) + 1;
			}
		}
	}
	return counts;
}

const options = { backgroundColor: "#fffdf8", padding: 20, scale: 2 };

describe("Browser Rendering PNG export harness", () => {
	it("paints every node logo into the exported PNG", async () => {
		const counts = await colorCounts(
			await exportExcalidrawPngBase64(exportToBlob, logoScene(true), options),
		);
		// Logos are solid squares at 2x scale: Docker 28px, GitHub and
		// Cloudflare 24px, Vitest 20px, less antialiased edges.
		const sizes: Record<string, number> = {
			cloudflare: 24,
			docker: 28,
			github: 24,
			vitest: 20,
		};
		for (const [slug, size] of Object.entries(sizes)) {
			expect(counts[slug], slug).toBeGreaterThan((size * 2 - 2) ** 2);
			expect(counts[slug], slug).toBeLessThanOrEqual((size * 2) ** 2);
		}
	});

	it("paints no logo when the drawing carries no files", async () => {
		const counts = await colorCounts(
			await exportExcalidrawPngBase64(exportToBlob, logoScene(false), options),
		);
		expect(Object.values(counts).every((count) => count === 0)).toBe(true);
	});

	it("caps the export scale at the browser canvas limits", () => {
		expect(exportDimensions(800, 600, 2)).toEqual({
			width: 1600,
			height: 1200,
			scale: 2,
		});
		expect(exportDimensions(12_000, 1_000, 2).width).toBe(16_384);
		const huge = exportDimensions(10_000, 10_000, 2);
		expect(huge.width * huge.height).toBeLessThanOrEqual(64_000_000);
	});
});
