import { describe, expect, it } from "vitest";

import {
	type Camera,
	cameraBetween,
	cameraBetweenToolbars,
	imageCamera,
	type Insets,
	toolbarInsets,
} from "./home-diagram-camera";
import { HOME_DIAGRAM } from "./home-diagram-data";

const { origin, padding, width, height } = HOME_DIAGRAM;
const drawing = {
	left: origin.x + padding,
	top: origin.y + padding,
	right: origin.x + width - padding,
	bottom: origin.y + height - padding,
};

const toScreen = (camera: Camera, x: number, y: number) => ({
	x: (x + camera.scrollX) * camera.zoom,
	y: (y + camera.scrollY) * camera.zoom,
});

/** Excalidraw's compact toolbars as measured in a laptop (514 × 705) and a phone (356 × 488) box. */
const cases: { name: string; size: [number, number]; insets: Insets }[] = [
	{ name: "laptop", size: [514, 705], insets: { top: 60, right: 37, bottom: 62, left: 0 } },
	{ name: "phone", size: [356, 488], insets: { top: 60, right: 37, bottom: 62, left: 0 } },
];

describe("imageCamera", () => {
	it("draws the scene where Excalidraw's export put it", () => {
		const camera = imageCamera(width);

		expect(toScreen(camera, drawing.left, drawing.top)).toEqual({ x: padding, y: padding });
		expect(toScreen(camera, drawing.right, drawing.bottom)).toEqual({
			x: width - padding,
			y: height - padding,
		});
	});
});

describe("cameraBetweenToolbars", () => {
	for (const { name, size, insets } of cases) {
		it(`keeps every part of the drawing clear of the toolbars on a ${name}`, () => {
			const [boxWidth, boxHeight] = size;
			const camera = cameraBetweenToolbars(boxWidth, boxHeight, insets);
			const topLeft = toScreen(camera, drawing.left, drawing.top);
			const bottomRight = toScreen(camera, drawing.right, drawing.bottom);

			expect(topLeft.x).toBeGreaterThanOrEqual(insets.left);
			expect(topLeft.y).toBeGreaterThanOrEqual(insets.top);
			expect(bottomRight.x).toBeLessThanOrEqual(boxWidth - insets.right);
			expect(bottomRight.y).toBeLessThanOrEqual(boxHeight - insets.bottom);
			// It settles the drawing, never zooms in past the image.
			expect(camera.zoom).toBeLessThanOrEqual(imageCamera(boxWidth).zoom);
			expect(camera.zoom).toBeGreaterThan(imageCamera(boxWidth).zoom * 0.7);
		});
	}
});

describe("cameraBetween", () => {
	it("starts at one camera and ends at the other", () => {
		const from = imageCamera(width);
		const to = cameraBetweenToolbars(514, 705, cases[0]!.insets);
		const close = (camera: Camera) =>
			[camera.scrollX, camera.scrollY, camera.zoom].map((n) => Math.round(n * 1e6));

		expect(close(cameraBetween(from, to, 0))).toEqual(close(from));
		expect(close(cameraBetween(from, to, 1))).toEqual(close(to));
	});
});

describe("toolbarInsets", () => {
	const place = (element: Element, left: number, top: number, w: number, h: number) => {
		element.getBoundingClientRect = () => new DOMRect(left, top, w, h);
		return element;
	};

	it("reads the top tools, the bottom bar and the side tools from Excalidraw's layout", () => {
		const frame = place(document.createElement("div"), 100, 200, 514, 705) as HTMLElement;
		const tools = place(document.createElement("div"), 155, 216, 405, 44);
		const bottom = place(document.createElement("div"), 114, 843, 486, 48);
		const side = place(document.createElement("div"), 577, 280, 37, 102);
		tools.className = "App-toolbar";
		bottom.className = "App-toolbar";
		side.className = "mobile-misc-tools-container";
		frame.append(tools, bottom, side);

		expect(toolbarInsets(frame)).toEqual({ top: 60, right: 37, bottom: 62, left: 0 });
	});
});
