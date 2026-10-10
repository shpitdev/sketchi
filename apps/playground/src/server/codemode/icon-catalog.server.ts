import "@tanstack/react-start/server-only";

import {
  CodeModeIconLoadError,
  makeCodeModeIconCatalog,
  type CodeModeIconCatalog,
} from "@sketchi/diagram-agent";
import { logosNamedInText, type NamedLogo } from "@sketchi/icon-catalog";
import { iconManifest, nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import { Effect } from "effect";

/** Static-asset path of normalized node-logo SVGs (see scripts/sync-node-logos.ts). */
export const NODE_LOGO_ASSET_PATH = "/node-logos/";

/**
 * Catalog logos for technologies a text names. Generation may only put these
 * on nodes, which keeps every logo grounded in the user's words.
 */
export function logosNamedIn(text: string): NamedLogo[] {
  return logosNamedInText(text, nodeLogoIcons);
}

export interface PlaygroundAssetsBinding {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

const catalogs = new WeakMap<
  PlaygroundAssetsBinding,
  Map<string, CodeModeIconCatalog>
>();

/**
 * Node-logo catalog backed by the Worker's static assets. Only the manifest is
 * bundled into the script; SVG bytes stay outside the script size limit.
 * Assets are addressed at the request's own origin: deployed ASSETS ignores the
 * host, and the local Vite dev server rejects hosts it does not serve.
 */
export function playgroundIconCatalog(
  assets: PlaygroundAssetsBinding,
  origin: string,
): CodeModeIconCatalog {
  const byOrigin =
    catalogs.get(assets) ?? new Map<string, CodeModeIconCatalog>();
  catalogs.set(assets, byOrigin);
  const cached = byOrigin.get(origin);
  if (cached) return cached;
  const catalog = makeCodeModeIconCatalog({
    icons: iconManifest.icons,
    loadSvg: (icon) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await assets.fetch(
            new URL(
              `${NODE_LOGO_ASSET_PATH}${encodeURIComponent(icon.slug)}.svg`,
              origin,
            ),
            { signal },
          );
          if (!response.ok) {
            throw new Error(
              `Node logo asset returned HTTP ${response.status}.`,
            );
          }
          return response.text();
        },
        catch: (cause) =>
          CodeModeIconLoadError.make({
            cause,
            message: `Node logo ${icon.slug} could not be read from static assets.`,
            slug: icon.slug,
          }),
      }),
    slugLookup: "sketchi.searchIcons({ q })",
  });
  byOrigin.set(origin, catalog);
  return catalog;
}
