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
fill and source-stroke elements.

Capability inspection blocks crossing, touching, or self-intersecting
`nonzero` contours and unsafe keyhole bridges before construction. Even-odd
compound paths stay in one native line connected by transparent, zero-area
bridges, preserving parity instead of decomposing intersecting rings. This is a
deliberate correction from the parser-only capability boundary, not silent
geometry loss. Supporting unsafe files requires a proven general planar
decomposition, which is deferred.

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

## Consequences

Apps consume one fail-closed API and never infer support from partial elements.
Native output contains no image elements and remains grouped per icon,
selectable, recolorable, scalable, and serializable. The core conversion and
serializer stay synchronous, pure, and DOM-free; Effect and hosted rendering
infrastructure are unnecessary.

Real clips, masks, filters, patterns, embedded raster, and unsafe nonzero
planar topology remain blocked. Sketch-SVG remains deferred and is not required
for the approved native product vertical.
