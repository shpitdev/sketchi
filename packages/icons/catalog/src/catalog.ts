import generatedCatalogJson from "./generated/icon-catalog.json";
import {
  decodeIconManifest,
  type IconManifest,
  type SketchiIcon,
} from "./manifest.js";
import { isNodeLogoEligible } from "./node-logos.js";

interface IconCatalog {
  readonly manifest: IconManifest;
  readonly sources: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSources(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error("Generated icon source map is invalid.");
  }
  const sources: Record<string, string> = {};
  for (const [slug, path] of Object.entries(value)) {
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`Generated source path for ${slug} is invalid.`);
    }
    sources[slug] = path;
  }
  return sources;
}

function decodeCatalog(value: unknown): IconCatalog {
  if (!isRecord(value)) {
    throw new Error("Generated icon catalog is invalid.");
  }
  const manifest = decodeIconManifest(value.manifest);
  const sources = decodeSources(value.sources);
  for (const icon of manifest.icons) {
    if (!sources[icon.slug]) {
      throw new Error(`Generated icon ${icon.slug} has no source path.`);
    }
  }
  return { manifest, sources };
}

const catalog = decodeCatalog(generatedCatalogJson);
const iconBySlug = new Map(
  catalog.manifest.icons.map((icon) => [icon.slug, icon]),
);

/** Public URL prefix of catalog SVG sources, relative to the package `svg/` directory. */
export const ICON_SOURCE_URL_PREFIX = "/output/upload-ready/svg/";

export const iconManifest = catalog.manifest;

/** Catalog marks that diagrams may embed inside nodes, in manifest order. */
export const nodeLogoIcons: readonly SketchiIcon[] =
  catalog.manifest.icons.filter(isNodeLogoEligible);

export function getIconBySlug(slug: string): SketchiIcon | undefined {
  return iconBySlug.get(slug);
}

export function getIconSourcePath(slug: string): string | undefined {
  return Object.hasOwn(catalog.sources, slug)
    ? catalog.sources[slug]
    : undefined;
}

/** Source file of an icon relative to this package's `svg/` directory. */
export function getIconSourceFile(slug: string): string | undefined {
  const sourcePath = getIconSourcePath(slug);
  return sourcePath?.startsWith(ICON_SOURCE_URL_PREFIX)
    ? sourcePath.slice(ICON_SOURCE_URL_PREFIX.length)
    : undefined;
}
