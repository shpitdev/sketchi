# diagram-core

Typed contracts, validation, shared drawing rules and fixtures for every Sketchi
diagram family.

Each family (`DIAGRAM_TYPES` in `src/types.ts`) has an Effect Schema contract
and semantic validation under `src/types/`. Flowcharts and mindmaps share the node/edge
`IntermediateDiagram`; every other family keeps its own shape. `CanonicalDiagramSchema`
and `parseCanonicalDiagram` accept any family. `src/rules/` holds the drawing
rules that the generate prompt, the MCP docs and Studio chat all read, so the
three state each rule once.

| Owns                            | Does not own                |
| ------------------------------- | --------------------------- |
| diagram type registry           | model calls or prompts      |
| typed IR shapes and invariants  | layout or scene coordinates |
| shared drawing rules, fixtures  | Excalidraw element output   |
| semantic validation diagnostics | app routes or persistence   |

## Commands

```sh
pnpm nx test diagram-core
pnpm nx typecheck diagram-core
pnpm nx build diagram-core
```

## Usage

All generation, rendering, scenario, and app surfaces should pass diagram data
through this package before rendering or exporting. Add new diagram types here
first so invalid references, missing labels, and diagram-specific invariants
fail before they reach UI or artifact code, then complete every stage in
[docs/diagram-families.md](../../../docs/diagram-families.md).
