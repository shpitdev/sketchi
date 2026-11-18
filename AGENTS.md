# Agent Guidelines

## Scope

This is the canonical Sketchi product repository. Keep one coherent Nx and
Cloudflare Workers architecture; do not reintroduce the retired Next.js,
Convex, Vercel, Bun, or Turborepo stack.

## Priorities

- Prefer readable, tested package boundaries over compatibility layers.
- Treat diagram generation as product-critical infrastructure: deterministic inputs, typed intermediate representation, functional tests, and Storybook coverage.
- Delete obsolete approaches when replacing them. Do not carry parallel systems unless a migration step explicitly requires it.
- Frontierclimb owns the graded catalogs `sketchi` and `sketchi-generate`, and currently calls Sketchi's scenario CLI for case discovery and deterministic grading from `tools/scenarios`. Preserve that real caller; do not add a parallel eval system or assume the existing graders are already copied to Frontierclimb.
- Generation cost is product quality. A diagram that reads badly is a failure, and so is one that takes excess tokens, tool calls, retries or wall time to produce. Measure both before claiming an improvement.
- Diagrams are Excalidraw sketches: keep them simple and readable at a glance. Prefer fewer elements and standard stroke widths to fine detail or thin lines. Size limits are ceilings, not targets: draw what the request needs, and keep each family to the size that still reads as a sketch.

## Tests

A test stays only if it gives clear and obvious value. Keep one layer of
protection per behaviour, at the outermost point a caller touches. If a fuzz or
boundary test already fails when the behaviour breaks, inner tests of the same
thing go.

Keep:

1. Fuzz and property tests for layout and routing: one per family, plus routing and text-fit.
2. One end-to-end path per family: document in, valid Excalidraw file out.
3. Data safety: storage, share encryption, ownership, atomic writes, quotas and rate limits.
4. Contracts other software depends on, one test each: what the released CLI decodes, HTTP status mapping, the MCP tool list.
5. Spend bounds: retry, timeout and attempt caps on model calls.
6. A regression test for a real past bug, only when the fuzz or boundary test would not catch it.
7. One table per family validator: each issue code raised once by a minimal bad input, asserting the code only. Fuzz generates valid input, so nothing else notices a rule going missing.
8. One table per fuzz oracle: the layout-issue readout or file validator a fuzz test uses to pass or fail detects each issue kind once on a deliberately broken scene. Without it the fuzz cannot fail.

Do not add:

- Tests that restate a schema, pin wording (prompts, docs, help, error prose) or pin incidental output (coordinates, element counts, ordering nobody relies on).
- Inner-layer tests of helpers, normalisers or intermediate shapes a kept test already exercises.
- Per-family copies of a generic check, tests that are mostly mocks, component tests of static labels, tests of test helpers, or tests of the gate script beyond its sign-off and lock behaviour.

When unsure, leave it out; git history can bring a test back. A family has at
most `<name>.test.ts`, `<name>-fuzz.test.ts` and `regressions.test.ts`, in a
`tests/` folder beside its source.

## Delegated agents

- Fable is the coordinator and merger. It reviews architecture and merges each
  accepted PR with `gh pr merge <n> --rebase --match-head-commit <sha>`; never
  squash. It does not implement, and no agent spawns another Fable.
- One primary coordinates and integrates. It routes work and reviews and reports
  to Fable; it does not implement product or test changes.
- Authors: one fresh author and isolated Herdr worktree per PR. The author
  pushes, opens the PR to `main`, then signs off that head with `pnpm ci:local`.
  Authors do not merge.
- Reviewers: a separate, fresh, read-only session on a model the author did not
  use, against the PR's base. Review tries to break the changed behaviour and sees
  the tests fail. Findings go back to the author once; the primary decides after
  recheck. Browser and render verification uses the actual product entrypoint.
- Models: primary and authors use Claude Opus 5.5 (`cliproxy/claude-opus-5-5`)
  high. Reviewers use `cliproxy/gpt-6.2-sol` or `cliproxy/gpt-6.2-astra` high,
  whichever answers. Only if neither answers within five minutes may a fresh Opus
  session review an Opus author's PR; say so. Launch with
  `/Users/anandpant/Library/pnpm/bin/pi --model <id> --thinking high '<task>'`.
  Preserve explicit assignments.
- Messages between agents are at most five lines plus a file path.
- Anything touching production, and any failed pre-deploy check, goes to Fable
  first. Only the user or Fable starts a production deploy, dispatches
  `release.yml`, or merges a change that starts a release. On main, a push under
  `.changeset/` runs `changesets.yml`, which merges the Version Packages PR and
  dispatches `release.yml`; a push that changes `apps/cli/package.json` starts
  `release.yml` directly. `release.yml` submits `npm publish` only for an untagged,
  unpublished CLI version, and npm may hold it for 2FA approval.

## Proof

Prove changes locally. Remote CI on a PR is one Nx-affected typecheck of the PR
head, covering changes since its merge-base with `main`; it does not check the
merge with the latest base. It is not the place for heavy suites or
timing-sensitive tests. If you find yourself fighting CI, verify
the change locally and slim CI instead of adding to it.

Choose each check for a concrete failure it could catch. Changes that do not touch
layout, drawing or graph need no timing harness and no browser run unless they
change UI behavior; use focused tests, the gate and independent review. Changes
to layout, drawing or graph retain artifact identity, affected fuzz and timing.
Reuse unchanged proof by identity instead of repeating expensive checks.

`pnpm ci:local` is the local CI gate (`tools/ops/src/ci-local/gate.ts`, started by the
`tools/ops/ci-local.mjs` install bootstrap). It defaults to
`origin/main`, including staged, unstaged and untracked changes. After a frozen
install and `nx sync:check`, native Nx affected targets own lint/format, tools
(including custom-rule, domain and font tests), deployment/process behavior,
scenario CLI smoke, typecheck/build/test, root TypeScript references and the
`editor-surface` Storybook build. Checks reuse the native local task cache. Workflow
changes select the native actionlint target. Full gates also run sampled routing.

- Before pushing, run `pnpm ci:local --no-signoff`. `--base <ref>` compares
  with another verified base; such a gate cannot post `local-ci`, even with
  `--all`. Documentation-only changes and unchanged patches do not require a
  duplicate runtime gate.
- For signoff after the push, run `pnpm ci:local` on the pushed head. It refuses a dirty
  worktree or a HEAD the PR does not have, and on success posts the `local-ci`
  commit status that merging needs.
- A restack or retarget that leaves the PR's own patch unchanged keeps its
  `local-ci` (the `local-ci carry` workflow re-posts it). A changed patch needs
  new relevant verification and a full gate before signoff.
- Logs are in `.memory/ci-local/`. `--all` runs every project instead of the
  affected graph. At most `CI_LOCAL_SLOTS` gates (default two) run at once per
  machine.

`diagrams:test` owns shared build/generation tests. `diagrams:test-<family>`,
`diagrams:test-graph` and `diagrams:test-text-fit` own family, graph and cross-family
text-fit tests. `pnpm test` uses `diagrams:verify-tests` with wildcard dependencies;
the gate derives individual target names from their configuration so native Nx 24
input selection keeps family changes narrow. Nx CLI target lists do not expand
wildcards, and an affected aggregate would pull every family dependency in.
`drawing:test` owns only drawing tests. `diagrams:routing-sample` is selected by
its native inputs in `--base` gates: graph, Flowchart, drawing, fonts and shared
runtime/config. Full `origin/main`, signoff and `--all` always run it once.

Build, typecheck and test targets reuse Nx's native local cache across worktrees.
The installed Nx version shares task artifacts and its index outside the checkout;
project-graph data, Vite state and dependencies remain checkout-local. Do not clear
shared caches or force cache-directory overrides for routine gates. Keep actual
source, dependency, external fixture and environment inputs complete. Explicit
fuzz runs that write caller-selected diagnostic paths use `--skip-nx-cache`.

These larger suites remain local proof when their inputs change:

- `pnpm nx run drawing:corpus-renderer`
- `pnpm nx run diagrams:gantt-fuzz` (300 plans per Gantt fuzz; the gate runs 4)
- `pnpm nx run diagrams:chart-fuzz` (300 chart seeds; the gate runs 1–12 plus decimal seed 27)
- `pnpm nx run diagrams:mindmap-fuzz` (2,000 mindmap seeds; the gate runs 8)
- `pnpm nx run diagrams:routing-fuzz` (full flowchart, grouped, state, label and text-fit matrices; the gate samples 4–8 cases, retaining all 30 wrapping cases)
- `pnpm nx run diagrams:er-fuzz` (240 schemas; the gate runs 16)
- `pnpm nx run diagrams:class-fuzz` (240 models and 120 text-fit rounds; the gate runs 16 and 12)
- `pnpm nx run diagrams:org-chart-fuzz` (900 random charts across three seeds; the gate runs 6)
- `pnpm nx run diagrams:venn-fuzz` (900 random Venn diagrams across three seeds; the gate runs 12)
- `pnpm nx run diagrams:journey-fuzz` (900 random journeys across three seeds; the gate runs 8)
- `pnpm nx run diagrams:sankey-fuzz` (1,200 random flows across three seeds; the gate runs 10)
- `pnpm nx run diagrams:wireframe-fuzz` (1,200 random wireframes across three seeds; the gate runs 8)
- `pnpm nx run diagrams:sequence-fuzz` (400 sequences with self-messages; the gate runs 12)
- `pnpm nx run diagrams:quadrant-fuzz` (700 random quadrant charts; the gate runs 14)
- `pnpm run test:wrangler-dry-runs` after app builds

Worker Previews are opt-in. Add the `preview` label to a PR to deploy the Worker
apps it affects on every push (closing the PR deletes them), or dispatch
`app-preview` with a PR number and `project` (`affected`, `all`, or one app) for a
stacked PR or a specific app such as `studio`; a dispatch also adds
the label.

Production Worker deployment requires an explicit `app-production-deploy`
workflow dispatch. Merging or pushing to main does not deploy production.

Keep the label off between proof runs: dispatch the project you need, then remove
the label the dispatch adds. Routing/rendering proof uses the preview MCP (`pr-<N>-sketchi-studio`), relevant scenario replay and a small
bounded set of inspected PNGs.

For UI-affecting changes, verify the changed flow against the real page with
`agent-browser` on the PR preview or production, headless (its default). Never open a visible browser window on the owner's machine (`--headed` or any automation that pops up).

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
