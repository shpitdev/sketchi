# icon-catalog

The Sketchi icon library: manifest, ranked search, SVG sources, and the rules
for embedding marks inside diagram nodes.

| Owns                                          | Does not own                     |
| --------------------------------------------- | -------------------------------- |
| SVG sources under `svg/`                      | HTTP routes, MCP, or browser UI  |
| icon pipeline output under `pipeline-output/` | where an app publishes the files |
| generated manifest and slug-to-source map     | diagram layout or Excalidraw     |
| hand-drawn icon recipes under `recipes/`      | the recipe format and its drawing |
| SVG sanitizing and mark features, look-alikes | drawing new icons (icon-draw)     |
| ranked search and node-logo eligibility       |                                  |

## Entry points

- `@sketchi/icon-catalog`: manifest types and decoding, `searchIcons`,
  `iconColor`, `isNodeLogoEligible`, `normalizeNodeLogoSvg` and
  `nodeLogoSvgForPaper`. It carries no catalog data, so browser code can
  import it.
- `@sketchi/icon-catalog/catalog`: the generated catalog (`iconManifest`,
  `getIconBySlug`, `getIconSourcePath`, `getIconSourceFile`, `nodeLogoIcons`).
- `@sketchi/icon-catalog/native-icons`: the built map of hand-drawn recipes by
  slug.
- `@sketchi/icon-catalog/concepts`: the generic concept icons (`CONCEPT_ICONS`).
- `@sketchi/icon-catalog/look-alikes`: each node logo's features and
  `rankLookAlikes`.

## Data flow

`pipeline-output/review/review-data.json` is the pipeline source.
`pnpm nx generate-catalog icon-catalog` turns it into
`src/generated/icon-catalog.json`: the public manifest plus a private
slug-to-source map. Duplicate source slugs are resolved by the explicit
canonical map in `src/manifest-generation.ts`; generation fails when a new
collision has no explicit choice, so public slugs stay deterministic.

Some products share one glyph. `src/folded-slugs.ts` folds each such mark
into one shipped slug: the folded mark leaves the manifest, its slug and names
become the shipped mark's aliases, and `getIconBySlug`, source paths and
diagram slug lookups follow the folded slug to the shipped mark. Its SVG stays
under `svg/`, so a URL already published for it keeps working.

Vendor icon sets (AWS: `aws` for services and categories, `aws-resources`;
Databricks: `databricks`; Snowflake: `snowflake`)
come with the vendor's product names and official aliases in the pipeline
record, which the manifest uses as they are. `src/vendor-aliases.ts` adds the
names architecture labels use for them: either vendor prefix and the bare name
of a well-known AWS service ("AWS S3", "S3"), and the commonest resources ("S3
bucket"). A plain resource word ("Database", "Queue", "Users") never names a
vendor mark, and a tech noun never rescues an English first word into one
(`GENERIC_COLLECTIONS` in `text-match.ts`).

Brands from the simple-icons set come with the brand's name and the names
diagrams use for it ("Apache Kafka", "Kafka") in the pipeline record. Some of
them are English words ("Temporal", "Square", "Zoom"): like any catalog word,
a label names one only when it is cased as a name or names the product
("Temporal worker"). Where two marks share a term, `TERM_OWNERS` in
`search.ts` names the one diagrams mean ("Spark" is Apache Spark). Diagram tools
(Excalidraw, Mermaid, draw.io, tldraw, Lucidchart) name a request's format or
source, so text never names their marks.

Apps publish the SVGs themselves. `apps/icons` copies `svg/` to its public
`/output/upload-ready/svg/` path at build time.

## Node logos

Diagrams embed only compact marks in nodes: no `-text` wordmarks and no source
over `NODE_LOGO_MAX_BYTES` (64 KB). A standalone canvas icon may draw a
wordmark under the same cap (`isStandaloneWordmark`); static hosts get those
files in `dist/node-logos` too, while the bundled `node-logo-svgs` map leaves
them out. A test holds every non-wordmark source file
under that cap, so every mark is a node logo; shrink an oversized source
(fewer paths, coarser precision, a vector instead of an embedded raster)
rather than raising the cap. `normalizeNodeLogoSvg` adds the intrinsic
`width` and `height` from the viewBox, because browsers size a viewBox-only SVG
image as 300x150 and distort it when drawing into a square.

Each mark's `colorMode`, `onDark` and `onLight` come from its pixels (see
below). The built node logos are ready for diagram paper: `nodeLogoSvgForPaper`
inverts a neutral mark lost on a light surface and puts a multicolor one on a
dark plate. Excalidraw's dark theme inverts SVG images with the canvas, so a
mark that reads on the light canvas reads on the dark one too, with its brand
colors' lightness flipped.

## Hand-drawn icons

Diagrams draw a mark by hand when it has a recipe: `recipes/<slug>.json`, a
few rectangles, ellipses, strokes, an arrow, or a word on a 24-unit grid (the
`IconRecipe` format in `@sketchi/diagram-core`). The build bundles every recipe
into `@sketchi/icon-catalog/native-icons`; a recipe must name a catalog slug.
Diagram packages validate each recipe and draw it as plain Excalidraw
elements, and embed the SVG only for marks without one or when a diagram asks
for exact marks.

A recipe's word is measured as Excalifont paints it, and must sit inside the
grid and clear of the pen of the shape around it at the 112 px review size
(`iconRecipeFitIssues`). A test holds every committed recipe to that; shrink
or move a word that crowds its frame, or redraw the mark.

## Concept icons

`src/concepts.ts` lists generic concepts diagrams draw by hand: a database, a
queue, a user. They are not brand marks and have no SVG. The build transcribes
each concept's Lucide icon (`lucide-static`, ISC) into a recipe, primitive by
primitive, squaring small rounded corners. A concept Lucide draws poorly at
node-logo size has its own recipe under `recipes/concepts/` instead. The build
fails when a concept needs more than a recipe's 8 parts or shares a mark's slug.
Icon search returns concepts so an agent can attach one by slug, but no label
fills one in.

Every concept and brand recipe must stay readable at 28 px with the scene's
2-unit pen. Fewer, bolder strokes beat detail: cut parts or drop a concept
rather than thin its lines.

## Uploaded logos and look-alikes

`sanitizeSvg` makes an untrusted SVG safe to rasterize (drawing elements and
presentation attributes only, references inside the document, an explicit
viewBox) and reads the exact paint colors it uses. `markFeatures` measures a
mark drawn on white paper: its ink box, dominant colors and an 8x8 coverage
grid. `@sketchi/icon-catalog/look-alikes` keeps those features for every node
logo in `src/generated/look-alikes.json` and ranks the marks a new logo most
resembles, which the icon draw service shows its judge. A test fails when a
mark's source changes without the index; regenerate it with
`pnpm nx generate-look-alikes icon-catalog`.

## Light and dark surfaces

`pnpm nx generate-catalog icon-catalog` renders every SVG on a transparent
canvas and classifies it (`src/color-mode.ts`): `mono-dark` or `mono-light`
for one neutral ink, `multicolor` for brand colors. `onDark` and `onLight` name
what keeps a mark visible on a surface it would blend into: `invert` for a
neutral mark, `plate` for a multicolor one, whose colors are never changed. A
backdrop tile that blends in leaves the mark drawn on it, and paint enclosed
by other paint reads as a cutout, so neither alone calls for treatment. A test
fails when a source changes without the manifest.

## Commands

```sh
pnpm nx generate-catalog icon-catalog
pnpm nx generate-look-alikes icon-catalog
pnpm nx test icon-catalog
pnpm nx typecheck icon-catalog
pnpm nx build icon-catalog
```

Artwork attribution and mark-removal policy: [NOTICE.md](./NOTICE.md).
