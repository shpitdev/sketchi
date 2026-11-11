import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { initIconColorRenderer, measureIconColor } from "./icon-color-render.js";
import { getIconSourceFile, iconManifest } from "./catalog.js";
import { iconColor } from "./color-mode.js";
import type { MarkPixels } from "./mark-features.js";

const svgRoot = resolve(import.meta.dirname, "../svg");

type Rgb = readonly [number, number, number];

/** A transparent canvas painted where `paint` returns a color. */
function canvas(paint: (x: number, y: number) => Rgb | undefined, size = 32): MarkPixels {
	const data = new Uint8ClampedArray(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const color = paint(x, y);
			if (color) data.set([...color, 255], (y * size + x) * 4);
		}
	}
	return { data, width: size, height: size };
}

const inside = (x: number, y: number, from: number, to: number) =>
	x >= from && x < to && y >= from && y < to;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

describe("icon color classification", () => {
	it("inverts a black mark on dark surfaces and a white one on light surfaces", () => {
		expect(iconColor(canvas((x, y) => (inside(x, y, 8, 24) ? BLACK : undefined)))).toEqual({
			colorMode: "mono-dark",
			onDark: "invert",
		});
		expect(iconColor(canvas((x, y) => (inside(x, y, 8, 24) ? WHITE : undefined)))).toEqual({
			colorMode: "mono-light",
			onLight: "invert",
		});
	});

	it("leaves a mid gray that reads on both surfaces alone", () => {
		const gray: Rgb = [143, 153, 168];
		expect(iconColor(canvas((x, y) => (inside(x, y, 8, 24) ? gray : undefined)))).toEqual({
			colorMode: "mono-light",
		});
	});

	it("plates a multicolor mark that is mostly dark ink on dark surfaces, never inverting it", () => {
		const orange: Rgb = [255, 153, 0];
		expect(
			iconColor(canvas((x, y) => (inside(x, y, 4, 28) ? (y < 20 ? BLACK : orange) : undefined))),
		).toEqual({ colorMode: "multicolor", onDark: "plate" });
	});

	it("judges what sits on a backdrop tile, and enclosed knockouts read on any surface", () => {
		const blue: Rgb = [66, 133, 244];
		// A black app tile with a white glyph: the tile vanishes on dark, the glyph reads.
		expect(iconColor(canvas((x, y) => (inside(x, y, 12, 20) ? WHITE : BLACK)))).toEqual({
			colorMode: "mono-dark",
		});
		// A blue disc with a white knockout reads on white.
		expect(
			iconColor(
				canvas((x, y) => {
					const distance = Math.hypot(x - 15.5, y - 15.5);
					return distance < 6 ? WHITE : distance < 14 ? blue : undefined;
				}),
			),
		).toEqual({ colorMode: "multicolor" });
	});

	it("returns nothing for a blank canvas", () => {
		expect(iconColor(canvas(() => undefined))).toBeUndefined();
	});
});

describe("catalog icon colors", () => {
	beforeAll(() => initIconColorRenderer());

	it("match every current source", { timeout: 30_000 }, () => {
		const stale = iconManifest.icons.flatMap((icon) => {
			const file = getIconSourceFile(icon.slug);
			if (!file) return [`${icon.slug}: no source`];
			const measured = measureIconColor(readFileSync(resolve(svgRoot, file), "utf8"), icon.slug);
			const { colorMode, onDark, onLight } = icon;
			return JSON.stringify(measured) ===
				JSON.stringify({
					colorMode,
					...(onDark ? { onDark } : {}),
					...(onLight ? { onLight } : {}),
				})
				? []
				: [icon.slug];
		});
		// Regenerate with `pnpm nx generate-catalog icon-catalog`.
		expect(stale).toEqual([]);
	});

	it("classify well-known marks", () => {
		const color = (slug: string) => {
			const icon = iconManifest.icons.find((candidate) => candidate.slug === slug);
			return icon && { colorMode: icon.colorMode, onDark: icon.onDark, onLight: icon.onLight };
		};
		expect(color("vercel")).toMatchObject({ colorMode: "mono-dark", onDark: "invert" });
		expect(color("aws")).toMatchObject({ colorMode: "multicolor", onDark: "plate" });
		expect(color("googlecloud")).toEqual({ colorMode: "multicolor" });
		expect(color("react")).toEqual({ colorMode: "multicolor" });
		expect(color("kwaipilot")).toMatchObject({ colorMode: "multicolor", onLight: "plate" });
	});
});
