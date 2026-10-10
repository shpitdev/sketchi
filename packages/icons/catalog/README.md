# icon-catalog

The Sketchi icon library: manifest, ranked search, SVG sources, and the rules
for embedding marks inside diagram nodes.

| Owns                                          | Does not own                     |
| --------------------------------------------- | -------------------------------- |
| SVG sources under `svg/`                      | HTTP routes, MCP, or browser UI  |
| icon pipeline output under `pipeline-output/` | where an app publishes the files |
| generated manifest and slug-to-source map     | diagram layout or Excalidraw     |
| ranked search and node-logo eligibility       |                                  |

## Entry points

- `@sketchi/icon-catalog`: manifest types and decoding, `searchIcons`,
  `isNodeLogoEligible`, and `normalizeNodeLogoSvg`. It carries no catalog data,
  so browser code can import it.
- `@sketchi/icon-catalog/catalog`: the generated catalog (`iconManifest`,
  `getIconBySlug`, `getIconSourcePath`, `getIconSourceFile`, `nodeLogoIcons`).

## Data flow

`pipeline-output/review/review-data.json` is the pipeline source.
`pnpm nx generate-catalog icon-catalog` turns it into
`src/generated/icon-catalog.json`: the public manifest plus a private
slug-to-source map. Duplicate source slugs are resolved by the explicit
canonical map in `src/manifest-generation.ts`; generation fails when a new
collision has no explicit choice, so public slugs stay deterministic.

Apps publish the SVGs themselves. `apps/icons` copies `svg/` to its public
`/output/upload-ready/svg/` path at build time.

## Node logos

Diagrams embed only compact marks: no `-text` wordmarks and no source over
`NODE_LOGO_MAX_BYTES` (64 KB). `normalizeNodeLogoSvg` adds the intrinsic
`width` and `height` from the viewBox, because browsers size a viewBox-only SVG
image as 300x150 and distort it when drawing into a square.

## Commands

```sh
pnpm nx generate-catalog icon-catalog
pnpm nx test icon-catalog
pnpm nx typecheck icon-catalog
pnpm nx build icon-catalog
```
