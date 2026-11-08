import { describe, expect, it } from "vitest";

import { iconRecipeIssues, type IconRecipe } from "@sketchi/diagram-core";
import { iconRecipeElements } from "@sketchi/diagram-excalidraw";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import { CONCEPT_ICONS } from "@sketchi/icon-catalog/concepts";
import nativeIcons from "@sketchi/icon-catalog/native-icons";

/** The icon budget at node-logo size: few parts, a small payload. */
const NODE_LOGO_SIZE = 28;
const MAX_ELEMENTS = 8;
const MAX_BYTES = 3 * 1024;

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
});
