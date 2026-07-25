import generatedCatalogJson from "../generated/icon-catalog.json";
import {
  decodeIconManifest,
  type IconManifest,
  type SketchiIcon,
} from "./icon-data.js";

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

export const iconManifest = catalog.manifest;

export function getIconBySlug(slug: string): SketchiIcon | undefined {
  return iconBySlug.get(slug);
}

export function getIconSourcePath(slug: string): string | undefined {
  return catalog.sources[slug];
}

export type IconSourceLoader = (
  request: Request,
  icon: SketchiIcon,
) => Promise<string>;

export interface IconAssetsBinding {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

export function createIconSourceLoader(
  assets: IconAssetsBinding,
): IconSourceLoader {
  return async (request, icon) => {
    const sourcePath = getIconSourcePath(icon.slug);
    if (!sourcePath) {
      throw new Error(`Source path not found for ${icon.slug}.`);
    }
    const response = await assets.fetch(new URL(sourcePath, request.url));
    if (!response.ok) {
      throw new Error(`Icon source returned HTTP ${response.status}.`);
    }
    return response.text();
  };
}
