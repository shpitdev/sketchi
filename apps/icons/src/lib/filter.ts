import { searchIcons, type SketchiIcon } from "@sketchi/icon-catalog";

export interface IconFilter {
	/** Collections to include. Empty means every collection. */
	readonly collections: ReadonlySet<string>;
	readonly query: string;
}

/**
 * Icons in any of the chosen collections (OR), ranked by the text query. The
 * collection cut happens first, so the catalog's partial-match fallback stays
 * inside the chosen collections instead of leaking icons from the rest.
 */
export function filterIcons<Icon extends SketchiIcon>(
	icons: readonly Icon[],
	{ collections, query }: IconFilter,
): readonly Icon[] {
	const scoped = collections.size
		? icons.filter((icon) => collections.has(icon.collection))
		: icons;
	const trimmed = query.trim();
	return searchIcons(scoped, trimmed ? { query: trimmed } : {}).map(({ icon }) => icon);
}

export function toggleCollection(
	collections: ReadonlySet<string>,
	collection: string,
): ReadonlySet<string> {
	const next = new Set(collections);
	if (!next.delete(collection)) next.add(collection);
	return next;
}
