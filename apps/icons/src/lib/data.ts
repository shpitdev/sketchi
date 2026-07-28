export interface SketchiIconViewBox {
  readonly height: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
}

export interface SketchiIcon {
  readonly aliases: readonly string[];
  readonly bytes: number;
  readonly collection: string;
  readonly keywords: readonly string[];
  readonly name: string;
  readonly slug: string;
  readonly svgPath: string;
  readonly variant?: string;
  readonly viewBox: SketchiIconViewBox;
}

export interface IconManifest {
  readonly generatedAt?: string;
  readonly icons: readonly SketchiIcon[];
  readonly summary: {
    readonly collectionCounts: Readonly<Record<string, number>>;
    readonly totalIcons: number;
  };
  readonly version: 1;
}

export interface IconSearchOptions {
  readonly collection?: string;
  readonly limit?: number;
  readonly query?: string;
}

export interface RankedIcon {
  readonly icon: SketchiIcon;
  readonly rank: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isViewBox(value: unknown): value is SketchiIconViewBox {
  return (
    isRecord(value) &&
    typeof value.height === "number" &&
    typeof value.minX === "number" &&
    typeof value.minY === "number" &&
    typeof value.width === "number"
  );
}

function isSketchiIcon(value: unknown): value is SketchiIcon {
  return (
    isRecord(value) &&
    isStringArray(value.aliases) &&
    typeof value.bytes === "number" &&
    typeof value.collection === "string" &&
    isStringArray(value.keywords) &&
    typeof value.name === "string" &&
    typeof value.slug === "string" &&
    typeof value.svgPath === "string" &&
    (value.variant === undefined || typeof value.variant === "string") &&
    isViewBox(value.viewBox)
  );
}

function decodeCollectionCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error("Icon manifest collection counts are invalid.");
  }

  const counts: Record<string, number> = {};
  for (const [collection, count] of Object.entries(value)) {
    if (typeof count !== "number") {
      throw new Error(`Icon manifest count for ${collection} is invalid.`);
    }
    counts[collection] = count;
  }
  return counts;
}

export function decodeIconManifest(value: unknown): IconManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.icons) ||
    !value.icons.every(isSketchiIcon) ||
    !isRecord(value.summary) ||
    typeof value.summary.totalIcons !== "number" ||
    (value.generatedAt !== undefined && typeof value.generatedAt !== "string")
  ) {
    throw new Error("Icon manifest does not match the public contract.");
  }

  return {
    ...(typeof value.generatedAt === "string"
      ? { generatedAt: value.generatedAt }
      : {}),
    icons: value.icons,
    summary: {
      collectionCounts: decodeCollectionCounts(value.summary.collectionCounts),
      totalIcons: value.summary.totalIcons,
    },
    version: 1,
  };
}

export function formatCollectionLabel(collection: string): string {
  if (collection === "gcp") return "Google Cloud";
  if (collection === "gcp-legacy") return "Google Cloud Classic";
  return collection
    .split("-")
    .map((part) =>
      ["ai", "ci", "iot", "paas"].includes(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
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
