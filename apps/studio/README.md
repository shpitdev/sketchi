# studio

Current hosted Sketchi Playground chat surface for ephemeral generation, Code
Mode APIs, MCP, artifacts, and diagram review.

```mermaid
flowchart LR
  UI["Playground UI"] --> Chat["chat route"]
  Harness["MCP and API clients"] --> CodeMode["Code Mode adapter"]
  Chat --> Runtime["diagram-agent and generation"]
  CodeMode --> Runtime
  Runtime --> Artifacts["R2 artifacts and Browser Run PNG"]
  Artifacts --> UI
```

| Owns                               | Does not own                         |
| ---------------------------------- | ------------------------------------ |
| Playground routes and app shell    | core IR shape or validation rules    |
| Code Mode HTTP and MCP adapters    | reusable diagram review components   |
| artifact storage and render routes | global preview deploy orchestration  |
| server-side usage event scheduling | raw Excalidraw editing as a contract |

## Commands

```sh
pnpm nx dev studio
pnpm nx test studio
pnpm nx typecheck studio
pnpm nx build studio
pnpm nx deploy studio
pnpm nx cf-typegen studio
```

## Usage

This app is the current product-facing Worker boundary for ephemeral agentic
diagram creation. It should remain a thin app adapter over shared diagram
packages while owning transport details such as MCP `execute`, hosted artifact
URLs, R2 bindings, and Cloudflare Browser Run rendering. Future persisted Studio
routes should build on this boundary without making the anonymous Playground
depend on full workspace persistence.
