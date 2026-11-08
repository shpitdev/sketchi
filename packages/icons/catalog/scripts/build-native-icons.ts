import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { getIconBySlug } from "../src/catalog.js";
import { CONCEPT_ICONS } from "../src/concepts.js";
import { transcribeLucideIcon, type LucideIconNode } from "../src/lucide-recipes.js";

// Every hand-drawn recipe keyed by slug: concept icons transcribed from Lucide
// or drawn under recipes/concepts/, and brand marks drawn under recipes/.
// Diagram packages own the recipe format and check every entry draws.
const packageRoot = resolve(import.meta.dirname, "..");
const recipesRoot = resolve(packageRoot, "recipes");
const distRoot = resolve(packageRoot, "dist");

function jsonSlugs(directory: string): string[] {
	return existsSync(directory)
		? readdirSync(directory)
				.filter((file) => file.endsWith(".json"))
				.map((file) => file.slice(0, -".json".length))
				.sort()
		: [];
}

function readRecipe(directory: string, slug: string): unknown {
	return JSON.parse(readFileSync(resolve(directory, `${slug}.json`), "utf8"));
}

const recipes: Record<string, unknown> = {};

const lucideNodes = JSON.parse(
	readFileSync(createRequire(import.meta.url).resolve("lucide-static/icon-nodes.json"), "utf8"),
) as Record<string, LucideIconNode>;
const conceptsRoot = resolve(recipesRoot, "concepts");
const drawnConcepts = jsonSlugs(conceptsRoot);
for (const concept of CONCEPT_ICONS) {
	if (getIconBySlug(concept.slug) || Object.hasOwn(recipes, concept.slug)) {
		throw new Error(`Concept ${concept.slug} shares its slug with a mark or another concept.`);
	}
	if (concept.lucide && drawnConcepts.includes(concept.slug)) {
		throw new Error(`Concept ${concept.slug} has both a Lucide icon and a drawn recipe.`);
	}
	if (concept.lucide) {
		const node = lucideNodes[concept.lucide];
		if (!node) throw new Error(`Concept ${concept.slug} names no Lucide icon ${concept.lucide}.`);
		recipes[concept.slug] = transcribeLucideIcon(concept.lucide, node);
	} else if (drawnConcepts.includes(concept.slug)) {
		recipes[concept.slug] = readRecipe(conceptsRoot, concept.slug);
	} else {
		throw new Error(`Concept ${concept.slug} has neither a Lucide icon nor a drawn recipe.`);
	}
}
for (const slug of drawnConcepts) {
	if (!CONCEPT_ICONS.some((concept) => concept.slug === slug)) {
		throw new Error(`recipes/concepts/${slug}.json draws no concept.`);
	}
}

const brands = jsonSlugs(recipesRoot);
for (const slug of brands) {
	if (!getIconBySlug(slug)) {
		throw new Error(`Recipe ${slug}.json names no catalog icon.`);
	}
	recipes[slug] = readRecipe(recipesRoot, slug);
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
	`Built ${CONCEPT_ICONS.length} concept and ${brands.length} brand icon recipes into packages/icons/catalog/dist.\n`,
);
