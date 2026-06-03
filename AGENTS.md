# Agent Guidelines

## Operating Model

- This repository is the clean v2 lab for Sketchi.
- Keep the original `shpitdev/sketchi` repository as the production/stars source of truth until the final one-shot integration PR.
- Prefer package boundaries and proof over framework-level shortcuts.
- Temporary artifacts belong in `.memory/`, which is gitignored but intentionally visible to local tools.

## V2 Priorities

- Nx project graph first.
- TanStack Start web shell on Cloudflare Workers.
- Storybook for reusable UI before rebuilding app workflows.
- Diagram IR, renderer, fixtures, and eval surfaces as standalone packages.
- Generic MCP/API should consume package contracts, not UI internals.

## Checks

- `pnpm nx run-many -t typecheck,test,build`
- `pnpm nx build-storybook diagram-studio-ui`
- For app changes, run `pnpm nx dev web` and verify the real page locally.
