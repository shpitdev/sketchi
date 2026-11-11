# Sketchi Icons

Public SVG search, copy, download, HTTP API, and MCP surface for Sketchi.

## Data flow

`@sketchi/icon-catalog` (`packages/icons/catalog`) owns the icon pipeline
output, the SVG sources, the generated manifest, and ranked search. Before
`dev`, `build`, and Storybook, `pnpm nx sync-catalog-assets icons` publishes
ignored copies into `public/`:

- `public/icons-manifest.json` is the browser contract. It contains only slug,
  display name, collection, aliases, keywords, SVG path, bytes, viewBox, and an
  optional variant.
- `public/output/upload-ready/svg/` holds the SVG files at their stable public
  URLs. Worker routes read them through the `ASSETS` binding.
- `public/icon-drawings.json` holds each catalog mark's hand-drawn recipe,
  keyed by slug (910 marks, about 80 KB with gzip). The page fetches it after
  the manifest for the grid's hand-drawn view and the drawing on each icon's
  details; if it fails, the SVG library is unchanged.
- `public/sketchi-icons.excalidrawlib` is the same set as one Excalidraw
  library (about 2.7 MB, 200 KB with gzip), built with the elements the
  "Copy for Excalidraw" actions paste.
- `public/packs/` holds the packs `src/lib/packs.ts` defines by collection:
  each as a library (`<id>.excalidrawlib`; the whole catalog keeps the URL
  above), a pack listed for Excalidraw's library collection also as its
  preview (`<id>.preview.jpg`), plus `index.json`, which the home page and
  each `/packs/<id>` page render on the server with each pack's version (a
  hash of its library). The largest pack library is 630 KB raw.

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

## Publishing packs to Excalidraw

excalidraw.com adds a library from a link only when the file is in
Excalidraw's library collection (`excalidraw/excalidraw-libraries`), so a pack
first goes there the way excalidraw.com's "Publish library" dialog sends one.

- A visitor opens "Publish to Excalidraw" on a pack and gives their name
  (required, 60 characters), and optionally a Twitter handle and a website
  (the pack's page by default). There is no GitHub handle: the collection's
  bot mentions it on GitHub, and nothing here shows the visitor owns it.
- `POST /api/packs/:id/excalidraw` takes those fields (2 KB at most, 3 a client
  an hour) and sends the rest itself: the built library pretty-printed, its
  preview, and the pack's listing (`excalidrawListing` in `src/lib/packs.ts`).
  The preview is the dialog's: 6 marks a row in 128 px boxes 8 px apart, as a
  JPEG at most 5000 px a side, each mark drawn as the pages draw it.
- Each pack version is sent once. The Worker claims the version in the
  `excalidraw_library_submissions` table (in the community icons D1 database)
  before sending; a send that fails frees it, and a claim left by a Worker
  that died frees it after 10 minutes. Once the collection answers with a
  pull request, the version stays taken: the Worker reads the pull request
  from GitHub's public API and stores its URL, its "Installation link" and
  what it read, or the error, so a link it could not read can be filled in
  by hand.
- Every visitor then gets "Add to Excalidraw" with the newest install link,
  which adds the library on excalidraw.com and leaves the canvas alone. A new
  pack version can be published again.
- Publishing is off unless the Worker has `EXCALIDRAW_LIBRARY_SUBMIT=on`;
  production and previews leave it unset, which hides the button and answers
  404. `EXCALIDRAW_LIBRARY_BACKEND` and `EXCALIDRAW_LIBRARY_GITHUB_API` point
  a local Worker at stand-ins for Excalidraw's backend and GitHub's API (in
  `apps/icons/.dev.vars`).

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
