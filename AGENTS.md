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

Prove changes locally. Remote CI on a PR is one Nx-affected typecheck, a thin
double check that also catches a bad merge with the base. It is not the place for
heavy suites or timing-sensitive tests. If you find yourself fighting CI, verify
the change locally and slim CI instead of adding to it.

`pnpm ci:local` is the local CI gate (`scripts/ci-local.mjs`). Against
`origin/main`, including uncommitted changes, it runs actionlint when workflows
change, a frozen install, `pnpm run check`, the scenario CLI smoke, the deploy
and tooling contracts, the Nx-affected `typecheck`, `typecheck-native`, `build`
and `test` targets, the root `tsc6 -b` and project-graph test, and
`pnpm nx build-storybook diagram-ui` when `diagram-ui` is affected.

- Run `pnpm ci:local --no-signoff` before every `gt submit` or push.
- After the push, run `pnpm ci:local` on the pushed head. It refuses a dirty
  worktree or a HEAD the PR does not have, and on success posts the `local-ci`
  commit status that merging needs.
- A restack or retarget that leaves the PR's own patch unchanged keeps its
  `local-ci` (the `local-ci carry` workflow re-posts it). A changed patch needs
  a new `pnpm ci:local`.
- Logs are in `.memory/ci-local/`. `--all` runs every project instead of the
  affected graph. At most two gates run at once per machine (`CI_LOCAL_SLOTS`).

The gate runs only the Nx-affected default targets, so these stay local proof
when their inputs change:

- `pnpm nx affected -t test-browser --base=origin/main` (browser-mode suites in a
  Browserbase remote browser; needs `BROWSERBASE_API_KEY` and
  `BROWSERBASE_PROJECT_ID`; never run in CI)
- `pnpm nx run svg-excalidraw:corpus-renderer`
- `pnpm nx run diagram-renderer:gantt-fuzz` (300 plans per Gantt fuzz; the gate runs 4)
- `pnpm nx run diagram-renderer:chart-fuzz` (300 chart seeds; the gate runs 1–12 plus decimal seed 27)
- `pnpm nx run diagram-renderer:mindmap-fuzz` (2,000 mindmap seeds; the gate runs 8)
- `pnpm nx run diagram-excalidraw:routing-fuzz` (full flowchart, grouped, state, label and text-fit matrices; the gate samples 4–8 cases, retaining all 30 wrapping cases)
- `pnpm nx run diagram-excalidraw:er-fuzz` (240 schemas; the gate runs 16)
- `pnpm nx run diagram-excalidraw:class-fuzz` (240 models and 120 text-fit rounds; the gate runs 16 and 12)
- `pnpm nx run diagram-excalidraw:org-chart-fuzz` (900 random charts across three seeds; the gate runs 6)
- `pnpm nx run diagram-excalidraw:venn-fuzz` (900 random Venn diagrams across three seeds; the gate runs 12)
- `pnpm nx run diagram-excalidraw:journey-fuzz` (900 random journeys across three seeds; the gate runs 8)
- `pnpm nx run diagram-excalidraw:sankey-fuzz` (1,200 random flows across three seeds; the gate runs 10)
- `pnpm nx run diagram-excalidraw:wireframe-fuzz` (1,200 random wireframes across three seeds; the gate runs 8)
- `pnpm nx run diagram-excalidraw:sequence-fuzz` (400 sequences with self-messages; the gate runs 12)
- `pnpm run test:wrangler-dry-runs` after app builds

Worker Previews are opt-in. Add the `preview` label to a PR to deploy the Worker
apps it affects on every push (closing the PR deletes them), or dispatch
`app-preview` with a PR number and `project` (`affected`, `all`, or one app) for a
stacked PR or a specific app such as `playground` (Studio); a dispatch also adds
the label.

For routing and rendering changes, add the `preview` label, then replay the relevant scenarios against the PR's preview MCP (`pr-<N>-sketchi-studio`) with the scenario CLI and inspect a few real PNGs before merging.

For UI-affecting changes, verify the changed flow against the real page.

For real-page checks, use `agent-browser` against the PR preview or production, headless (its default) or with `-p browserbase`. Never open a visible browser window on the owner's machine (`--headed` or any automation that pops up). A browser test that is genuinely valuable calls Browserbase over its API instead of a local browser; Vitest browser-mode suites do this through `tools/testing/browserbase.ts`.

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
