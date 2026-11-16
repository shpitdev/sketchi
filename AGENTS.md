# Agent Guidelines

## Scope

This is the canonical Sketchi product repository. Keep one coherent Nx and
Cloudflare Workers architecture; do not reintroduce the retired Next.js,
Convex, Vercel, Bun, or Turborepo stack.

## Priorities

- Prefer readable, tested package boundaries over compatibility layers.
- Treat diagram generation as product-critical infrastructure: deterministic inputs, typed intermediate representation, functional tests, and Storybook coverage.
- Delete obsolete approaches when replacing them. Do not carry parallel systems unless a migration step explicitly requires it.
- Frontierclimb owns the graded catalogs `sketchi` and `sketchi-generate`, and currently calls Sketchi's scenario CLI for case discovery and deterministic grading. Preserve those real callers when moving scenarios to tools; do not add a parallel eval system or assume the existing graders are already copied to Frontierclimb.
- Generation cost is product quality. A diagram that reads badly is a failure, and so is one that takes excess tokens, tool calls, retries or wall time to produce. Measure both before claiming an improvement.
- Diagrams are Excalidraw sketches: keep them simple and readable at a glance. Prefer fewer elements and standard stroke widths to fine detail or thin lines. Size limits are ceilings, not targets: draw what the request needs, and keep each family to the size that still reads as a sketch.

## Delegated agents

- One Codex primary in the canonical root owns the plan, Herdr coordination,
  review routing, integration and staging PR. It does not implement product or
  test changes. The current agreed primary model is `gpt-6-astra` with `high`
  reasoning. The user will review and merge the final staging PR; do not merge
  main autonomously during this restructure.
- Authors use isolated Herdr worktrees and Codex models: `gpt-6.1-sol` with `high`
  reasoning for straightforward work, `gpt-6-astra` with `xhigh` where the agreed
  plan calls for architectural or graph work. Preserve explicit assignments.
- Follow [the product structure plan](docs/plans/product-structure.md). Units
  0–3 were serial. The user now permits up to four implementation authors with
  demonstrably disjoint files, plus reviewers and verifiers as needed. Graph
  stays single-author; the primary coordinates shared files and verification.
- PR 810 finishes the restructure, all 15 families and the app work integrated
  before graph acceptance. Remaining Effect work goes to coherent follow-up
  PRs off main after the user merges 810. The plan's seven completion criteria
  apply to the series; 810 explicitly lists its open mechanism rows.
- Independent code review uses a separate read-only session, normally
  `gpt-6.1-sol` with `high` reasoning and `codex review --base <parent>`.
  Findings go back to the author once; the primary decides after recheck.
  The same model in separate sessions is not self-review.
- The existing user-selected Fable collaborator reviews the architecture after
  unit 1, after units 2–3, after the shared graph split and before PR readiness.
  This is a read-only role; do not spawn another Fable agent.
- Browser and render verification uses Codex `gpt-6.1-sol` and the actual
  product entrypoint. Preserve unfinished branches, worker evidence and user
  focus when transferring ownership.

## Proof

Prove changes locally. Remote CI on a PR is one Nx-affected typecheck, a thin
double check that also catches a bad merge with the base. It is not the place for
heavy suites or timing-sensitive tests. If you find yourself fighting CI, verify
the change locally and slim CI instead of adding to it.

Choose each check for a concrete failure it could catch. Units that do not touch
layout, drawing or graph need no timing harness and no browser run unless they
change UI behavior; use focused tests, the gate and independent review. Changes
to layout, drawing or graph retain artifact identity, affected fuzz and timing.
Reuse unchanged proof by identity instead of repeating expensive checks.

`pnpm ci:local` is the local CI gate (`scripts/ci-local.mjs`). It defaults to
`origin/main`, including staged, unstaged and untracked changes, and runs actionlint when workflows
change, a frozen install, `pnpm run check`, the scenario CLI smoke, deployment/process
behavior and domain/font integration tests, the Nx-affected native `typecheck`,
`build` and `test` targets, sampled routing as described below, the root
`effect-tsgo tsc@7.0.2 -b`, and
`pnpm nx build-storybook editor` when `editor` is affected.

- Before publishing an accepted unit, run `pnpm ci:local --no-signoff`.
  A unit may use `--base <last-fully-gated-staging-head>`; record that verified
  base and reuse unchanged earlier proof. Documentation-only changes and
  unchanged patches do not require a duplicate runtime gate.
- Before PR readiness and signoff, run the full gate against `origin/main`.
  Unit gates with a different base cannot post `local-ci`, even with `--all`.
- For signoff after the push, run `pnpm ci:local` on the pushed head. It refuses a dirty
  worktree or a HEAD the PR does not have, and on success posts the `local-ci`
  commit status that merging needs.
- A restack or retarget that leaves the PR's own patch unchanged keeps its
  `local-ci` (the `local-ci carry` workflow re-posts it). A changed patch needs
  new relevant verification and a full gate before signoff.
- Logs are in `.memory/ci-local/`. `--all` runs every project instead of the
  affected graph. At most two gates run at once per machine (`CI_LOCAL_SLOTS`).

`diagrams:test` owns shared build/generation tests. `diagrams:test-<family>` and
`diagrams:test-graph` own family and graph tests; `pnpm test` and the local gate
select all these native targets, with Nx 24 input-based affected selection.
`drawing:test` retains the cross-family text-fit cases and excludes the sampled
routing suite. `drawing:routing-sample` runs once when a unit changes graph,
Flowchart, the eagerly loaded state-machine parser, drawing or shared runtime/config inputs. Selection uses the gate's
actual changed files; Nx target inputs alone do not suppress execution. Full
`origin/main` gates, signoff and `--all` always include sampled routing.

Build, typecheck and test targets reuse Nx's native local cache across worktrees.
The installed Nx version shares task artifacts and its index outside the checkout;
project-graph data, Vite state and dependencies remain checkout-local. Do not clear
shared caches or force cache-directory overrides for routine gates. Keep actual
source, dependency, external fixture and environment inputs complete. Explicit
fuzz runs that write caller-selected diagnostic paths use `--skip-nx-cache`.

These larger suites remain local proof when their inputs change:

- `pnpm nx affected -t test-browser --base=origin/main` (browser-mode suites in a
  Browserbase remote browser; needs `BROWSERBASE_API_KEY` and
  `BROWSERBASE_PROJECT_ID`; never run in CI)
- `pnpm nx run svg-excalidraw:corpus-renderer`
- `pnpm nx run diagrams:gantt-fuzz` (300 plans per Gantt fuzz; the gate runs 4)
- `pnpm nx run diagrams:chart-fuzz` (300 chart seeds; the gate runs 1–12 plus decimal seed 27)
- `pnpm nx run diagrams:mindmap-fuzz` (2,000 mindmap seeds; the gate runs 8)
- `pnpm nx run drawing:routing-fuzz` (full flowchart, grouped, state, label and text-fit matrices; the gate samples 4–8 cases, retaining all 30 wrapping cases)
- `pnpm nx run drawing:er-fuzz` (240 schemas; the gate runs 16)
- `pnpm nx run drawing:class-fuzz` (240 models and 120 text-fit rounds; the gate runs 16 and 12)
- `pnpm nx run drawing:org-chart-fuzz` (900 random charts across three seeds; the gate runs 6)
- `pnpm nx run diagrams:venn-fuzz` (900 random Venn diagrams across three seeds; the gate runs 12)
- `pnpm nx run drawing:journey-fuzz` (900 random journeys across three seeds; the gate runs 8)
- `pnpm nx run drawing:sankey-fuzz` (1,200 random flows across three seeds; the gate runs 10)
- `pnpm nx run drawing:wireframe-fuzz` (1,200 random wireframes across three seeds; the gate runs 8)
- `pnpm nx run drawing:sequence-fuzz` (400 sequences with self-messages; the gate runs 12)
- `pnpm nx run drawing:quadrant-fuzz` (700 random quadrant charts; the gate runs 14)
- `pnpm run test:wrangler-dry-runs` after app builds

Worker Previews are opt-in. Add the `preview` label to a PR to deploy the Worker
apps it affects on every push (closing the PR deletes them), or dispatch
`app-preview` with a PR number and `project` (`affected`, `all`, or one app) for a
stacked PR or a specific app such as `playground` (Studio); a dispatch also adds
the label.

Production Worker deployment requires an explicit `app-production-deploy`
workflow dispatch. Merging or pushing to main does not deploy production.

For PR 810, keep the `preview` label off between proof runs. When a changed
entrypoint needs a deployed preview, dispatch `app-preview` for the required
project and remove the label it re-adds; existing previews remain available.
Routing/rendering proof uses the normal preview MCP (`pr-<N>-sketchi-studio`),
relevant scenario replay and a small bounded set of inspected PNGs. Official
Cloudflare Worker Previews are already in use; no platform migration is needed.

For UI-affecting changes, verify the changed flow against the real page.

For real-page checks, use `agent-browser` against the PR preview or production, headless (its default) or with `-p browserbase`. Never open a visible browser window on the owner's machine (`--headed` or any automation that pops up). A browser test that is genuinely valuable calls Browserbase over its API instead of a local browser; Vitest browser-mode suites do this through `tools/testing/browserbase.ts`.

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
