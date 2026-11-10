import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { iconRecipeFitIssues, iconRecipeIssues, type IconRecipe } from "@sketchi/diagram-core";
import type { IconColorMode } from "@sketchi/icon-catalog";

import { settleRecipe } from "./normalize.js";
import type { MarkRecord } from "./store.js";

export interface Promotion {
	readonly written: readonly string[];
	/** Recognized marks left out, with why. */
	readonly skipped: ReadonlyArray<{ readonly slug: string; readonly reason: string }>;
}

/** A mark's color mode from the catalog; undefined for a slug it does not hold. */
export type ColorModeOf = (slug: string) => IconColorMode | undefined;

const recipeFile = (recipe: IconRecipe) => `${JSON.stringify(recipe, null, "\t")}\n`;

/**
 * Turn the marks the judge recognized into catalog recipes, except those a
 * reviewer rejected from the sheets. Each is settled first (words fit the
 * grid, a monochrome mark draws in ink). An existing recipe is never replaced.
 */
export async function promote(
	records: readonly MarkRecord[],
	recipesDir: string,
	rejected: ReadonlySet<string>,
	colorModeOf: ColorModeOf,
): Promise<Promotion> {
	const written: string[] = [];
	const skipped: Array<{ slug: string; reason: string }> = [];
	for (const record of records) {
		if (record.status !== "recognized" || record.chosen === undefined) continue;
		const drawn = record.attempts[record.chosen]?.recipe;
		const path = join(recipesDir, `${record.slug}.json`);
		const mode = colorModeOf(record.slug);
		if (rejected.has(record.slug))
			skipped.push({ slug: record.slug, reason: "rejected in review" });
		else if (!drawn) skipped.push({ slug: record.slug, reason: "no recipe" });
		else if (!mode) skipped.push({ slug: record.slug, reason: "not a catalog mark" });
		else if (existsSync(path)) skipped.push({ slug: record.slug, reason: "already has a recipe" });
		else {
			const { recipe } = settleRecipe(drawn, mode);
			const issues = [...iconRecipeIssues(recipe), ...iconRecipeFitIssues(recipe)];
			if (issues.length > 0) skipped.push({ slug: record.slug, reason: issues.join("; ") });
			else {
				await writeFile(path, recipeFile(recipe), "utf8");
				written.push(record.slug);
			}
		}
	}
	return { written, skipped };
}

/** Settle every catalog recipe already in `recipesDir`, rewriting those that change. */
export async function settleRecipes(
	recipesDir: string,
	colorModeOf: ColorModeOf,
): Promise<ReadonlyArray<{ readonly slug: string; readonly changes: readonly string[] }>> {
	const settled: Array<{ slug: string; changes: readonly string[] }> = [];
	for (const file of (await readdir(recipesDir)).filter((name) => name.endsWith(".json")).sort()) {
		const slug = file.slice(0, -".json".length);
		const mode = colorModeOf(slug);
		if (!mode) continue;
		const path = join(recipesDir, file);
		const { recipe, changes } = settleRecipe(
			JSON.parse(await readFile(path, "utf8")) as IconRecipe,
			mode,
		);
		if (changes.length === 0) continue;
		await writeFile(path, recipeFile(recipe), "utf8");
		settled.push({ slug, changes });
	}
	return settled;
}
