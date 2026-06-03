# Sketchi V2 Lab

Clean-room rewrite workspace for Sketchi.

The final star-bearing project remains `shpitdev/sketchi`; this fork is the lab where the v2 architecture can be built without legacy noise and then landed as a one-shot integration PR.

## Stack

- pnpm workspaces
- Nx project graph
- TanStack Start app shell
- Cloudflare Workers deployment target
- Storybook for reusable React UI packages
- Package-owned diagram IR, renderer, fixtures, and tests

## First Proof Commands

```bash
pnpm install
pnpm nx run-many -t typecheck,test,build
pnpm nx build-storybook diagram-studio-ui
```

## Workspace Shape

- `apps/web`: TanStack Start app configured for Cloudflare Workers.
- `packages/diagram-core`: diagram IR schemas, validation, and fixtures.
- `packages/diagram-renderer`: deterministic IR-to-scene rendering.
- `packages/diagram-studio-ui`: reusable UI components and Storybook stories.

## Migration Rule

Only migrate old Sketchi code when it can enter through one of the package contracts above with tests, fixtures, or stories.
