import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import sharp from "sharp";

import { PACK_PREVIEW_GRID, packPreviewSvg } from "../src/lib/pack-preview.js";

const require = createRequire(import.meta.url);
const fontDirectory = resolve(import.meta.dirname, "../public/fonts/Excalifont");

let ready: Promise<Uint8Array[]> | undefined;
function fonts(): Promise<Uint8Array[]> {
	ready ??= (async () => {
		await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
		const files = (await readdir(fontDirectory)).filter((file) => file.endsWith(".woff2")).sort();
		return Promise.all(
			files.map(async (file) => new Uint8Array(await readFile(resolve(fontDirectory, file)))),
		);
	})();
	return ready;
}

/** The pack's preview JPEG, as Excalidraw's "Publish library" dialog makes one. */
export async function packPreviewImage(recipes: readonly IconRecipe[]): Promise<Uint8Array> {
	const rasterizer = new Resvg(packPreviewSvg(recipes), {
		font: { defaultFontFamily: "Excalifont", fontBuffers: await fonts() },
		shapeRendering: 2,
		textRendering: 2,
	});
	try {
		const rendered = rasterizer.render();
		try {
			const { maxSide, quality } = PACK_PREVIEW_GRID;
			return new Uint8Array(
				await sharp(rendered.asPng())
					.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
					.flatten({ background: "#ffffff" })
					.jpeg({ quality })
					.toBuffer(),
			);
		} finally {
			rendered.free();
		}
	} finally {
		rasterizer.free();
	}
}
