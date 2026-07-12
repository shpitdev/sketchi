# ADR 0002: Canonical SVG IR and capability diagnostics

Date: 2026-07-11
Status: Accepted for Slice 1

## Context

Slice 0 intentionally used a throwaway parser with fixed eight-segment curve
sampling and a small paint/transform subset. That was enough to select native
closed lines, keyhole hole bridges, and triangulation as the comparison oracle,
but it was not a safe production boundary. The icon corpus also contains
stylesheet paint, nested transforms, SVG primitives, `<use>`, gradients, clips,
masks, filters, patterns, and embedded images. Silent omission would incorrectly
label incomplete geometry as native-editable.

## Decision

`parseSvg` is the only parser exported by `@sketchi/svg-excalidraw`. The spike
parser and spike export barrel are deleted; there is no compatibility alias or
parallel normalization path.

The canonical document contains absolute, fully transformed subpaths with
explicit source closure, signed winding, resolved fill/stroke/opacity, fill
rule, transformed scalar stroke width, stable source identity, structured
diagnostics, feature counts, and deterministic metrics. `parseSvg` returns a
discriminated `SvgParseResult`, so malformed XML and non-SVG roots are typed
boundary failures rather than thrown parser errors.

The supported CSS subset implements presentation attributes, simple type/id/
class and descendant selectors, compound selectors, comma lists, specificity,
source order, `!important`, inline styles, `currentColor`, and inherited paint.
CSS at-rules, nesting, unsupported selectors, and applied stroke semantics that
the IR cannot preserve (`stroke-dasharray`, caps, joins, miter limits, dash
offsets, markers, paint order, and vector effects) are explicit blocking
diagnostics. Transform composition supports matrix, translate, scale, rotate
(including a center), skewX, and skewY at every nested level; tokens and
operation arities are validated before an operation is applied.

`<use>` resolves local fragment references recursively, composes use x/y and
transforms, carries inherited paint into the referenced tree, and detects
missing references and cycles. Repeated instances retain stable, distinct
source paths and shape identities. Recursive expansion is bounded by default at
64 nested references, 10,000 expanded references, and 20,000 output shapes
(caller limits are themselves capped); exhausting any budget stops traversal
deterministically and blocks native tracing. A referenced `<symbol>` maps its
numeric width/height and viewBox with `none`, `meet`, or `slice` alignment.
Percentage/automatic dimensions, symbol-level positioning/transforms, and the
default clipped symbol viewport block instead of emitting silently incorrect
geometry; an explicitly `overflow="visible"` symbol needs no implicit clip and
is supported.

The known normalized full-canvas clip (`M0 0h100v100H0z`, including the corpus
0.001-coordinate tolerance) and exact root-viewBox rectangles are removed with
an informational diagnostic. Every other clip remains attached to canonical
shapes and blocks native tracing. We deliberately do not erase a non-canvas
clip merely because flattened sample points happen to fall inside it; an
unsampled source curve could cross the boundary. The classifier applies CSS
display/visibility semantics to clip children and verifies axis-aligned edge
topology, so hidden shapes and self-intersecting corner sets are never mistaken
for trivial rectangles. Applied mask/filter attributes block even when their
URL is external or missing. Masks, filters, patterns, images, text, unsupported
rendered elements, and unresolved use references are also blocking diagnostics.

Cubic curves are adaptively subdivided after the complete transform stack,
using a default 0.5-unit output-space tolerance and maximum depth 18. SVG arcs
are subdivided directly from the exact elliptical parameterization: for
`p(theta)=c+u*cos(theta)+v*sin(theta)`, the implementation uses
`|p''| <= |u|+|v|` and the linear-interpolation bound `M*h^2/8` to include source
arc approximation error in the requested tolerance. Reaching the depth-derived
segment limit emits a blocking diagnostic. Circle and ellipse primitives use
the same exact parameterization, while rounded rectangles lower to exact arc
commands before subdivision.

Diagnostics use an explicit UTF-16 code-unit comparator, never locale
collation. The non-ASCII ordering fixture is checksum-locked in both Node and
Chromium.

## Point-budget evidence

The checked representative matrix covers a counter-bearing wordmark, gradient,
style-driven paint, real clip, stroke-only icon, disjoint multipath, multicolor
icon, and the 474 KB Linux stress vector at tolerances 0.25, 0.5, and 1.0.

At the selected 0.5 tolerance, the AI21 counter uses 108 native points and keeps
its measured hole transparent in every roughness/fill oracle combination. The
Linux fixture uses 31,888 native points with a maximum of 98 points in any one
element. This is 65% fewer total points than Slice 0's fixed-density 92,105,
while still exceeding the provisional 4,096-point icon budget because it has
1,717 native elements. The evidence therefore supports adaptive flattening and
the 0.5 default, but not a hard rejection or simplification threshold. The point
change from the earlier evidence is expected: direct arc subdivision now proves
the tolerance against source arcs rather than an intermediate cubic estimate.

The existing 256 points per element and 4,096 points per icon remain diagnostic
only. The representative set has no per-element breach; Linux is the sole
per-icon breach at all three tested tolerances. Future native-backend visual
corpus work must establish enforceable budgets.

## Corpus evidence

The checked census is file-deduplicated across all 1,412 SVGs. It finds 282 clip
files, including 259 known full-canvas clips and 26 files with at least one real
clip (some files contain both); 161 gradient, 130 style, 20 mask, 11 filter, 11
use, two image, and two pattern files. Sixteen files apply advanced stroke
semantics that the native IR cannot preserve. Under the corrected Slice 1
boundary, 1,342 files are native-capable and 70 produce a blocking diagnostic.
Counts are asserted in tests so corpus or parser-policy drift is visible.

## Consequences

Slice 2 can consume one typed, deterministic canonical document for native
construction and serialization. Capability policy is centralized in
`inspectSvgCapabilities`; product code does not need feature sniffing.

The core stays synchronous, pure, and DOM-free. Effect is used elsewhere in the
repository for service workflows, but adding an Effect runtime to deterministic
in-memory SVG normalization would add no typed dependency or resource boundary.

Real clip intersection, masks, filters, patterns, embedded raster, exact SVG
group compositing semantics, and product UI remain outside Slice 1.
