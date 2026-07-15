# SVG → Excalidraw conversion package plan (post pressure-test)

Status: pressure-tested and corrected; supersedes the draft in `.memory/`.
Verdict on the draft architecture: **viable with named corrections** — no fatal
flaw, but the spike scope, one architecture contradiction, and several missing
dependencies had to be fixed before implementation. This document is the
corrected plan of record.

## Product requirement

The current vertical is a self-contained conversion package that accepts
curated SVG icons and produces an editable, native Excalidraw library item made
from Excalidraw elements — not an SVG or raster image embedded in an `image`
element. It exposes deterministic roughness and fill controls, imports into the
real Excalidraw editor, and remains selectable, editable, recolorable, scalable,
groupable, and serializable.

A second hand-drawn SVG output was part of the original draft, but is explicitly
not required for this vertical. It remains deferred unless product evidence
shows a need that native elements cannot meet; the implementation must not add a
parallel Sketch-SVG system speculatively.

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
3. **Hard files remain fail-closed.** Files using real clips, masks, filters,
   embedded raster, or other semantics that the native backend cannot preserve
   get capability diagnostics and a visible "no native trace" state. The first
   product vertical ships native output only; Sketch-SVG is deliberately
   deferred and is not a fallback for blocked files.

## Package boundary (unchanged)

`packages/svg-excalidraw` as `@sketchi/svg-excalidraw`. Conversion only: no
React, routes, fetching, catalog state, or UI. `apps/icons` owns selection,
preview controls, progress, downloads, and copy.

```ts
parseSvg(source, options) -> SvgParseResult
convertSvgToExcalidraw(document, options) -> ExcalidrawTraceResult
serializeExcalidrawLibrary(items, options) -> string
inspectSvgCapabilities(document) -> SvgCapabilityReport
```

All results include typed warnings/errors, source metadata, deterministic
metrics, and effective options.

## Dependencies

- `svg-pathdata` for path parsing/normalization; a small XML parser.
- `clipper-lib` for deterministic nonzero planar union/decomposition, plus
  keyhole conversion for resulting holes. Earcut remains the independent
  hole-eliminating triangulation oracle; polygon union alone does not eliminate
  interior rings.
- A CSS declaration-subset parser (tiny, possibly hand-rolled given the
  normalizer's uniform output) — 130 corpus files require it.
- Color parsing for gradient flattening.
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
   originally blocked unsafe nonzero planar topology rather than returning
   partial geometry: 1,114 files converted and 298 were blocked after
   capability overlap. The native-coverage follow-up decomposes arbitrary
   nonzero crossings and self-intersections with deterministic nonzero planar
   union, raising the current corpus to 1,327 native-capable files with 85
   blocked. The exact-integer determinant cap plus independent post-union fill
   and hole-survival validation deliberately block four files that the earlier
   1,331/81 report accepted without sufficient proof. Integer-unsafe or
   unverified decomposition and unsafe keyhole bridges still fail closed.
3. **Sketch-SVG backend (deferred).** The native corpus and renderer gates are
   strong enough to ship the first product vertical without a parallel
   Sketch-SVG system. No Sketch-SVG API or RoughJS dependency ships in this
   package. Reconsider a second backend only if product evidence identifies a
   user need that editable native elements cannot meet.
4. **Product integration.** `apps/icons`: lazy original/native preview with
   supported, warned, and blocked capability states; roughness, fill, and color
   controls; deterministic `.excalidrawlib` download; and a reload-safe URL
   handoff to the existing `apps/excalidraw` workspace. The Excalidraw Worker
   accepts only allowlisted public Sketchi icon SVG URLs and reconverts them in
   the browser. The Icons Worker grants wildcard CORS only to
   `/output/upload-ready/svg/*`; no scene payload or new hosted service is
   introduced. Storybook covers each capability state and the editable
   workspace. Browser proof covers control parity, deterministic download,
   cross-worker fetch, and real-editor tool interaction. The retired converter
   is intentionally absent from the canonical `shpitdev/sketchi` tree.

Each slice is a logical Graphite PR with Nx gates, Storybook, browser proof,
autonomous merge after green review/CI, and worktree cleanup.

## Proof contract (tightened)

Structural: typed construction validated against `@excalidraw/excalidraw`
types; `restoreElements` and library serialization round-trip; no `image`
fallback element—unsupported semantics fail closed; deterministic
ids/seeds/output — byte-identical across runs and across node/browser; bounds,
finite coordinates, closure, ordering, grouping, and ADR complexity budgets.

Visual: native output rendered through Excalidraw's own export API; fill-region
IoU vs normalized source at roughness 0; roughness 0/1/2 visibly distinct
without topology or bounds changes; golden fixture stories under Chromatic with
thresholds that separate intended sketch variation from lost geometry.

Corpus: all icons through the canonical parser and native backend in
affected-only CI, with the complete report uploaded as a workflow artifact and
never checked in; representative regression fixtures cover supported features
and blocked diagnostic classes.

Product/browser: original/native preview parity with export, real-editor
import/edit proof, desktop and mobile UI plus worker preview. Custom-domain
operations follow the repository's production cutover runbook.
