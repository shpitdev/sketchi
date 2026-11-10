import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { type IconColor, iconColor } from "./color-mode.js";

// Build and test time only: the package build leaves this file out, so the
// browser entry never pulls in the renderer.

/** Marks are measured at this longest side: enough for thin strokes to count, fast for the whole catalog. */
export const ICON_COLOR_RENDER_SIZE = 128;

let initialized = false;

export async function initIconColorRenderer(): Promise<void> {
	if (initialized) return;
	initialized = true;
	await initWasm(
		await readFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")),
	);
}

/** Render an SVG on a transparent canvas and classify it. Call initIconColorRenderer first. */
export function measureIconColor(svg: string, name: string): IconColor {
	const rendered = new Resvg(svg, {
		fitTo: { mode: "width", value: ICON_COLOR_RENDER_SIZE },
	}).render();
	try {
		const color = iconColor({
			data: rendered.pixels,
			width: rendered.width,
			height: rendered.height,
		});
		if (!color) throw new Error(`Icon ${name} draws nothing opaque.`);
		return color;
	} finally {
		rendered.free();
	}
}
