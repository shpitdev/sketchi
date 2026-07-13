# SVG → Excalidraw conversion package plan (post pressure-test)

Status: pressure-tested and corrected; supersedes the draft in `.memory/`.
Verdict on the draft architecture: **viable with named corrections** — no fatal
flaw, but the spike scope, one architecture contradiction, and several missing
dependencies had to be fixed before implementation. This document is the
corrected plan of record.

## Product requirement (unchanged)

A self-contained conversion package that accepts curated SVG icons and produces
two deliberately different first-class outputs:

1. a hand-drawn SVG that remains an SVG asset; and
2. an editable, native Excalidraw library item made from Excalidraw elements —
   not an SVG or raster image embedded in an `image` element.

Both outputs expose a meaningful, deterministic sketch/roughness control. The
native output must import into the real Excalidraw editor and remain
selectable, editable, recolorable, scalable, groupable, and serializable.

## Evidence the corrections rest on

Census of all 1,412 corpus SVGs (`apps/icons/public/output/upload-ready/svg`):

| Feature                            | Files                                                           | Implication                                                                                     |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| fill-only (no `stroke` attr)       | 1,314 (93%)                                                     | filled polygons are the primary case, not stroked lines                                         |
| `fill-rule` / `evenodd`            | 712 / 670 (~47%)                                                | even-odd declarations are common; actual hole topology must be measured by the canonical parser |
| `<path>` elements per file         | p50=2, p90=6, max=1,716                                         | parsing, decomposing, and budgeting path-heavy icons is a core operation                        |
| `clip-path`                        | 282, of which 259 are the trivial full-canvas `M0 0h100v100H0z` | strip verified trivial clips in normalize; 26 files have a real clip                            |
| gradients (unique files)           | 161 (~11%; 146 linear + 33 radial, 18 overlap)                  | flatten-to-representative-color is worth building, not rejecting                                |
| `<style>` blocks                   | 130                                                             | a CSS declaration-subset parser is required, not optional                                       |
| masks / filters / `<use>` / raster | 20 / 11 / 11 / 2                                                | masks, filters, and raster block; use is bounded and resolved where safe                        |
| `<text>`                           | 0                                                               | text-to-path is out of scope entirely                                                           |
| generated wrapper `transform`      | 1,412 (all); 74 also contain other transforms                   | compose the wrapper and all nested transforms during normalization                              |

`@excalidraw/excalidraw@0.18.1` (installed, verified against dist types):

- Exports `convertToExcalidrawElements` (accepts `regenerateIds: false`),
  `restoreElements`, `serializeLibraryAsJSON`, `loadLibraryFromBlob`,
  `exportToSvg`. Line skeletons take `Partial<ExcalidrawLinearElement>`, so
  points, seed, colors, and groupIds can all be supplied deterministically.
- Linear elements have **no `polygon` flag** in 0.18.1; closure means repeating
  the first point. Closed-line fill must be verified in the spike.
- The prod bundle fails to import in plain Node (JSON import-attribute error
  via `open-color`); it works under bundlers and vitest jsdom/browser modes.

v1 ground truth (`sketchi/apps/web/src/lib/icon-library`): the freedraw trace
has inert roughness, hardcoded `#000000`, browser-only sampling, and
non-deterministic ids/seeds. Additional defect to carry as a regression
fixture: continuous `getPointAtLength` across `M` subpath moves draws spurious
connecting strokes between disjoint subpaths.

v2 ground truth: no SVG tooling exists; `packages/diagram-excalidraw` already
hand-builds deterministic raw elements (`elementBase()`, FNV-hash seeds,
`fractional-indexing`, `createExcalidrawFile`, geometric validation).
Visual regression is Chromatic, currently wired only for `diagram-studio-ui`.

## Adopted decisions

1. **Holes stay holes.** Recoloring an imported icon must keep letter counters
   transparent. Candidate strategies are keyhole bridging (slit connecting hole
   to outer contour, one self-touching polygon per fill region) and even-odd
   region decomposition into disjoint simple polygons. Boolean clipping alone
   is insufficient: decomposition must actually eliminate interior rings (for
   example through constrained triangulation or another proven simple-polygon
   decomposition) before Excalidraw element construction. Ring stacking
   (background-colored hole painted on top) is rejected: it breaks recoloring
   and any non-uniform canvas. The spike picks between keyhole and
   decomposition with fixture evidence.
2. **Construction path: hand-built elements, Excalidraw as oracle.** The core
   emits final element JSON itself, reusing the proven `diagram-excalidraw`
   conventions (elementBase, FNV seeds, fractional indexing), keeping the
   conversion path DOM-free and the corpus CI run in fast node vitest.
   `@excalidraw/excalidraw` is a test-time oracle: `restoreElements`
   round-trip, `exportToSvg` rendering, `loadLibraryFromBlob`, under vitest
   jsdom/browser mode. The proof contract is therefore "element construction
   typed against `@excalidraw/excalidraw` types and proven by restore
   round-trip in CI", not "no hand-maintained schema".
3. **Hard files ship sketch-SVG-only.** The ~50 files using real clips, masks,
   filters, or embedded raster get capability diagnostics and a visible
   "no native trace" state in the product; an image-element fallback exists
   only behind an explicit caller opt-in and is never labeled a native trace.

## Package boundary (unchanged)

`packages/svg-excalidraw` as `@sketchi/svg-excalidraw`. Conversion only: no
React, routes, fetching, catalog state, or UI. `apps/icons` owns selection,
preview controls, progress, downloads, and copy.

```ts
parseSvg(source, options) -> SvgParseResult
renderSketchSvg(document, options) -> SketchSvgResult
convertSvgToExcalidraw(document, options) -> ExcalidrawTraceResult
serializeExcalidrawLibrary(items, options) -> string
inspectSvgCapabilities(document) -> SvgCapabilityReport
```

All results include typed warnings/errors, source metadata, deterministic
metrics, and effective options.

## Dependencies

- `svg-pathdata` for path parsing/normalization; a small XML parser.
- Polygon boolean operations for real clip intersection, plus a proven
  simple-polygon decomposition or constrained-triangulation strategy that
  eliminates interior rings for native hole handling. A clipping library such
  as `polygon-clipping`/martinez does not solve hole elimination by itself.
- A CSS declaration-subset parser (tiny, possibly hand-rolled given the
  normalizer's uniform output) — 130 corpus files require it.
- Color parsing for gradient flattening.
- `roughjs` pinned compatible with Excalidraw's bundled 4.6.x so sketch-SVG and
  native output stay visually consistent.
- `@excalidraw/excalidraw` declared directly by the new package (runtime or dev
  scope according to the final import boundary) for its types and test oracle.
- No browser DOM in the core conversion path.

## Slice 0 — fill-first spike (blocking)

Implementation status: complete in `packages/svg-excalidraw`. The accepted
decision is recorded in
`docs/adr/0001-svg-excalidraw-native-fill-representation.md`. Representation and
hole strategy are accepted; the measured 256/4,096 point thresholds remain
provisional until representative corpus evidence supports enforceable budgets.

Minimal package skeleton plus throwaway IR. Fixtures from the real corpus: a
wordmark with letter counters (e.g. `ai-model-providers/ai21labsai.svg`), a
multi-color icon, a gradient icon, a `<style>`-driven icon, a real-clip icon, a
stroke-only icon, the v1 multi-subpath artifact case, and
`operating-systems/linux.svg` (474 KB genuine vector) as stress.

Measure, in the real Excalidraw renderer:

- keyhole-bridge vs even-odd decomposition × roughness 0/1/2 × fillStyle
  solid/hachure;
- closed-line fill behavior without a `polygon` flag at all roughness levels;
- point-budget vs roughness legibility: the maximum points per element at which
  roughness 1–2 still reads as hand-drawn rather than per-segment fuzz, and
  whether `roundness` (curved lines) permits sparser points;
- determinism: byte-identical output across two runs and across node/browser.

Exit artifact: a support matrix plus an ADR fixing the native representation,
hole strategy, point-threshold evidence/status, and confirmation of the
hand-built construction path. Hard budgets require representative follow-up
evidence. No product UI before this proof.

## Delivery slices after the spike

1. **IR + diagnostics.** **Complete in Slice 1.** The accepted boundary is
   recorded in `docs/adr/0002-svg-canonical-ir-and-capability-diagnostics.md`. `parseSvg` /
   `inspectSvgCapabilities`: XML + CSS-subset
   parsing, `<use>` resolution, trivial-clip stripping, inherited paint,
   conversion of `rect`/`circle`/`ellipse`/`line`/`polyline`/`polygon` into
   canonical geometry, complete nested transform composition, absolute
   canonical subpaths with closure/winding/paint/opacity/identity, and adaptive
   output-space flattening (including direct bounded SVG arcs) measured against
   the ADR's provisional thresholds. Recursive use expansion has deterministic
   depth/expansion/shape budgets; safe numeric symbol viewports are mapped and
   all unrepresented symbol clipping blocks. Unsupported advanced stroke
   properties, CSS at-rules/nesting, applied masks/filters, and non-trivial
   clips are blocking diagnostics.
   Corpus census tests use
   explicitly defined, deduplicated file-level metrics so corpus drift is
   caught.
2. **Native backend + serialization.** **Complete in Slice 2.** The accepted
   boundary is recorded in
   `docs/adr/0003-svg-native-conversion-and-library-serialization.md`. Deterministic element construction per
   the ADR (reusing `diagram-excalidraw` conventions), grouping per icon, color
   preservation plus an explicit monochrome profile, gradient flattening,
   `serializeExcalidrawLibrary` proven by `loadLibraryFromBlob` /
   `restoreElements` round-trip. An affected-only full-corpus CI run producing an untracked
   workflow artifact (success, warnings, unsupported features, point/element
   counts, time, size vs budgets) plus the silhouette metric: native output via
   `exportToSvg` → rasterize → fill-region IoU against the normalized source at
   roughness 0, thresholds tuned on fixtures. The production gate additionally
   blocks unsafe nonzero planar topology rather than returning partial geometry:
   1,114 files convert and 298 are blocked after capability overlap.
3. **Sketch-SVG backend.** RoughJS direct; colors preserved by default with a
   monochrome profile; roughness, bowing, stroke width, fill style, seed;
   `svg2roughjs` retained only as a temporary parity oracle, then removed.
4. **Product integration.** `apps/icons`: three-way preview (original / sketch
   SVG / native) with the same controls and seed used for export,
   `.excalidrawlib` download, capability badges for sketch-SVG-only files.
   Storybook fixture stories with a Chromatic target for the new surface.
   Browser proof: import the exported library into the real editor, then
   edit / recolor / group→ungroup→recolor→regroup / move / save / reload /
   re-export. Deleting the v1 converter belongs to the eventual one-shot
   migration PR in `shpitdev/sketchi`, not a slice in this fork.

Each slice is a logical Graphite PR with Nx gates, Storybook, browser proof,
autonomous merge after green review/CI, and worktree cleanup.

## Proof contract (tightened)

Structural: typed construction validated against `@excalidraw/excalidraw`
types; `restoreElements` and library serialization round-trip; no `image`
element unless the caller explicitly selected fallback mode; deterministic
ids/seeds/output — byte-identical across runs and across node/browser; bounds,
finite coordinates, closure, ordering, grouping, and ADR complexity budgets.

Visual: native output rendered through Excalidraw's own export API; fill-region
IoU vs normalized source at roughness 0; roughness 0/1/2 visibly distinct
without topology or bounds changes; golden fixture stories under Chromatic with
thresholds that separate intended sketch variation from lost geometry.

Corpus: all icons through both backends in affected-only CI, with the complete report uploaded as a workflow artifact and never checked in;
a regression set covering every supported feature and every
fallback/diagnostic class, including the stroke-only profile (96 files),
multi-color preservation, and the v1 multi-subpath artifact.

Product/browser: side-by-side preview parity with export, real-editor
import/edit proof, desktop and mobile UI plus worker preview. Custom domains
stay out of scope until the fork merges into the original repository.
