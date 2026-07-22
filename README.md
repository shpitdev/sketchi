<p align="center">
  <img src="apps/web/public/icon.svg" alt="Sketchi" width="112" height="112" />
</p>

<h1 align="center">Sketchi</h1>

<p align="center">
  <strong>Typed, deterministic diagrams for people and AI agents.</strong><br />
  Prompt to validated IR to editable Excalidraw and hosted PNG artifacts.
</p>

<p align="center">
  <a href="https://sketchi.app/"><img alt="Website" src="https://img.shields.io/badge/sketchi.app-live-765264" /></a>
  <a href="https://www.npmjs.com/package/sketchi"><img alt="npm version" src="https://img.shields.io/npm/v/sketchi?logo=npm&color=CB3837" /></a>
  <a href="https://nx.dev/"><img alt="Nx" src="https://img.shields.io/badge/Nx-22-143055?logo=nx" /></a>
  <a href="https://workers.cloudflare.com/"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" /></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" /></a>
  <a href="https://excalidraw.com/"><img alt="Excalidraw" src="https://img.shields.io/badge/output-Excalidraw-6965DB" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2F855A" /></a>
</p>

---

Sketchi is the canonical Nx and Cloudflare workspace for generating reliable,
editable diagrams. Model output is never treated as a finished drawing: it is
parsed into a typed intermediate representation, validated, laid out by code,
converted to real Excalidraw elements, and persisted as an artifact with PNG and
scene representations.

<p align="center">
  <img src="apps/web/public/media/sketchi-playground-preview.png" alt="Sketchi deterministic diagram scenario workspace" width="1000" />
  <br />
  <em>Deterministic scenario inspection: typed IR, rendered canvas, and quality checks in one workspace.</em>
</p>

## What Sketchi Does

- Creates hosted flowcharts and mindmaps from natural-language prompts.
- Produces validated, editable Excalidraw scenes instead of opaque images.
- Exposes Code Mode through MCP and versioned HTTP artifact endpoints.
- Keeps layout, bindings, wrapping, and scene conversion deterministic in code.
- Tests diagram contracts with fixtures, maintained scenarios, real-scene
  validation, component tests, and Storybook.
- Converts a curated SVG corpus into native Excalidraw elements and libraries.

## CLI

Install Sketchi from npm, or use the noninteractive installer to install the
same package and configure Zsh, Bash, or Fish completions:

```sh
npm install -g sketchi

# Or install and configure completions in one step:
curl -fsSL https://raw.githubusercontent.com/shpitdev/sketchi/main/install.sh | sh
```

Create a canonical document, inspect and revise it, list the local store, then
export editable Excalidraw:

```sh
sketchi create --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'
sketchi show release-flow
sketchi edit release-flow --json '{"type":"flowchart","spec":{"id":"release-flow","title":"Release approval revised","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review complete evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}'
sketchi list
sketchi export release-flow --format excalidraw --dest release-flow.excalidraw
```

Generate and persist a diagram through the public, unauthenticated Sketchi API:

```sh
sketchi generate --prompt "Map release approval with pass and revise branches"
```

`create`, `show`, `edit`, `list`, and `export` are deterministic, fully offline,
and need no credentials. `generate` is the only network command and also needs
no API key, token, account, or login. All commands support `--output json`.
Generate completions directly with `sketchi --completions zsh`,
`sketchi --completions bash`, or `sketchi --completions fish`. See the
[complete CLI guide](apps/cli/README.md) for file/stdin input, completion setup,
storage details, and agent-oriented usage.

### Shell completions

The installer configures Zsh, Bash, or Fish completions for the detected shell.
Generated Bash completions require Bash 4 or newer; the installed source block
silently skips them on the stock macOS Bash 3.2. Bash login shells may not read
`.bashrc`, so `.bash_profile` may need to source `.bashrc` for completions to be
available.

## Code Mode

Codex, Claude Code, Agy, and OpenCode can create hosted diagrams through the
public Code Mode MCP endpoint. The [agent quickstart](docs/code-mode-agent-plugins.md)
contains installation, verification, and first-diagram instructions for every
supported harness. The public flow does not require a Sketchi login, API key, or
local browser installation.

```text
prompt or revision
        ↓
model candidate → typed diagram IR → deterministic scene → Excalidraw artifact
        ↓                                      ↓                  ↓
 maintained scenarios                    validation          hosted PNG
```

## Architecture

| Boundary                      | Responsibility                                                  |
| ----------------------------- | --------------------------------------------------------------- |
| `packages/diagram/core`       | Typed diagram contracts, semantic validation, fixtures          |
| `packages/diagram/generation` | Provider messages, responses, and candidate parsing             |
| `packages/diagram/agent`      | Canonical build runtime, quality checks, artifact orchestration |
| `packages/diagram/renderer`   | Deterministic layout and scene generation                       |
| `packages/diagram/excalidraw` | Persistable Excalidraw conversion and real-scene validation     |
| `packages/diagram/scenarios`  | Maintained prompts, assertions, and local/live evals            |
| `packages/diagram/ui`         | Shared React diagram, review, and eval UI states                |
| `packages/studio/projects`    | Studio project/diagram contracts and object-bucket persistence  |
| `packages/svg-excalidraw`     | Native SVG-to-Excalidraw conversion and library serialization   |

The first high-reliability target is decision-heavy flowchart generation.
`flowchart` and `mindmap` are explicit diagram families; unsupported families do
not silently fall back to a generic template. See the full
[architecture guide](docs/architecture.md) and the
[MCP-first generation boundary](docs/mcp-first-generation.md).

## Product Surfaces

| Surface        | Role                                                               | Local command               |
| -------------- | ------------------------------------------------------------------ | --------------------------- |
| `cli`          | Offline local authoring plus credential-free public generation     | `pnpm nx build sketchi-cli` |
| `web`          | `sketchi.app` home, docs, and setup                                | `pnpm nx dev web`           |
| `playground`   | Public Playground, Code Mode API/MCP, artifacts, Studio foundation | `pnpm nx dev playground`    |
| `icons`        | `icons.sketchi.app` curated icon browser                           | `pnpm nx dev icons`         |
| `eval-harness` | Internal scenario and model-output eval harness                    | `pnpm nx dev eval-harness`  |
| `excalidraw`   | Internal real-canvas rendering and editing workspace               | `pnpm nx dev excalidraw`    |

The internal harness is `eval-harness`. The public host is `playground`, while
its durable Worker identity remains `sketchi-studio` and the extracted Studio
persistence boundary remains `packages/studio/projects`. The completed
repository migration and its historical before tree are recorded in the
[repository structure proposal](docs/repository-structure-proposal.html).

## Quick Start

Prerequisites: Node.js compatible with the pinned toolchain, Corepack, and pnpm
`11.5.0`.

```sh
pnpm install
pnpm dev
```

Run one surface with `pnpm nx dev <project>`. `pnpm dev` starts every Nx app with
a `dev` target in parallel through Portless.

## Development

Required workspace proof:

```sh
pnpm run test:deploy-scripts
pnpm run test:tools
pnpm nx run-many -t lint,typecheck,test,build
pnpm run test:wrangler-dry-runs
pnpm nx build-storybook diagram-ui
pnpm exec tsc -b --pretty false
```

Run the canonical deterministic scenario:

```sh
pnpm nx scenario diagram-scenarios -- \
  --scenario pharma-batch-disposition \
  --fixture \
  --out .memory/pharma-batch.excalidraw
```

Use a local model command by setting `SKETCHI_GENERATOR_COMMAND`; it receives the
scenario prompt on stdin and writes candidate IR JSON to stdout.

Generate new owned surfaces through the workspace plugin:

```sh
pnpm nx g @sketchi/generators:ui-component StatusBadge
pnpm nx g @sketchi/generators:diagram-type mindmap --title "Sketchi mindmap fixture"
```

## Deployment

Eligible same-repository pull requests build and deploy app-specific Cloudflare
Workers when Cloudflare credentials are configured, then maintain one preview
comment per app. Relevant merges to `main` deploy production Workers when those
credentials are available; custom domain attachment remains an explicit
operator action. Forks and unconfigured environments retain build proof without
a Worker deploy. The eval harness and standalone Excalidraw workspace are
internal surfaces.

Worker builds are isolated under `dist/apps/<app>` and resolved through an
explicit Nx-project-to-Worker map, so parallel builds and later repository
renames cannot overwrite or implicitly rename durable Worker deployments.

See [preview deployments](docs/preview-deploys.md) and the guarded
[production domain runbook](docs/production-domain-cutover.md).

```sh
pnpm deploy:eval-harness
pnpm deploy:playground
pnpm deploy:web
pnpm deploy:excalidraw
pnpm deploy:icons
```

## Repository Map

```text
apps/
├── cli/                          local authoring and generation CLI
├── eval-harness/                 internal scenarios and model-output evals
├── excalidraw/                   internal real-canvas workspace
├── icons/                        public icon browser
├── native-conversion-storybook/ explicit cross-app Storybook composition
├── playground/                   public Playground, API/MCP, Studio adapter
└── web/                          public home, docs, and setup
packages/
├── diagram/{agent,core,excalidraw,generation,renderer,scenarios,ui}/
├── studio/projects/              persistence contract and service
└── svg-excalidraw/               native SVG conversion
tools/sketchi-generators/         Nx generators and tests
scripts/                          deploy, cutover, and pipeline operations
plugins/                          Codex and Claude Code distribution payloads
docs/                             architecture, boundaries, and runbooks
```

pnpm, Nx, and the root TypeScript solution all cover the same package-backed
projects. Nx tags plus lint enforce package/app, runtime/eval, persistence/UI,
and explicit composition boundaries across source, config, and Storybook
files. Required CI also dry-runs every mapped Worker from its generated build
configuration; see the
[architecture guide](docs/architecture.md#workspace-enforcement).

## Documentation

- [Agent plugin quickstart](docs/code-mode-agent-plugins.md)
- [Architecture](docs/architecture.md)
- [Agentic generation](docs/agentic-generation.md)
- [MCP-first generation](docs/mcp-first-generation.md)
- [SVG conversion plan](docs/svg-excalidraw-conversion-plan.md)
- [Repository replacement record](docs/replacement.md)

## License

MIT. See [LICENSE](LICENSE).
