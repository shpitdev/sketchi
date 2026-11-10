import { describe, expect, it } from "vitest";

import { iconRecipeFitIssues, iconRecipeIssues, type IconRecipe } from "@sketchi/diagram-core";
import { iconRecipeElements } from "@sketchi/diagram-excalidraw";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import { CONCEPT_ICONS } from "@sketchi/icon-catalog/concepts";
import nativeIcons from "@sketchi/icon-catalog/native-icons";

/**
 * The icon budget at node-logo size. The draw engine's limit of 8 parts is the
 * real budget; the bytes are the rough-path points Excalidraw stores for those
 * parts, so a drawn brand mark (up to about 6 KB) runs larger than a Lucide
 * concept while staying a few parts.
 */
const NODE_LOGO_SIZE = 28;
const MAX_ELEMENTS = 8;
const MAX_BYTES = 6 * 1024;

describe("catalog hand-drawn icons", () => {
	const marks = new Set(iconManifest.icons.map((icon) => icon.slug));
	const concepts = new Set(CONCEPT_ICONS.map((concept) => concept.slug));

	it("draws every concept", () => {
		for (const slug of concepts) expect(Object.hasOwn(nativeIcons, slug), slug).toBe(true);
	});

	it("keeps every recipe drawable, for a concept or a catalog mark, within the icon budget", () => {
		for (const [slug, recipe] of Object.entries(nativeIcons)) {
			expect(concepts.has(slug) || marks.has(slug), slug).toBe(true);
			expect(iconRecipeIssues(recipe), slug).toEqual([]);
			const parts = iconRecipeElements(recipe as IconRecipe, {
				box: { x: 0, y: 0, size: NODE_LOGO_SIZE },
				id: `${slug}-icon`,
				groupIds: [`node:${slug}:logo`],
				ink: "#1e1e1e",
				paper: "#ffffff",
				customData: { sketchiNodeIcon: slug },
			});
			expect(parts.length, slug).toBeLessThanOrEqual(MAX_ELEMENTS);
			expect(new TextEncoder().encode(JSON.stringify(parts)).byteLength, slug).toBeLessThanOrEqual(
				MAX_BYTES,
			);
		}
	});

	it("keeps every word inside the grid, so no square clips it", () => {
		for (const [slug, recipe] of Object.entries(nativeIcons)) {
			expect(iconRecipeFitIssues(recipe as IconRecipe), slug).toEqual([]);
		}
	});

	it("draws a monochrome mark's own near-black or near-white in the scene's ink", () => {
		const modes = new Map(iconManifest.icons.map((icon) => [icon.slug, icon.colorMode]));
		// A neutral literal stays put where the mark inverts, so on a dark scene a black mark stays black.
		const literalInk = (color: unknown, mode: string) => {
			if (typeof color !== "string" || !/^#[0-9a-f]{6}$/u.test(color)) return false;
			const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16)) as [
				number,
				number,
				number,
			];
			if (Math.max(r, g, b) - Math.min(r, g, b) > 32) return false;
			const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			return mode === "mono-dark" ? luminance <= 0.25 : mode === "mono-light" && luminance >= 0.85;
		};
		for (const [slug, recipe] of Object.entries(nativeIcons)) {
			const mode = modes.get(slug);
			if (!mode || mode === "multicolor") continue;
			for (const part of (recipe as IconRecipe).parts) {
				for (const key of ["color", "fill", "stroke"] as const) {
					const value = (part as Partial<Record<typeof key, string>>)[key];
					expect(literalInk(value, mode), `${slug} ${key} ${value}`).toBe(false);
				}
			}
		}
	});
});
