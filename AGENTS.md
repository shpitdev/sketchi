

# Working Preferences

## Communication
- succinct; no filler; fragments OK
- facts first; show evidence (commands + exit codes)

## Engineering
- ship small, testable increments
- readable > clever
- skimmable code; split files at ~400 lines
- descriptive names; long OK
- docstrings: skip or "why" only
- latest packages; `bun install`

## Languages
- TypeScript first
- Go OK for utilities
- avoid Python

## Workflow
- commit + push often (small commits)
- delete obsolete docs/experiments
- use `gh` for GitHub issues/PRs instead of web UI

## Linting
- `bun x ultracite fix` format
- `bun x ultracite check` verify

## Repo
- Turborepo + bun workspaces
- `apps/web/` Next.js frontend
- `packages/backend/` Convex functions
- `bun run dev` all apps
- `bun run build` builds

## Testing
Priority: API > E2E > unit (last resort)

1. **API tests** - for true public APIs (none currently)
2. **E2E tests** - primary method; UI flows

Never mock HTTP; `convex-test` mocks Convex backend only.

## Test Planning
Outline scenarios upfront. Create `.ts` with description comment - confirm approach before implementing.

## Stagehand E2E
Location: `tests/e2e/` | Stagehand 3 TS via OpenRouter

Models:
- `google/gemini-2.5-flash-lite` general
- `google/gemini-3-flash-preview` complex

Guidelines:
- prompt-first; avoid brittle selectors
- start dev server locally
- `STAGEHAND_TARGET_URL` for preview regression

## Adding Tests
1. Create `.ts` in `tests/e2e/`
2. Add scenario comment at top
3. Confirm approach first
4. Run locally before commit; preview after deploy
