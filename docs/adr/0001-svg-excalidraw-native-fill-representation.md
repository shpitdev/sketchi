# ADR 0001: Native Excalidraw filled-geometry representation

Date: 2026-07-11
Status: Accepted for Slice 0; product integration remains blocked

## Context

Excalidraw 0.18.1 has no polygon element or polygon flag. Native editable SVG
fills therefore need to use closed `line` elements. SVG counters and holes must
remain transparent after recoloring and on non-uniform canvases. Painting a
background-colored inner ring is invalid. Polygon boolean clipping can produce
rings, but it does not eliminate those rings and therefore does not solve native
hole representation by itself.

SVG fill implicitly closes every subpath, whether or not path data includes a
`Z`. SVG's default `nonzero` fill rule also depends on accumulated contour
winding; nested contours are not automatically holes as they are under
`evenodd`.

Slice 0 compared two representations through Excalidraw's real
`restoreElements` and `exportToSvg` path using the corpus AI21 wordmark counter:

1. a keyhole polygon whose zero-width bridge is traversed in both directions;
2. Earcut triangulation that eliminates every interior ring and emits only
   simple closed triangles.

Both strategies were exercised at roughness 0, 1, and 2 with solid and hachure
fill. Representative oracle tests preserve the behavior directly; generated raw
measurements are not source artifacts.

## Decision

Use hand-built, deterministic, closed Excalidraw `line` elements. Closure is a
repeated first point. IDs, seeds, version nonces, fractional indices, grouping,
and JSON property order are stable. Excalidraw remains the restore/render test
oracle.

Use keyhole bridging for native holes. Keep true hole-eliminating triangulation
as the comparison oracle and a possible future fallback, not as the default.
At roughness 1 with solid fill, the fully retained AI21 geometry required 4
elements / 287 points / 37,285 rendered SVG bytes with keyholes versus 275
elements / 1,100 points / 189,402 bytes with triangulation. Hachure was 33,531
bytes versus 196,570 bytes.
All 12 strategy/roughness/fill combinations left the measured counter center
fully transparent.

Treat every filled subpath as implicitly closed while preserving its original
open/closed state for stroke emission. When an open subpath has both fill and
stroke, use only a minimal fill-colored carrier stroke on the closed fill
element and emit the source stroke as its own open line. This prevents the
source stroke from appearing on the synthetic implicit-closing edge. Classify
`evenodd` regions by nesting parity. Classify non-intersecting `nonzero`
contours by accumulated signed winding: only a nonzero-to-zero transition is a
hole, and same-winding nested contours do not cut one. The later native-coverage
slice supersedes the spike's unsupported-topology policy for intersecting,
touching, and self-intersecting nonzero contours: those contours now use a
deterministic nonzero planar union and fail closed when integer-safe
decomposition cannot preserve their topology.

Do not use background-colored ring stacking. Do not claim polygon boolean
clipping solves holes; a clip result with interior rings still needs keyhole
conversion or actual simple-polygon decomposition/triangulation.

Use sharp linear segments by default. Excalidraw `roundness: { type: 2 }` did
not permit sparser circle samples in this experiment: at 16, 32, and 64 points,
curved-line IoU was lower than sharp-line IoU.

Retain these provisional diagnostic thresholds for further research:

- 256 points per Excalidraw element, including the repeated closure point;
- 4,096 points per icon across all native elements.

The synthetic circle matrix shows that roughness-2 solid output grows from
32,535 bytes / 0.9630 IoU at 256 points to 64,475 bytes / 0.9411 IoU at 512
points. That is useful cost evidence, but one synthetic geometry family is not
representative enough to establish a production hard cap. Exceeding either
threshold therefore emits a diagnostic; it does not authorize rejection or
automatic simplification.

After honoring implicit fill closure, the genuine Linux stress fixture retains
all 1,584 open-only filled shapes. Its 474,098 bytes and 1,716 path elements
construct 92,105 points, rather than the invalid earlier count of 6,220. This
confirms that the fixture is a useful stress case, but does not validate 4,096
as a hard icon budget.

## Capability policy

- Preserve direct and style-derived solid colors.
- Flatten gradients to one deterministic representative color in the spike and
  report the limitation.
- Preserve stroke-only input as transparent-background lines.
- Scale stroke widths into scene units under transforms. Uniform scale and
  rotation are exact; the throwaway scalar IR uses determinant area scale as a
  deterministic approximation for non-uniform transforms.
- Honor implicit fill closure independently of stroke closure.
- Separate source strokes from implicitly closed fill carriers for open paths.
- Honor `evenodd` and nested/disjoint `nonzero` winding classification. The
  native-coverage slice supersedes the earlier restriction on other nonzero
  contour topology with deterministic planar decomposition and fail-closed
  quantization checks.
- Treat real clips as native-unsupported until a later slice implements clip
  intersection and then applies the selected hole strategy to any resulting
  rings. Sketch-SVG is deliberately deferred and is not a shipped fallback.
- Keep disjoint SVG subpaths as separate elements; never sample continuously
  across an `M` move.
- Report provisional threshold excess with diagnostics. Later representative
  corpus evidence and adaptive simplification experiments must establish any
  enforceable caps.

## Consequences and residual risks

Keyholes minimize element and byte growth but introduce a coincident bridge
edge. Extreme scaling, aggressive simplification, or future renderer changes
could expose that slit, especially with hachure. Slice 1 must expand the corpus
hole set and retain raster topology checks.

Triangulation proves that holes can be eliminated into simple polygons, but it
multiplies editable elements and introduces internal triangle boundaries. It is
not selected for the default representation.

The throwaway parser samples curves at a fixed density and supports only the
feature subset needed for the spike. Its original nested-or-disjoint nonzero
assumption is superseded by the native-coverage slice's planar decomposition;
non-uniform transformed stroke widths remain scalar approximations. This is
evidence infrastructure, not the production normalization API.

## Go / no-go

Go for Slice 1: canonical IR and capability diagnostics may proceed using the
selected representation and hole strategy. Slice 1 must gather representative
corpus evidence before promoting point thresholds to hard budgets.

No-go for production rejection/simplification at the provisional thresholds,
product UI, or claims of full native corpus support. Real clips, production
adaptive flattening, complete transform/CSS semantics, masks, filters, and
full-corpus topology proof remain later work.
