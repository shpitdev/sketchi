# `@sketchi/svg-excalidraw`

Self-contained SVG-to-native-Excalidraw conversion boundary. Slice 1 replaces
the fill-spike parser with one production canonical IR path:

```ts
const parsed = parseSvg(source, {
  sourceName: "icon.svg",
  flattening: { tolerance: 0.5 },
  useExpansion: { maxDepth: 64, maxExpansions: 10_000, maxShapes: 20_000 },
});

if (parsed.ok) {
  const capabilities = inspectSvgCapabilities(parsed.document);
}
```

The parser is synchronous and DOM-free. It validates XML, resolves the supported
CSS cascade and inherited paint, expands `<use>` references, composes complete
transform lists, converts SVG primitives to absolute canonical subpaths, strips
known full-canvas clips, maps the safe `<symbol>` viewport subset, and
adaptively flattens cubics and exact elliptical arcs (including circle/ellipse
primitives) in final output space. Recursive `<use>` expansion is
deterministically budgeted. Unsupported CSS structure,
advanced stroke semantics, implicit symbol clipping, real clips, and applied
masks/filters are blocking structured diagnostics; callers never infer native
support from missing or approximate geometry.

The selected native representation remains deterministic closed Excalidraw
`line` elements with repeated-first-point closure and keyhole bridges for holes.
True triangulation remains the renderer comparison oracle.

Design and checked evidence:

- `docs/adr/0001-svg-excalidraw-native-fill-representation.md`
- `docs/adr/0002-svg-canonical-ir-and-capability-diagnostics.md`
- `docs/svg-excalidraw-slice-1-support-matrix.md`
- `packages/svg-excalidraw/evidence/fill-spike-metrics.json`
- `packages/svg-excalidraw/evidence/slice-1-ir-capability-metrics.json`

Run the complete package proof, including real Chromium determinism, with:

```sh
pnpm nx run svg-excalidraw:typecheck
pnpm nx run svg-excalidraw:test
pnpm nx run svg-excalidraw:build
```
