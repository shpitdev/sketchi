import { formatCollectionLabel, type SketchiIcon } from "./manifest.js";
import { isDistinctiveWord, termTokens } from "./terms.js";

export interface IconSearchOptions {
	readonly collection?: string;
	readonly limit?: number;
	readonly query?: string;
}

/** The icon fields ranked search reads. */
export type SearchableIcon = Pick<
	SketchiIcon,
	"aliases" | "collection" | "keywords" | "name" | "slug"
>;

export interface RankedIcon<Icon extends SearchableIcon = SketchiIcon> {
	readonly icon: Icon;
	readonly rank: number;
}

export function normalizeIconQuery(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function containsQuery(values: readonly string[], query: string): boolean {
	return values.some((value) => normalizeIconQuery(value).includes(query));
}

function iconSearchTermRank(icon: SearchableIcon, searchTerm: string): number | null {
	const slug = normalizeIconQuery(icon.slug);
	const name = normalizeIconQuery(icon.name);
	const collection = normalizeIconQuery(icon.collection);
	const collectionName = normalizeIconQuery(formatCollectionLabel(icon.collection));

	if (slug === searchTerm) {
		return 0;
	}
	if (name.startsWith(searchTerm)) {
		return 1;
	}
	if (containsQuery(icon.aliases, searchTerm)) {
		return 2;
	}
	if (
		slug.includes(searchTerm) ||
		name.includes(searchTerm) ||
		containsQuery(icon.keywords, searchTerm)
	) {
		return 3;
	}
	if (collection.includes(searchTerm) || collectionName.includes(searchTerm)) {
		return 4;
	}
	return null;
}

export function iconSearchRank(icon: SearchableIcon, normalizedQuery: string): number | null {
	if (normalizedQuery.length === 0) {
		return 5;
	}

	const phraseRank = iconSearchTermRank(icon, normalizedQuery);
	if (phraseRank !== null) {
		return phraseRank;
	}

	const queryTokens = normalizedQuery.split(/\s+/u);
	if (queryTokens.length === 1) {
		return null;
	}

	let combinedRank = 0;
	for (const token of queryTokens) {
		const tokenRank = iconSearchTermRank(icon, token);
		if (tokenRank === null) {
			return null;
		}
		combinedRank = Math.max(combinedRank, tokenRank);
	}
	return combinedRank;
}

/** Rank of a match on part of the query, below every whole-query tier. */
export const PARTIAL_QUERY_RANK = 6;

/** Longest part of a query matched against whole catalog terms. */
const MAX_PARTIAL_TOKENS = 4;

/** Cloud vendors, whose marks stand in for products the catalog lacks. */
const VENDOR_COLLECTIONS: ReadonlySet<string> = new Set(["cloud-platforms", "cloud-vendors"]);

/** A term without spacing or punctuation: "Fly.io", "fly io", and "flyio" agree. */
function compactTerm(value: string): string {
	return value.toLocaleLowerCase().replace(/[^a-z0-9+#]/gu, "");
}

const termIndexes = new WeakMap<readonly SearchableIcon[], Map<string, SearchableIcon[]>>();

/** Icons by compacted slug, name, and alias, built once per icon list. */
function compactTermIndex<Icon extends SearchableIcon>(
	icons: readonly Icon[],
): Map<string, Icon[]> {
	const cached = termIndexes.get(icons);
	if (cached) return cached as Map<string, Icon[]>;
	const index = new Map<string, Icon[]>();
	for (const icon of icons) {
		for (const term of new Set([icon.slug, icon.name, ...icon.aliases].map(compactTerm))) {
			if (!term) continue;
			const entries = index.get(term) ?? [];
			entries.push(icon);
			index.set(term, entries);
		}
	}
	termIndexes.set(icons, index);
	return index;
}

interface PartialMatch<Icon> {
	readonly icon: Icon;
	readonly length: number;
	readonly start: number;
	readonly termRank: number;
	readonly vendor: boolean;
}

/**
 * Icons named by part of a query that matches no icon as a whole, as in
 * "Cloudflare Workers" or "AWS Lambda". A part must equal an icon's slug,
 * name, or alias, and must hold a distinctive word unless it names a cloud
 * vendor ("google", "amazon"); so "Edge" or "Lambda" inside a product name
 * never draw a browser or a GPU cloud. Longer parts rank first, then a
 * product's own mark above its vendor's, then query order.
 */
function partialQueryMatches<Icon extends SearchableIcon>(
	icons: readonly Icon[],
	query: string,
	collection: string | undefined,
): RankedIcon<Icon>[] {
	const tokens = termTokens(query);
	const index = compactTermIndex(icons);
	const matches = new Map<string, PartialMatch<Icon>>();
	for (let length = Math.min(MAX_PARTIAL_TOKENS, tokens.length); length > 0; length -= 1) {
		for (let start = 0; start + length <= tokens.length; start += 1) {
			const part = tokens.slice(start, start + length);
			const distinctive = part.some(isDistinctiveWord);
			for (const icon of index.get(compactTerm(part.join(""))) ?? []) {
				const vendor = VENDOR_COLLECTIONS.has(icon.collection);
				if (matches.has(icon.slug) || (!distinctive && !vendor)) continue;
				if (collection && icon.collection !== collection) continue;
				const termRank = iconSearchTermRank(icon, part.join(" ")) ?? PARTIAL_QUERY_RANK;
				matches.set(icon.slug, { icon, length, start, termRank, vendor });
			}
		}
	}
	return [...matches.values()]
		.sort(
			(left, right) =>
				right.length - left.length ||
				Number(left.vendor) - Number(right.vendor) ||
				left.start - right.start ||
				left.termRank - right.termRank ||
				left.icon.name.localeCompare(right.icon.name) ||
				left.icon.slug.localeCompare(right.icon.slug),
		)
		.map(({ icon }) => ({ icon, rank: PARTIAL_QUERY_RANK }));
}

/**
 * Catalog icons ranked by exact slug, name prefix, alias, substring, then
 * collection. A query no icon matches as a whole falls back to the icons its
 * parts name (see partialQueryMatches); nothing credible returns [].
 */
export function searchIcons<Icon extends SearchableIcon = SketchiIcon>(
	icons: readonly Icon[],
	options: IconSearchOptions = {},
): readonly RankedIcon<Icon>[] {
	const normalizedQuery = normalizeIconQuery(options.query ?? "");
	const collection = options.collection?.trim();
	const limit = Math.max(0, options.limit ?? Number.POSITIVE_INFINITY);

	const ranked = icons
		.flatMap((icon) => {
			if (collection && icon.collection !== collection) {
				return [];
			}
			const rank = iconSearchRank(icon, normalizedQuery);
			return rank === null ? [] : [{ icon, rank }];
		})
		.sort(
			(left, right) =>
				left.rank - right.rank ||
				left.icon.name.localeCompare(right.icon.name) ||
				left.icon.slug.localeCompare(right.icon.slug),
		);
	return (
		ranked.length > 0 ? ranked : partialQueryMatches(icons, normalizedQuery, collection)
	).slice(0, limit);
}
