export interface SketchiIconViewBox {
  height: number;
  minX: number;
  minY: number;
  width: number;
}

export interface SketchiIcon {
  baseSlug?: string;
  bytes: number;
  collection: string;
  fileName: string;
  flags: readonly string[];
  id: string;
  similarityGroupSize?: number;
  slug: string;
  urlPath: string;
  variant?: string | null;
  viewBox?: SketchiIconViewBox;
}

export interface IconLibraryData {
  generatedAt?: string;
  icons: readonly SketchiIcon[];
  summary: {
    collectionCounts: Record<string, number>;
    flagCounts?: Record<string, number>;
    totalIcons: number;
  };
}

export function formatCollectionLabel(collection: string): string {
  return collection
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function iconMatchesQuery(
  icon: SketchiIcon,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  return (
    icon.slug.toLowerCase().includes(normalizedQuery) ||
    icon.collection.toLowerCase().includes(normalizedQuery) ||
    icon.fileName.toLowerCase().includes(normalizedQuery) ||
    (icon.baseSlug?.toLowerCase().includes(normalizedQuery) ?? false)
  );
}
