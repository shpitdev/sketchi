# `@sketchi/svg-excalidraw`

Self-contained SVG-to-native-Excalidraw conversion package boundary.

The current code is Slice 0's fill-first blocking spike. It intentionally exposes
only a small canonical IR, deterministic native `line` construction, keyhole and
triangulation experiments, capability diagnostics, and point-budget evidence. It
is not the production parser API from the later slices and has no React, route,
catalog, fetching, or deployment dependency.

The checked decision and measurements live in:

- `docs/adr/0001-svg-excalidraw-native-fill-representation.md`
- `docs/svg-excalidraw-fill-spike-support-matrix.md`
- `packages/svg-excalidraw/evidence/fill-spike-metrics.json`

Run the package proof with:

```sh
pnpm nx run svg-excalidraw:typecheck
pnpm nx run svg-excalidraw:test
pnpm nx run svg-excalidraw:build
```
