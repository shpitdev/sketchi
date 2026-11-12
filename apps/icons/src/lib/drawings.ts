import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";

/** Every catalog mark's hand-drawn recipe, keyed by slug, published beside the manifest. */
export const DRAWINGS_PATH = "/icon-drawings.json";
/** The same drawings as one Excalidraw library. */
export const DRAWINGS_LIBRARY_PATH = "/sketchi-icons.excalidrawlib";
/** The same library with each name written under its drawing. */
export const DRAWINGS_NAMED_LIBRARY_PATH = "/sketchi-icons-with-names.excalidrawlib";

export type IconDrawings = Readonly<Record<string, IconRecipe>>;

/** The recipes drawn for catalog marks, in manifest order; concept recipes are not marks. */
export function catalogDrawings(
	slugs: readonly string[],
	recipes: Readonly<Record<string, unknown>>,
): IconDrawings {
	const drawings: Record<string, IconRecipe> = {};
	for (const slug of slugs) {
		const recipe = recipes[slug];
		if (recipe !== undefined) drawings[slug] = recipe as IconRecipe;
	}
	return drawings;
}

/** The published drawings file, keeping only entries shaped like a recipe. */
export function decodeDrawings(payload: unknown): IconDrawings {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new Error("Drawings file is not an object.");
	}
	const drawings: Record<string, IconRecipe> = {};
	for (const [slug, recipe] of Object.entries(payload)) {
		if (
			typeof recipe === "object" &&
			recipe !== null &&
			Array.isArray((recipe as { parts?: unknown }).parts)
		) {
			drawings[slug] = recipe as IconRecipe;
		}
	}
	return drawings;
}
