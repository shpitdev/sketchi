import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getIconSourceFile, nodeLogoIcons } from "./catalog.js";
import { lookAlikeMarks, lookAlikeSourceHash, rankLookAlikes } from "./look-alikes.js";
import { inkBox, markDistance, markFeatures, type MarkPixels } from "./mark-features.js";

const svgRoot = resolve(import.meta.dirname, "../svg");

function canvas(
	width: number,
	height: number,
	paint: (x: number, y: number) => readonly number[] | undefined,
): MarkPixels {
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const color = paint(x, y);
			if (color) data.set([...color, 255], (y * width + x) * 4);
		}
	}
	return { data, width, height };
}

describe("mark features", () => {
	it("measures where the ink is, its colors and its layout", () => {
		// A red disc with a blue bar under it, off-center on a wide canvas.
		const pixels = canvas(120, 80, (x, y) =>
			(x - 50) ** 2 + (y - 30) ** 2 < 20 ** 2
				? [224, 30, 90]
				: y >= 55 && y < 65 && x >= 30 && x < 70
					? [54, 197, 240]
					: undefined,
		);
		expect(inkBox(pixels)).toEqual({ x: 30, y: 11, width: 40, height: 54 });
		const features = markFeatures(pixels);
		expect(features?.palette.map(([color]) => color)).toEqual(["#e01e5a", "#36c5f0"]);
		expect(features?.aspect).toBeCloseTo(40 / 54, 2);
		expect(features?.grid).toHaveLength(64);
		expect(markFeatures(canvas(10, 10, () => undefined))).toBeUndefined();
	});

	it("ranks a mark nearer to a recolored copy of itself than to a different shape", () => {
		const disc = markFeatures(
			canvas(64, 64, (x, y) =>
				(x - 32) ** 2 + (y - 32) ** 2 < 28 ** 2 ? [20, 20, 20] : undefined,
			),
		)!;
		const blueDisc = markFeatures(
			canvas(64, 64, (x, y) =>
				(x - 32) ** 2 + (y - 32) ** 2 < 28 ** 2 ? [30, 60, 200] : undefined,
			),
		)!;
		const bar = markFeatures(
			canvas(64, 64, (x, y) => (y > 28 && y < 36 ? [20, 20, 20] : undefined)),
		)!;
		expect(markDistance(disc, disc)).toBe(0);
		expect(markDistance(disc, blueDisc)).toBeLessThan(markDistance(disc, bar) + 0.2);
		expect(markDistance(disc, bar)).toBeGreaterThan(0.2);
	});
});

describe("look-alike index", () => {
	it("covers every node logo and matches its current source", () => {
		const stale = nodeLogoIcons.flatMap((icon) => {
			const mark = lookAlikeMarks[icon.slug];
			const file = getIconSourceFile(icon.slug);
			if (!file) return [`${icon.slug}: no source`];
			const hash = lookAlikeSourceHash(readFileSync(resolve(svgRoot, file), "utf8"));
			return mark?.hash === hash ? [] : [icon.slug];
		});
		// Regenerate with `pnpm nx generate-look-alikes icon-catalog`.
		expect(stale).toEqual([]);
		expect(Object.keys(lookAlikeMarks).length).toBe(nodeLogoIcons.length);
	});

	it("never offers the named brand, and offers distinct marks of similar color", () => {
		const slack = lookAlikeMarks["slack"]!;
		const ranked = rankLookAlikes(slack, { name: "Slack", count: 4 });
		expect(ranked).toHaveLength(4);
		expect(ranked.map(({ slug }) => slug)).not.toContain("slack");
		expect(new Set(ranked.map(({ slug }) => slug)).size).toBe(4);
		const unnamed = rankLookAlikes(slack, { name: "Something else", count: 4 });
		expect(unnamed.map(({ slug }) => slug)).not.toContain("slack");
		for (const { distance } of ranked) expect(distance).toBeGreaterThan(0);
	});
});
