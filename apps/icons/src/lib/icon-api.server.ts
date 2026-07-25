import { corsJson, corsPreflight, corsText } from "./cors-policy.js";
import {
  getIconBySlug,
  iconManifest,
  type IconSourceLoader,
} from "./icon-catalog.server.js";
import { searchIcons, type SketchiIcon } from "./icon-data.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface IconSearchResult {
  readonly aliases: readonly string[];
  readonly collection: string;
  readonly detailUrl: string;
  readonly keywords: readonly string[];
  readonly name: string;
  readonly slug: string;
  readonly svgUrl: string;
}

export interface IconDetailResult extends IconSearchResult {
  readonly bytes: number;
  readonly svg: string;
  readonly variant?: string;
  readonly viewBox: SketchiIcon["viewBox"];
}

function apiUrls(origin: string, slug: string) {
  const encodedSlug = encodeURIComponent(slug);
  return {
    detailUrl: new URL(`/api/icons/${encodedSlug}`, origin).href,
    svgUrl: new URL(`/api/icons/${encodedSlug}.svg`, origin).href,
  };
}

export function iconSearchResult(
  icon: SketchiIcon,
  origin: string,
): IconSearchResult {
  return {
    aliases: icon.aliases,
    collection: icon.collection,
    ...apiUrls(origin, icon.slug),
    keywords: icon.keywords,
    name: icon.name,
    slug: icon.slug,
  };
}

export function parseIconLimit(value: string | null): number {
  if (value === null || value.trim() === "") {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

export function searchIconResults(input: {
  readonly collection?: string;
  readonly limit?: number;
  readonly origin: string;
  readonly query?: string;
}) {
  const allMatches = searchIcons(iconManifest.icons, {
    ...(input.collection ? { collection: input.collection } : {}),
    ...(input.query ? { query: input.query } : {}),
  });
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return {
    collection: input.collection ?? null,
    count: Math.min(allMatches.length, limit),
    query: input.query ?? "",
    results: allMatches
      .slice(0, limit)
      .map(({ icon }) => iconSearchResult(icon, input.origin)),
    total: allMatches.length,
  };
}

export async function getIconDetail(
  request: Request,
  slug: string,
  sourceLoader: IconSourceLoader,
): Promise<IconDetailResult | undefined> {
  const icon = getIconBySlug(slug);
  if (!icon) {
    return undefined;
  }
  return {
    ...iconSearchResult(icon, request.url),
    bytes: icon.bytes,
    svg: await sourceLoader(request, icon),
    ...(icon.variant ? { variant: icon.variant } : {}),
    viewBox: icon.viewBox,
  };
}

export function handleIconSearchRequest(request: Request): Response {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const collection = url.searchParams.get("collection")?.trim() ?? "";
  const limit = parseIconLimit(url.searchParams.get("limit"));
  return corsJson(
    searchIconResults({
      ...(collection ? { collection } : {}),
      limit,
      origin: url.origin,
      ...(query ? { query } : {}),
    }),
    {
      headers: { "Cache-Control": "public, max-age=60" },
    },
  );
}

export async function handleIconDetailRequest(
  request: Request,
  slug: string,
  sourceLoader: IconSourceLoader,
): Promise<Response> {
  const detail = await getIconDetail(request, slug, sourceLoader);
  if (!detail) {
    return corsJson({ error: "Icon not found.", slug }, { status: 404 });
  }
  return corsJson(detail, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}

export async function handleRawIconRequest(
  request: Request,
  slug: string,
  sourceLoader: IconSourceLoader,
  head = false,
): Promise<Response> {
  const icon = getIconBySlug(slug);
  if (!icon) {
    return corsText("Icon not found.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }
  const source = await sourceLoader(request, icon);
  return corsText(head ? null : source, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": `inline; filename="${icon.slug}.svg"`,
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}

export function handleIconDetailHeadRequest(): Response {
  return corsText(null, {
    headers: { Allow: "GET, OPTIONS" },
    status: 405,
  });
}

export { corsPreflight };
