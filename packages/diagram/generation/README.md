# diagram-generation

Model-facing generation helpers for Sketchi diagram candidates.

```mermaid
flowchart LR
  Prompt["generation prompt contract"] --> Messages["prompt messages"]
  Messages --> Gemini["Gemini request body"]
  Gemini --> Candidate["candidate text + usage"]
  Candidate --> Core["diagram-core parse"]
```

| Owns                                       | Does not own                  |
| ------------------------------------------ | ----------------------------- |
| provider prompt and request contracts      | eval scenarios and assertions |
| prompt message mapping                     | chat threads                  |
| Gemini REST body mapping                   | artifact persistence          |
| Cloudflare AI Gateway client compatibility | UI streaming                  |
| candidate parsing and diagnostics          | final grading/revision policy |

## Commands

```sh
pnpm nx test diagram-generation
pnpm nx typecheck diagram-generation
pnpm nx build diagram-generation
```

## Direction

This package is the likely first home for Effect-backed schemas and typed
generation errors. Keep the route handlers plain: Convex, Workers, MCP, and app
routes should call this package or the planned `diagram-agent` package instead
of owning generation logic themselves.
