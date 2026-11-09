# Sketchi Icons

Public SVG search, copy, download, HTTP API, and MCP surface for Sketchi.

## Data flow

`@sketchi/icon-catalog` (`packages/icons/catalog`) owns the icon pipeline
output, the SVG sources, the generated manifest, and ranked search. Before
`dev`, `build`, and Storybook, `pnpm nx sync-catalog-assets icons` publishes
two ignored copies into `public/`:

- `public/icons-manifest.json` is the browser contract. It contains only slug,
  display name, collection, aliases, keywords, SVG path, bytes, viewBox, and an
  optional variant.
- `public/output/upload-ready/svg/` holds the SVG files at their stable public
  URLs. Worker routes read them through the `ASSETS` binding.

The browser fetches one compact metadata manifest, then lazily loads only the
SVGs visible in the grid. The current 1,412-icon manifest is about 385 KB raw
and 38 KB with gzip, compared with the former 1.6 MB first-load payload. Static
SVG paths keep grid previews on the asset layer instead of routing every image
through the Worker.

## Agent access

- `GET /api/icons?q=&collection=&limit=` searches ranked results.
- `GET /api/icons/:slug` returns metadata with inline SVG.
- `GET /api/icons/:slug.svg` returns raw SVG.
- `/mcp` exposes `search_icons` and `get_icon`.
- `GET /api/community?q=&limit=&cursor=`, `GET /api/community/:slug` and
  `POST /api/community` list, read and publish community icons.
- `PATCH /api/community/:slug` with `{ "hidden": true }` and
  `Authorization: Bearer $COMMUNITY_ADMIN_TOKEN` hides an icon (`false`
  restores it).

## Community icons

Hand-drawn icons published through the API live in the `COMMUNITY_ICONS` D1
database (`@sketchi/community-icons` owns the table), separate from the
curated catalog, and show under `/community`. Only the name and recipe are
stored and served. Names and recipe text are moderated by Jev through the
Workers AI `AI` binding (`typesafe/jev`), and each client address may publish 10
icons a minute, counted exactly by its own `ClientRateLimit` Durable Object. Studio reads the same database, so a
flowchart or canvas node's `icon` can name `community/<slug>`; a catalog slug
never resolves to a community icon.
- `/llms.txt` documents the contracts for agents.

API and MCP responses have permissive CORS. Source reports and the source data
used to build the manifest are not copied into the public application.

## Commands

```sh
pnpm nx sync-catalog-assets icons
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
