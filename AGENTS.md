# Agent Guidelines

## Scope

This is the canonical Sketchi product repository. Keep one coherent Nx and
Cloudflare Workers architecture; do not reintroduce the retired Next.js,
Convex, Vercel, Bun, or Turborepo stack.

## Priorities

- Prefer readable, tested package boundaries over compatibility layers.
- Treat diagram generation as product-critical infrastructure: deterministic inputs, typed intermediate representation, functional tests, and Storybook coverage.
- Delete obsolete approaches when replacing them. Do not carry parallel systems unless a migration step explicitly requires it.

## Delegated agents

- Use Codex `gpt-5.6-sol` for planning, implementation, and independent review,
  with reasoning effort set explicitly for the task.
- Fable may act as the primary delivery orchestrator from the canonical root.
  In that role it may inspect repository and external state, maintain coordination
  artifacts, create and clean Herdr worktrees, launch and steer agents, route
  review findings, run proof, manage GitHub issues and Graphite PRs, merge green
  slices, and verify main and production/runtime surfaces.
- Keep implementation and independent review delegated to separate Codex
  `gpt-5.6-sol` agents with explicit reasoning effort. Fable should remain the
  coordinator and must not directly implement product/source/test changes or
  substitute its own assessment for the required independent review.

## Proof

Before pushing meaningful changes, run:

- `pnpm nx run-many -t typecheck,test,build`
- `pnpm nx build-storybook diagram-ui`

For UI-affecting changes, run the web app locally and verify the changed flow against the real page.

For end-to-end checks, prefer exercising the real deployed or local surface through an actual browser (Chrome/TabEx where a true browser is required; otherwise `agent-browser`) instead of relying only on in-process or mocked tests.

## Temporary Artifacts

Use `.memory/` for local notes, logs, screenshots, and other temporary artifacts. It is gitignored but visible to agents through `.ignore`.
