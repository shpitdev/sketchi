# Sketchi Icons

Public SVG search, copy, download, HTTP API, and MCP surface for Sketchi.

## Data flow

The source pipeline data stays under `pipeline-output/`, outside Vite's public
directory. `pnpm nx generate-manifest icons` converts that source into two
generated files:

- `public/icons-manifest.json` is the browser contract. It contains only slug,
  display name, collection, aliases, keywords, SVG path, bytes, viewBox, and an
  optional variant.
- `src/generated/icon-catalog.json` adds a private slug-to-source map for the
  Worker routes.

The browser fetches one compact metadata manifest, then lazily loads only the
SVGs visible in the grid. The current 1,412-icon manifest is about 385 KB raw
and 38 KB with gzip, compared with the former 1.6 MB first-load payload. Static
SVG paths keep grid previews on the asset layer instead of routing every image
through the Worker.

Duplicate source slugs are resolved by the explicit canonical map in
`src/lib/icon-manifest-generation.ts`. The chosen collection keeps the short
slug. Every alternate receives a collection-qualified slug. Generation fails
when a new collision has no explicit choice, which keeps public URLs
deterministic.

## Agent access

- `GET /api/icons?q=&collection=&limit=` searches ranked results.
- `GET /api/icons/:slug` returns metadata with inline SVG.
- `GET /api/icons/:slug.svg` returns raw SVG.
- `/mcp` exposes `search_icons` and `get_icon`.
- `/llms.txt` documents the contracts for agents.

API and MCP responses have permissive CORS. Source reports and the source data
used to build the manifest are not copied into the public application.

## Commands

```sh
pnpm nx generate-manifest icons
pnpm nx dev icons
pnpm nx test icons
pnpm nx typecheck icons
pnpm nx build icons
pnpm nx storybook icons
pnpm nx build-storybook icons
```

The main Sketchi docs should add a short Icons API section covering the HTTP
and MCP endpoints. That documentation belongs to the web-app owner and is not
part of this slice.
