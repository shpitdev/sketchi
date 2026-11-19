# Agent guidelines

## Scope and priorities

- Use Nx and Cloudflare Workers. Do not reintroduce Next.js, Convex, Vercel, Bun or Turborepo.
- Replace obsolete paths rather than adding compatibility layers. Keep package boundaries tested, generation inputs deterministic and the intermediate representation typed.
- Frontierclimb owns `sketchi` and `sketchi-generate`. It calls the `tools/scenarios` CLI for case discovery and deterministic grading. Preserve that contract; do not build a parallel eval system.
- Measure readability **and** generation cost: tokens, tool calls, retries and wall time. An improvement must account for both.
- Draw Excalidraw sketches that read at a glance. Prefer fewer elements and standard strokes; size limits are ceilings, not targets.

## Tests

Keep one test layer per behaviour, at the outermost boundary the caller uses. When in doubt, leave it out.

Keep:

- Layout and routing properties: one fuzz suite per family, plus routing and text-fit.
- One end-to-end path per family: document in, valid Excalidraw file out.
- Data safety: storage, share encryption, ownership, atomic writes, quotas and rate limits.
- One test per external contract: released CLI decoding, HTTP status mapping, MCP tool list.
- Model spend bounds: retry, timeout and attempt caps.
- A past bug's regression test only if fuzz and boundary tests would miss it.
- One table per family validator: one minimal bad input per issue code; assert only the code.
- One table per fuzz oracle: break a scene for each issue kind its layout readout or file validator must detect.

Do not add:

- Schema restatements, wording checks, or assertions on incidental coordinates, counts or ordering.
- Helper, normaliser or intermediate-shape tests for behaviour a kept test covers.
- Per-family copies of generic checks, mock-heavy tests, static label tests or tests of test helpers.
- Gate script tests beyond signoff and locking.

Keep family tests beside the source in `tests/`: at most `<name>.test.ts`, `<name>-fuzz.test.ts` and `regressions.test.ts`.

## Delegated agents

- Fable coordinates, reviews architecture and merges accepted PRs with `gh pr merge <n> --rebase --match-head-commit <sha>`; never squash. Fable does not implement. No agent spawns another Fable.
- One primary routes work and reviews, integrates and reports to Fable. It does not implement product or test changes.
- One fresh author per PR, in an isolated Herdr worktree. The author pushes, opens the PR to `main` and signs off the pushed head; authors never merge.
- Use a fresh, read-only reviewer on a model the author did not use. Review against the PR base; try to break the change and see the tests fail. Return findings to the author once; the primary decides after recheck.
- Primary: `cliproxy/claude-opus-5-5` or `cliproxy/gpt-6.2-astra`. Author/reviewer defaults: `cliproxy/gpt-6.2-sol` and `cliproxy/gpt-6.2-astra`, high. Preserve explicit assignments.
- Launch with `/Users/anandpant/Library/pnpm/bin/pi --model <id> --thinking high '<task>'`. After five minutes of 503s, switch models and report it. Opus 5.5 is the fallback for any role.
- Messages between agents: at most five lines plus a file path.
- Take production work and failed pre-deploy checks to Fable first. Only the user or Fable starts a production deploy, dispatches `release.yml` or merges a change that triggers either.

## Proof

- Before pushing: `pnpm ci:local --no-signoff`. After opening the PR: `pnpm ci:local` from the clean, pushed head to post `local-ci`. Signoff requires the `origin/main` base commit. Logs: `.memory/ci-local/`.
- Restacks and retargets carry `local-ci` only for an unchanged patch. A changed patch needs fresh relevant proof and a full gate before signoff.
- Skip duplicate runtime gates for docs-only or unchanged patches. Keep heavy and timing-sensitive suites local; PR CI typechecks the affected head.
- For layout, drawing or graph changes, retain artifact identity, affected fuzz results and timing. The `*-fuzz` targets on `diagrams` are the full local suites; list them with `pnpm nx show project diagrams`.
- Declare external fixtures and environment inputs on the target. Do not clear or relocate the shared Nx cache for routine gates.
- Run `pnpm nx run drawing:corpus-renderer` when its inputs change. Build all four Workers before `pnpm run test:wrangler-dry-runs`.
- Verify rendering at the product entrypoint. For UI changes use headless `agent-browser` on the PR preview or production; never open a visible browser. See [Worker previews](docs/preview-deploys.md) for routing and rendering proof.

## Deploy and release triggers

- A push to `main` deploys Worker apps whose build inputs it reaches, without approval. Root Markdown and `docs/` alone do not trigger a production deploy.
- On `main`, `.changeset/` changes run `changesets.yml`, which merges and dispatches `release.yml` only if there is a Version Packages PR.
- Changing `apps/cli/package.json` on `main` triggers `release.yml` directly. It submits `npm publish` only for an untagged, unpublished CLI version; npm may require 2FA approval.

Keep temporary notes, logs and screenshots in `.memory/`. Git ignores it; `.ignore` keeps notes searchable.
