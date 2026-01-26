# Working Preferences

## Communication

- be succinct; no filler; no full sentences required
- facts first; show evidence (commands + exit codes)

## Engineering

- ship in small, testable increments
- prefer readable code over clever code
- highly skimmable code; split files after ~400 lines
- descriptive file/function names; long is fine
- docstrings: skip or capture "why" only, never describe what the signature already tells you
- always use latest package versions; `bun install` to get latest

## Languages

- TypeScript first
- Go is OK for new utilities
- avoid Python

## Workflow

- commit + push regularly (small commits)
- keep the repo clean; delete obsolete docs/experiments

## Linting

- `bun x ultracite fix` to format
- `bun x ultracite check` to verify

## Repo Notes

- Turborepo monorepo with bun workspaces
- `apps/web/` - Next.js frontend
- `packages/backend/` - Convex backend functions
- `bun run dev` starts all apps
- `bun run build` builds all apps

## Testing Philosophy

Unit tests are rarely useful. Focus on:
1. **API tests** - harden backend/Convex functions; easiest to write, high confidence
2. **E2E tests** - use only when API tests can't validate behavior (UI-specific flows)

Never mock HTTP calls; `convex-test` is only for mocking the Convex backend.

Test hierarchy: API > E2E > unit (last resort)

## Planning Tests

When planning work, outline test scenarios upfront. Create `.ts` files with a human-readable description in a comment at the top - don't implement until approach is confirmed.

## Stagehand E2E Tests

Located in `tests/e2e/`. Uses Stagehand 3 TS via OpenRouter.

Models:
- `google/gemini-2.5-flash-lite` - general actions
- `google/gemini-3-flash-preview` - complex flows

Guidelines:
- prompt-first; avoid brittle selectors
- start dev server before running locally
- set `STAGEHAND_TARGET_URL` for preview URL regression

## Adding Tests

1. Create `.ts` file in appropriate folder (`tests/e2e/` or `tests/api/`)
2. Add scenario description in comment block at top
3. Confirm approach before implementing
4. Run locally before commit; run against preview after deploy
