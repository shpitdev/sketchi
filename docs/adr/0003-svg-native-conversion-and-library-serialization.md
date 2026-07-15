# ADR 0003: Production native conversion and library serialization

Date: 2026-07-12
Status: Accepted for the native product vertical

## Context

Slice 1 established a DOM-free canonical SVG IR and reported 1,342 files as
native-capable at the parser/capability boundary. The Slice 0 constructor could
still omit unsafe nonzero fill topology after that check, and its low-level
strategy/roundness options were not a safe product API. Product integration also
needs byte-stable `.excalidrawlib` output without importing Excalidraw's browser
bundle into conversion code.

## Decision

`convertSvgToExcalidraw` is the production construction boundary. It accepts a
canonical document, applies deterministic defaults, and returns a discriminated
result containing effective options, typed diagnostics, metrics, source
identity, and native line elements. It fixes the production representation to
sharp keyhole geometry; triangulation and alternative roundness remain renderer
oracles, not product controls. Unsupported capabilities fail closed with no
partial elements.

The product profiles are color-preserving and explicit monochrome. Roughness
0/1/2 and solid/hachure fill remain deterministic. Fill-only geometry uses a
0.5-unit carrier stroke rather than the parser's transformed default SVG stroke
width. Full-corpus renderer evidence exposed that defect: transformed defaults
more than doubled the silhouette of small filled regions. Explicit SVG strokes
retain their transformed width, and open fill-plus-stroke paths retain separate
fill and source-stroke elements. Nonzero shapes routed through planar
decomposition also emit every original stroke subpath separately, so unioned
boundaries and winding cancellation cannot erase source stroke segments.

Capability inspection decomposes crossing, touching, or self-intersecting
`nonzero` contours with a deterministic Clipper nonzero planar union. Inputs
are translated to their local bounds origin and initially scaled at 1,000,000
units into a bounded integer domain. The scale increases deterministically when
needed and safe, then the paths are unioned into a PolyTree, converted back into
canonically ordered outer rings and holes, and passed through the existing
keyhole safety gate. Quantization must preserve vertex identity, segment
intersection topology, and winding orientation before conversion proceeds.
The local integer-coordinate limit is 67,108,863: this keeps the two-product
determinants used by the JavaScript Clipper port within
`Number.MAX_SAFE_INTEGER`. The bound is necessary but not sufficient because
Clipper can still report success after dropping thin contours or holes. After
union, independent integer-domain probes compare filled and unfilled coverage
on both sides of every open source-arrangement span. Evidence is never shared
between cells with the same winding value. Coordinates or local detail that
cannot be represented or independently verified, decomposition failures, and
unsafe keyhole bridges remain blocking; construction returns no partial
geometry. Even-odd compound paths stay in one native line connected by
transparent, zero-area bridges, preserving parity without changing their
established representation.

`serializeExcalidrawLibrary` emits Excalidraw v2 library JSON directly from typed
native elements. Stable defaults are `source: "https://sketchi.app"`,
`created: 1`, and `status: "published"`; callers may explicitly replace them.
The serializer is DOM-free, preserves property order, and is byte-identical in
Node and Chromium. Excalidraw's own `loadLibraryFromBlob`, `restoreElements`,
and `serializeLibraryAsJSON` remain test oracles.

The provisional point thresholds remain warning-only; representative fixtures
do not justify destructive simplification or rejection.

## Reproduction

Fast unit and browser tests exercise representative supported and blocked
fixtures, direct conversion invariants, library round-trips, and cross-runtime
determinism. The separate `svg-excalidraw:corpus-renderer` Nx target restores
and renders every native-capable corpus input through Excalidraw at roughness 0,
then compares it to an independently rasterized source SVG. Exports are padded
by the largest element stroke width because Excalidraw geometry bounds exclude
the outer half of a stroke.

The corpus gate validates per-output exact IoU and symmetric foreground overlap
with a fixed two-pixel raster tolerance. It writes the complete per-file report
to `.memory/svg-native-corpus/`. CI runs this target only when
`svg-excalidraw` or its corpus inputs are affected and uploads the report as a
workflow artifact; no generated report is checked in or used as a snapshot.

The native-coverage run classified all 298 baseline blockers by exact blocker
code set. Nonzero topology was the dominant class at 242 files (228 topology
only). Planar decomposition made 213 additional files native-capable, moving
the corpus from 1,114 native / 298 blocked to 1,327 native / 85 blocked after
the integer bound and independent survival validation conservatively
reclassified four otherwise unproven decompositions. Representative former
blockers include `ai-apps-agents/agentvoice.svg` (self-intersection) and
`ai-ecosystem/perplexity.svg` (touching/crossing compound contours); both are
locked in focused conversion and corpus-renderer proof, while AgentVoice also
anchors the byte-identical Node/Chromium decomposition assertion.

## Consequences

Apps consume one fail-closed API and never infer support from partial elements.
Native output contains no image elements and remains grouped per icon,
selectable, recolorable, scalable, and serializable. The core conversion and
serializer stay synchronous, pure, and DOM-free; Effect and hosted rendering
infrastructure are unnecessary.

Real clips, masks, filters, patterns, embedded raster, integer-unsafe nonzero
decomposition, and unsafe keyhole bridges remain blocked. Sketch-SVG remains
deliberately deferred, is not a fallback for blocked files, and is not required
for the approved native product vertical.
