import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { iconRecipeFitIssues, iconRecipeIssues } from "@sketchi/diagram-core";

import type { MarkRecord } from "./store.js";

export interface Promotion {
	readonly written: readonly string[];
	/** Recognized marks left out, with why. */
	readonly skipped: ReadonlyArray<{ readonly slug: string; readonly reason: string }>;
}

/**
 * Turn the marks the judge recognized into catalog recipes, except those a
 * reviewer rejected from the sheets and any that cannot be drawn or would
 * clip a word. An existing recipe is replaced only with `replace`, for a run
 * that redraws marks whose source or drawing changed.
 */
export async function promote(
	records: readonly MarkRecord[],
	recipesDir: string,
	rejected: ReadonlySet<string>,
	options: { readonly replace?: boolean } = {},
): Promise<Promotion> {
	const written: string[] = [];
	const skipped: Array<{ slug: string; reason: string }> = [];
	for (const record of records) {
		if (record.status !== "recognized" || record.chosen === undefined) continue;
		const recipe = record.attempts[record.chosen]?.recipe;
		const path = join(recipesDir, `${record.slug}.json`);
		if (rejected.has(record.slug))
			skipped.push({ slug: record.slug, reason: "rejected in review" });
		else if (!recipe) skipped.push({ slug: record.slug, reason: "no recipe" });
		else if (!options.replace && existsSync(path))
			skipped.push({ slug: record.slug, reason: "already has a recipe" });
		else {
			const issues = iconRecipeIssues(recipe);
			const problems = issues.length > 0 ? issues : iconRecipeFitIssues(recipe);
			if (problems.length > 0) skipped.push({ slug: record.slug, reason: problems.join("; ") });
			else {
				await writeFile(path, `${JSON.stringify(recipe, null, "\t")}\n`, "utf8");
				written.push(record.slug);
			}
		}
	}
	return { written, skipped };
}
