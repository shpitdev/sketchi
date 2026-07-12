# Agent Guidelines

## Scope

This fork is the Sketchi v2 clean-start lab. Keep the original repository intact until the v2 surface is ready for a deliberate one-shot pull request back into `shpitdev/sketchi`.

## Priorities

- Prefer readable, tested package boundaries over compatibility layers.
- Treat diagram generation as product-critical infrastructure: deterministic inputs, typed intermediate representation, functional tests, and Storybook coverage.
- Delete obsolete approaches when replacing them. Do not carry parallel systems unless a migration step explicitly requires it.

## Delegated agents

- Use Codex `gpt-5.6-sol` for planning, implementation, and independent review,
  with reasoning effort set explicitly for the task.
- Fable is advisory only and must never implement, edit files, delegate work,
  commit, open or merge PRs, or perform any other mutation. Launch it with
  read-only tools and `--permission-mode manual`; never use Plan Mode, auto
  approval, or edit-capable tools. Its response is the only deliverable, and
  agreement with that response is not authorization for Fable to execute it.

## Proof

Before pushing meaningful changes, run:

- `pnpm nx run-many -t typecheck,test,build`
- `pnpm nx build-storybook diagram-studio-ui`

For UI-affecting changes, run the web app locally and verify the changed flow against the real page.

For end-to-end checks, prefer exercising the real deployed or local surface through an actual browser (Chrome/TabEx where a true browser is required; otherwise `agent-browser`) instead of relying only on in-process or mocked tests.

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
