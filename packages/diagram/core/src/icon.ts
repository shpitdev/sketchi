import { fnv1a32 } from "./hash.js";
import type { IconRecipe } from "./icon-recipe.js";

/**
 * Community icons live under their own namespace, so a catalog slug always
 * means the catalog mark: `community/database` never collides with `database`.
 */
export const COMMUNITY_ICON_SLUG_PREFIX = "community/";

/** The collection community icons report in catalogs and search results. */
export const COMMUNITY_ICON_COLLECTION = "community";

/**
 * A recipe an agent hands a diagram directly, unpublished, draws under a slug
 * of its content in this namespace, so no recipe can stand in for a catalog
 * or community mark.
 */
export const DRAWN_ICON_SLUG_PREFIX = "drawn/";

/** The collection drawn icons report in catalogs. */
export const DRAWN_ICON_COLLECTION = "drawn";

/**
 * Public icon-catalog slugs are lowercase kebab-case of at most 64 characters;
 * community and drawn slugs add their namespace before one.
 */
export const DIAGRAM_ICON_SLUG_PATTERN =
	/^(?:community\/|drawn\/)?(?=[a-z0-9-]{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const DIAGRAM_ICON_SLUG_MAX_LENGTH = 64 + COMMUNITY_ICON_SLUG_PREFIX.length;

export function isDiagramIconSlug(value: string): boolean {
	return value.length <= DIAGRAM_ICON_SLUG_MAX_LENGTH && DIAGRAM_ICON_SLUG_PATTERN.test(value);
}

/** Whether a slug names a community icon rather than a catalog mark. */
export function isCommunityIconSlug(value: string): boolean {
	return value.startsWith(COMMUNITY_ICON_SLUG_PREFIX) && isDiagramIconSlug(value);
}

/** Whether a slug names a drawn icon, which only its scene's own recipe draws. */
export function isDrawnIconSlug(value: string): boolean {
	return value.startsWith(DRAWN_ICON_SLUG_PREFIX) && isDiagramIconSlug(value);
}

/** JSON with object keys sorted, so equal recipes serialize alike whatever their key order. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** The slug a drawn recipe draws under: the same recipe always takes the same slug. */
export function drawnIconSlug(recipe: IconRecipe): string {
	const text = canonicalJson(recipe);
	// Two passes in opposite directions make a 64-bit content key.
	const reversed = text.split("").reverse().join("");
	return `${DRAWN_ICON_SLUG_PREFIX}${fnv1a32(text, "hex", "utf16")}${fnv1a32(reversed, "hex", "utf16")}`;
}
