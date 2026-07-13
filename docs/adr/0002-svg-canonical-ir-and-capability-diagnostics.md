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

## Reproduction

Representative fixtures cover counters, gradients, style-driven paint, real
clips, stroke-only and disjoint paths, multicolor icons, and a large stress
vector across multiple flattening tolerances. Tests validate parser policy,
geometry, diagnostics, deterministic output, and warning-only point budgets
directly rather than comparing generated aggregate evidence.

The affected-only corpus renderer described by ADR 0003 supplies broad drift
coverage and uploads its complete report from CI without checking it into source.

## Consequences

Slice 2 can consume one typed, deterministic canonical document for native
construction and serialization. Capability policy is centralized in
`inspectSvgCapabilities`; product code does not need feature sniffing.

The core stays synchronous, pure, and DOM-free. Effect is used elsewhere in the
repository for service workflows, but adding an Effect runtime to deterministic
in-memory SVG normalization would add no typed dependency or resource boundary.

Real clip intersection, masks, filters, patterns, embedded raster, exact SVG
group compositing semantics, and product UI remain outside Slice 1.
