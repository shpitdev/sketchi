/** Canonical production origin for the public Sketchi surface. */
export const SITE_URL = "https://sketchi.app";

/** Site name used for og:site_name. */
export const SITE_NAME = "Sketchi";

/** Static raster used by link previews and social crawlers. */
export const OG_IMAGE = {
  url: `${SITE_URL}/media/sketchi-og-card.png`,
  width: "1200",
  height: "630",
  type: "image/png",
  alt: "Describe it. Sketchi draws it. A deploy flow connects GitHub push, Docker build, tests pass, and Cloudflare ship steps.",
} as const;

/** A route-head meta entry (subset of what TanStack Router accepts). */
type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

/** A route-head link entry. */
type LinkTag = { rel: string; href: string };

/** Turn a route path into an absolute, canonical URL. */
export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalized}`;
}

/**
 * Page-agnostic social meta that is identical on every page. Rendered once
 * from the root route so it applies site-wide.
 */
export function siteSocialMeta(): MetaTag[] {
  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:image", content: OG_IMAGE.url },
    { property: "og:image:type", content: OG_IMAGE.type },
    { property: "og:image:width", content: OG_IMAGE.width },
    { property: "og:image:height", content: OG_IMAGE.height },
    { property: "og:image:alt", content: OG_IMAGE.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: OG_IMAGE.url },
    { name: "twitter:image:alt", content: OG_IMAGE.alt },
  ];
}

export interface PageMetaInput {
  title: string;
  description: string;
  /** Route path, e.g. "/" or "/docs". Used for og:url and canonical. */
  path: string;
  /**
   * Emit a canonical link. Defaults to true. Layout routes that also match
   * their children (e.g. `/agents`) pass `false` so the canonical is left to
   * the deepest matched route and never duplicated.
   */
  canonical?: boolean;
}

/**
 * Per-page title, description, and OpenGraph/Twitter text, plus a self-
 * referential canonical. Meta entries dedupe by name/property with the deepest
 * route winning, so a child route's values override the root defaults.
 */
export function pageMeta({
  title,
  description,
  path,
  canonical = true,
}: PageMetaInput): { meta: MetaTag[]; links?: LinkTag[] } {
  const url = absoluteUrl(path);
  const meta: MetaTag[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];

  return canonical
    ? { meta, links: [{ rel: "canonical", href: url }] }
    : { meta };
}
