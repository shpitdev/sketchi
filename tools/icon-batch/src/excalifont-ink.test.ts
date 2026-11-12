import { Resvg } from "@resvg/resvg-wasm";
import { EXCALIFONT_GLYPHS, excalifontInkBox } from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { excalifontOptions, initializeResvg } from "./excalidraw-export.js";

const SIZE = 1000;

/** The ink resvg paints for a word centered on (0, baseline), in ems. */
function painted(text: string) {
	const escaped = text.replace(/[<>&]/gu, (character) => `&#${character.codePointAt(0)};`);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE * 12}" height="${SIZE * 3}"><text x="${SIZE * 6}" y="${SIZE * 2}" text-anchor="middle" font-family="Excalifont" font-size="${SIZE}" xml:space="preserve">${escaped}</text></svg>`;
	const rasterizer = new Resvg(svg, excalifontOptions());
	try {
		const box = rasterizer.getBBox()!;
		return {
			left: (box.x - SIZE * 6) / SIZE,
			right: (box.x + box.width - SIZE * 6) / SIZE,
			top: (box.y - SIZE * 2) / SIZE,
			bottom: (box.y + box.height - SIZE * 2) / SIZE,
		};
	} finally {
		rasterizer.free();
	}
}

describe("Excalifont glyph table", () => {
	it("matches the ink the font Excalidraw ships paints, word by word", async () => {
		await initializeResvg();
		const baseline = (box: ReturnType<typeof excalifontInkBox>) => ({
			...box,
			top: box.top - 0.256,
			bottom: box.bottom - 0.256,
		});
		for (const word of [
			"CACHE",
			"Aurora",
			"PgSQL",
			"RDS Proxy",
			"MariaDB",
			"HTTP/2",
			"{less}",
			"$_",
		]) {
			const actual = painted(word);
			const table = baseline(excalifontInkBox(word, 1));
			// Contextual forms move a word's ends by at most a few hundredths of an em.
			for (const edge of ["left", "right", "top", "bottom"] as const) {
				expect(Math.abs(table[edge] - actual[edge]), `${word} ${edge}`).toBeLessThan(0.03);
			}
		}
	});

	it("covers every printable ASCII glyph", () => {
		for (let code = 32; code < 127; code++) {
			expect(EXCALIFONT_GLYPHS[String.fromCharCode(code)], String(code)).toBeDefined();
		}
	});
});
