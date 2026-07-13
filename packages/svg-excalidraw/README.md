# `@sketchi/svg-excalidraw`

Self-contained SVG-to-native-Excalidraw conversion boundary. The parser and
production native backend are synchronous, pure, deterministic, and DOM-free:

```ts
const parsed = parseSvg(source, {
  sourceName: "icon.svg",
  flattening: { tolerance: 0.5 },
  useExpansion: { maxDepth: 64, maxExpansions: 10_000, maxShapes: 20_000 },
});

if (parsed.ok) {
  const capabilities = inspectSvgCapabilities(parsed.document);
  const converted = convertSvgToExcalidraw(parsed.document, {
    roughness: 1,
    fillStyle: "solid",
    colorProfile: { kind: "preserve" },
  });

  if (converted.ok) {
    const library = serializeExcalidrawLibrary([
      {
        id: `svg:${converted.sourceHash}`,
        name: "icon.svg",
        elements: converted.elements,
      },
    ]);
  }
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

The selected native representation is deterministic closed Excalidraw `line`
elements with repeated-first-point closure and keyhole bridges for holes. Native
conversion fails closed for blocked semantics and never returns partial output.
Source colors are preserved by default, with an explicit monochrome profile;
gradient flattening and provisional point-budget excess remain typed warnings.
True triangulation remains the renderer comparison oracle.

`.excalidrawlib` serialization emits stable Excalidraw v2 JSON directly without
loading Excalidraw's browser bundle. Real Excalidraw loading, restore, export,
and Chromium are test oracles only.

Architecture decisions:

- `docs/adr/0001-svg-excalidraw-native-fill-representation.md`
- `docs/adr/0002-svg-canonical-ir-and-capability-diagnostics.md`
- `docs/adr/0003-svg-native-conversion-and-library-serialization.md`

Run the fast package proof, including representative fixtures and Chromium
cross-runtime determinism, with:

```sh
pnpm nx run svg-excalidraw:typecheck
pnpm nx run svg-excalidraw:test
pnpm nx run svg-excalidraw:build
```

The full corpus renderer is intentionally separate. It writes an untracked JSON
report under `.memory/svg-native-corpus/`; CI runs it only when this package or
the corpus inputs are affected and uploads that directory as an artifact:

```sh
pnpm nx run svg-excalidraw:corpus-renderer
```
