import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { iconRecipeIssues } from "@sketchi/diagram-core";

import type { MarkRecord } from "./store.js";

export interface Promotion {
	readonly written: readonly string[];
	/** Recognized marks left out, with why. */
	readonly skipped: ReadonlyArray<{ readonly slug: string; readonly reason: string }>;
}

/**
 * Turn the marks the judge recognized into catalog recipes, except those a
 * reviewer rejected from the sheets. An existing recipe is never replaced.
 */
export async function promote(
	records: readonly MarkRecord[],
	recipesDir: string,
	rejected: ReadonlySet<string>,
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
		else if (existsSync(path)) skipped.push({ slug: record.slug, reason: "already has a recipe" });
		else if (iconRecipeIssues(recipe).length > 0) {
			skipped.push({ slug: record.slug, reason: iconRecipeIssues(recipe).join("; ") });
		} else {
			await writeFile(path, `${JSON.stringify(recipe, null, "\t")}\n`, "utf8");
			written.push(record.slug);
		}
	}
	return { written, skipped };
}
