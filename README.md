# Sketchi

This is the canonical Sketchi product repository. The current architecture is
the completed clean-start system: a maintainable diagram-generation core,
Cloudflare Worker app surfaces, agent plugins, and deterministic proof paths in
one Nx workspace.

## Sketchi Code Mode for agents

Codex, Claude Code, Agy, and OpenCode can create hosted Sketchi diagrams through
the public Code Mode MCP endpoint. Start with the
[agent quickstart](docs/code-mode-agent-plugins.md) for copy-paste installation,
verification, and a first diagram. Every harness section follows that sequence,
including the portable skill and MCP-only Agy and OpenCode paths. Sketchi does
not require its own login, API key, or local browser install.

## Stack

| Layer            | Owner                                                        |
| ---------------- | ------------------------------------------------------------ |
| Workspace        | Nx boundaries, affected checks, generators, Storybook wiring |
| App shells       | TanStack Start apps in `apps/*`                              |
| Diagram contract | `packages/diagram-core`                                      |
| Rendering        | `packages/diagram-renderer`, `packages/diagram-excalidraw`   |
| Generation       | `packages/diagram-generation`, `packages/diagram-agent`      |
| UI states        | `packages/diagram-studio-ui`                                 |

- Nx workspace for package boundaries, affected checks, and Storybook wiring.
- TanStack Start app surfaces for `sketchi.app`, the public Playground worker,
  the persisted Studio foundation, `icons.sketchi.app`, and internal
  harnesses.
- Typed diagram intermediate representation in `packages/diagram-core`.
- Deterministic scene renderer in `packages/diagram-renderer`.
- Real Excalidraw conversion and validation in `packages/diagram-excalidraw`.
- Canonical `buildFlowchart` artifact runtime and prompt policy in `packages/diagram-agent`.
- Maintained scenarios and local fixture/model-output evaluation in `packages/diagram-scenarios`.
- Reusable React UI and Storybook in `packages/diagram-studio-ui`.
- Workspace Nx generators in `tools/sketchi-generators`.
- Agentic generation route-surface notes in
  [docs/agentic-generation.md](docs/agentic-generation.md).
- MCP-first non-Convex generation scope in
  [docs/mcp-first-generation.md](docs/mcp-first-generation.md).

## Commands

```sh
pnpm install
pnpm nx run-many -t typecheck,test,build
pnpm nx build-storybook diagram-studio-ui
pnpm dev
pnpm nx dev playground
pnpm nx dev studio
pnpm nx dev web
pnpm nx dev excalidraw
pnpm nx dev icons
pnpm nx scenario diagram-scenarios -- --scenario pharma-batch-disposition --fixture --out .memory/pharma-batch.excalidraw
SKETCHI_GENERATOR_COMMAND="your-llm-command" pnpm nx scenario diagram-scenarios -- --scenario pharma-batch-disposition
```

`pnpm dev` runs every Nx app with a `dev` target in parallel. The playground
defaults to port `6200`; Vite will increment to the next free port when needed.

Generate new owned surfaces through the workspace plugin:

```sh
pnpm nx g @sketchi/generators:ui-component StatusBadge
pnpm nx g @sketchi/generators:diagram-type mindmap --title "Sketchi mindmap fixture"
```

## Deploys

| Surface      | Local dev                | Product role                                                   |
| ------------ | ------------------------ | -------------------------------------------------------------- |
| `web`        | `pnpm nx dev web`        | `sketchi.app` home, docs, and setup routes                     |
| `studio`     | `pnpm nx dev studio`     | Playground chat, artifact handoff, persisted Studio foundation |
| `icons`      | `pnpm nx dev icons`      | `icons.sketchi.app` product surface                            |
| `playground` | `pnpm nx dev playground` | internal eval harness for scenarios                            |
| `excalidraw` | `pnpm nx dev excalidraw` | internal Excalidraw rendering workspace                        |

Pull requests deploy each app to PR-specific Cloudflare Workers and update one
sticky PR comment per app with the URL when Cloudflare credentials are
configured.
See [docs/preview-deploys.md](docs/preview-deploys.md).

Merges to `main` deploy production Workers to their `workers.dev` URLs. Domain
assignment is a manual `app-production-deploy` workflow dispatch with
`domain_action=attach`; workers.dev remains the proof surface until that manual
cutover happens. Follow the guarded, reversible
[production domain runbook](docs/production-domain-cutover.md). Do not attach
the eval harness or standalone Excalidraw app as public product routes unless
the product route map is explicitly reopened; the public Playground domain
belongs to the `studio` app, not the internal `playground` harness.

Local production Worker deploy targets are app-scoped:

```sh
pnpm deploy:playground
pnpm deploy:studio
pnpm deploy:web
pnpm deploy:excalidraw
pnpm deploy:icons
```

## Workspace Shape

```text
apps/playground                  Internal scenario/eval harness
apps/studio                      Playground chat, artifact handoff, persisted Studio foundation
apps/web                         Sketchi public home and docs
apps/excalidraw                  Internal Excalidraw rendering workspace
apps/icons                       Standalone curated icon output browser
packages/diagram-agent           Canonical diagram build runtime and agent policy
packages/diagram-core            Diagram IR, validation, fixtures
packages/diagram-renderer        Deterministic scene generation
packages/diagram-excalidraw      Real Excalidraw conversion and validation
packages/diagram-generation      Gemini request/response and candidate parsing
packages/diagram-scenarios       Scenario prompts, checks, and CLI evals
packages/diagram-studio-ui       React components and Storybook
tools/sketchi-generators         Workspace generators for components and diagram types
docs/architecture.md             architecture notes
docs/agentic-generation.md       generation runtime and route-surface plan
docs/mcp-first-generation.md     non-Convex MCP-first generation scope
```
