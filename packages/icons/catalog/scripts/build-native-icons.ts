import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getIconBySlug } from "../src/catalog.js";

// Hand-drawn recipes, one JSON file per slug under recipes/, bundled into one
// map. Diagram packages own the recipe format and check every entry draws.
const packageRoot = resolve(import.meta.dirname, "..");
const recipesRoot = resolve(packageRoot, "recipes");
const distRoot = resolve(packageRoot, "dist");

const files = existsSync(recipesRoot)
	? readdirSync(recipesRoot)
			.filter((file) => file.endsWith(".json"))
			.sort()
	: [];
const recipes: Record<string, unknown> = {};
for (const file of files) {
	const slug = file.slice(0, -".json".length);
	if (!getIconBySlug(slug)) {
		throw new Error(`Recipe ${file} names no catalog icon.`);
	}
	recipes[slug] = JSON.parse(readFileSync(resolve(recipesRoot, file), "utf8"));
}

mkdirSync(distRoot, { recursive: true });
writeFileSync(resolve(distRoot, "native-icons.json"), `${JSON.stringify(recipes)}\n`, "utf8");
writeFileSync(
	resolve(distRoot, "native-icons.d.ts"),
	[
		"/** Hand-drawn icon recipes keyed by slug; diagram packages validate and draw them. */",
		"declare const nativeIcons: Readonly<Record<string, unknown>>;",
		"export default nativeIcons;",
		"",
	].join("\n"),
	"utf8",
);

process.stdout.write(
	`Built ${files.length} native icon recipes into packages/icons/catalog/dist.\n`,
);
