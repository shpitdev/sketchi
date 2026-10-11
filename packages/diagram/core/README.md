# diagram-core

Typed diagram contracts, validation, and fixtures for every Sketchi diagram type.

```mermaid
flowchart LR
  Fixtures["fixtures"] --> Registry["diagram type registry"]
  Registry --> Flowchart["flowchart contract"]
  Registry --> Mindmap["mindmap contract"]
  Registry --> Sequence["sequence contract"]
  Flowchart --> Consumers["generation, rendering, UI"]
  Mindmap --> Consumers
  Sequence --> Consumers
```

Flowchart and mindmap share the node/edge `IntermediateDiagram` graph.
Sequence diagrams keep their own `SequenceDiagram` contract: ordered
participants and chronologically ordered messages, never a graph.
`CanonicalDiagramSchema` and `parseCanonicalDiagram` accept any family.

| Owns                            | Does not own                |
| ------------------------------- | --------------------------- |
| diagram type registry           | model calls or prompts      |
| typed IR shapes and invariants  | layout or scene coordinates |
| reusable fixtures               | Excalidraw element output   |
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
