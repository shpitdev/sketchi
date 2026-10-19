# Agent Guidelines

## Scope

This is the canonical Sketchi product repository. Keep one coherent Nx and
Cloudflare Workers architecture; do not reintroduce the retired Next.js,
Convex, Vercel, Bun, or Turborepo stack.

## Priorities

- Prefer readable, tested package boundaries over compatibility layers.
- Treat diagram generation as product-critical infrastructure: deterministic inputs, typed intermediate representation, functional tests, and Storybook coverage.
- Delete obsolete approaches when replacing them. Do not carry parallel systems unless a migration step explicitly requires it.
- Generation cost is product quality. A diagram that reads badly is a failure, and so is one that takes excess tokens, tool calls, retries or wall time to produce. Measure both before claiming an improvement.

## Delegated agents

- A Claude orchestrator in the canonical root plans the work, creates and cleans
  Herdr worktrees, launches and steers agents, routes review findings, manages
  GitHub issues and Graphite PRs, merges green slices, and verifies main and
  production. It does not implement product, source or test changes itself.
- Implementation: one Claude Opus 5.5 agent per slice (`--model claude-opus-5-5`)
  in its own Herdr worktree, with effort set explicitly (`high`, or `xhigh` for
  routing and layout).
- Independent review: a Codex `gpt-6.1-sol` session separate from the author,
  with reasoning effort set explicitly, running `codex review --base <parent>`.
  Findings go back to the implementer once; the orchestrator then decides.
- Browser and render verification: Codex `gpt-6.1-sol`.
- Never select a Fable model.

## Proof

Prove changes locally. CI is a lean double check of the key items and of merge
conflicts, not the place for heavy suites or timing-sensitive tests. If you find
yourself fighting CI, verify the change locally and slim CI instead of adding to it.

Before pushing, run the affected checks:

- `pnpm nx affected -t typecheck,test,build --base=origin/main`
- `pnpm run check`
- `pnpm nx build-storybook diagram-ui` when `diagram-ui` is affected

CI runs only the Nx-affected graph plus the key repository checks, so these stay
local proof when their inputs change:

- `pnpm nx affected -t test-browser --base=origin/main` (browser-mode suites in a
  Browserbase remote browser; needs `BROWSERBASE_API_KEY` and
  `BROWSERBASE_PROJECT_ID`; never run in CI)
- `pnpm nx run svg-excalidraw:corpus-renderer`
- `pnpm nx run diagram-renderer:gantt-fuzz` (300 plans per Gantt fuzz; CI runs 4)
- `pnpm nx run diagram-renderer:chart-fuzz` (300 chart seeds; CI runs 1–12 plus decimal seed 27)
- `pnpm nx run diagram-renderer:mindmap-fuzz` (2,000 mindmap seeds; CI runs 8)
- `pnpm nx run diagram-excalidraw:routing-fuzz` (full flowchart, grouped, state, label and text-fit matrices; CI samples 4–8 cases, retaining all 30 wrapping cases)
- `pnpm nx run diagram-excalidraw:er-fuzz` (240 schemas; CI runs 16)
- `pnpm nx run diagram-excalidraw:class-fuzz` (240 models and 120 text-fit rounds; CI runs 16 and 12)
- `pnpm nx run diagram-excalidraw:org-chart-fuzz` (900 random charts across three seeds; CI runs 6)
- `pnpm nx run diagram-excalidraw:sequence-fuzz` (400 sequences with self-messages; CI runs 12)
- `pnpm run test:wrangler-dry-runs` after app builds

For routing and rendering changes, replay the relevant scenarios against the PR's preview MCP with the scenario CLI and inspect a few real PNGs before merging.

For UI-affecting changes, verify the changed flow against the real page.

Never install or run a local Chromium. For real-page checks, use `agent-browser -p browserbase` against the PR preview or production. A browser test that is genuinely valuable calls Browserbase over its API instead of a local browser; Vitest browser-mode suites do this through `tools/testing/browserbase.ts`.

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
