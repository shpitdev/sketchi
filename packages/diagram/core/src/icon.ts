/**
 * Community icons live under their own namespace, so a catalog slug always
 * means the catalog mark: `community/database` never collides with `database`.
 */
export const COMMUNITY_ICON_SLUG_PREFIX = "community/";

/** The collection community icons report in catalogs and search results. */
export const COMMUNITY_ICON_COLLECTION = "community";

/**
 * Public icon-catalog slugs are lowercase kebab-case of at most 64 characters;
 * community slugs add their namespace before one.
 */
export const DIAGRAM_ICON_SLUG_PATTERN =
	/^(?:community\/)?(?=[a-z0-9-]{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const DIAGRAM_ICON_SLUG_MAX_LENGTH = 64 + COMMUNITY_ICON_SLUG_PREFIX.length;

export function isDiagramIconSlug(value: string): boolean {
	return value.length <= DIAGRAM_ICON_SLUG_MAX_LENGTH && DIAGRAM_ICON_SLUG_PATTERN.test(value);
}

/** Whether a slug names a community icon rather than a catalog mark. */
export function isCommunityIconSlug(value: string): boolean {
	return value.startsWith(COMMUNITY_ICON_SLUG_PREFIX) && isDiagramIconSlug(value);
}
