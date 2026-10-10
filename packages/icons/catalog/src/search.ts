import { formatCollectionLabel, type SketchiIcon } from "./manifest.js";

export interface IconSearchOptions {
  readonly collection?: string;
  readonly limit?: number;
  readonly query?: string;
}

export interface RankedIcon {
  readonly icon: SketchiIcon;
  readonly rank: number;
}

export function normalizeIconQuery(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function containsQuery(values: readonly string[], query: string): boolean {
  return values.some((value) => normalizeIconQuery(value).includes(query));
}

function iconSearchTermRank(
  icon: SketchiIcon,
  searchTerm: string,
): number | null {
  const slug = normalizeIconQuery(icon.slug);
  const name = normalizeIconQuery(icon.name);
  const collection = normalizeIconQuery(icon.collection);
  const collectionName = normalizeIconQuery(
    formatCollectionLabel(icon.collection),
  );

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

export function iconSearchRank(
  icon: SketchiIcon,
  normalizedQuery: string,
): number | null {
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

export function searchIcons(
  icons: readonly SketchiIcon[],
  options: IconSearchOptions = {},
): readonly RankedIcon[] {
  const normalizedQuery = normalizeIconQuery(options.query ?? "");
  const collection = options.collection?.trim();
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  return icons
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
    )
    .slice(0, Math.max(0, limit));
}
