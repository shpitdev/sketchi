# diagram-excalidraw

Conversion and validation for real Excalidraw artifacts generated from Sketchi scenes.

```mermaid
flowchart LR
  Core["diagram-core"] --> Renderer["diagram-renderer"]
  Renderer --> Scene["scene model"]
  Scene --> Convert["Excalidraw conversion"]
  Convert --> Validate["artifact validation"]
  Validate --> Apps["apps and Code Mode"]
```

| Owns                               | Does not own                       |
| ---------------------------------- | ---------------------------------- |
| scene-to-Excalidraw element output | diagram semantic validation        |
| arrow bindings and bound text      | deterministic layout source        |
| Excalidraw artifact validation     | model prompts or agent policy      |
| patchable persisted scene shape    | Worker routes or R2 object storage |

## Commands

```sh
pnpm nx test diagram-excalidraw
pnpm nx typecheck diagram-excalidraw
pnpm nx build diagram-excalidraw
```

## Usage

Use this package at the export boundary when a validated scene needs to become
inspectable Excalidraw JSON. Code Mode and Studio should keep asking for
structured diagram or patch operations; raw Excalidraw editing belongs behind
this package boundary.
