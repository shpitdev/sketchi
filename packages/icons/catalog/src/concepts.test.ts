import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { iconManifest } from "./catalog.js";
import { CONCEPT_ICONS } from "./concepts.js";

const packageRoot = resolve(import.meta.dirname, "..");
const lucide = JSON.parse(
	readFileSync(createRequire(import.meta.url).resolve("lucide-static/icon-nodes.json"), "utf8"),
) as Record<string, unknown>;

describe("concept icons", () => {
	it("use unique kebab-case slugs no catalog mark uses", () => {
		const slugs = CONCEPT_ICONS.map((concept) => concept.slug);
		const marks = new Set(iconManifest.icons.map((icon) => icon.slug));
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.filter((slug) => marks.has(slug))).toEqual([]);
		for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
	});

	it("each name a Lucide icon or have a drawn recipe, never both", () => {
		for (const concept of CONCEPT_ICONS) {
			const drawn = existsSync(resolve(packageRoot, "recipes/concepts", `${concept.slug}.json`));
			if (concept.lucide) {
				expect(lucide[concept.lucide], concept.slug).toBeDefined();
				expect(drawn, concept.slug).toBe(false);
			} else {
				expect(drawn, concept.slug).toBe(true);
			}
		}
	});
});
