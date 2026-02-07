## Repo CI / Deploy Note
- Vercel Preview/Prod: `NEXT_PUBLIC_CONVEX_URL` is set automatically by the Convex deploy step. If it's undefined, the Convex deploy is failing (debug that first).
- Pre-push sanity: `bun x ultracite fix`, `bun x ultracite check`, `bun run check-types`, `bun run build`, and `cd packages/backend && bunx convex codegen && bun run test`.

---

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
Priority: API > E2E > manual/verification > unit (last resort)

1. **API tests** - for true public APIs (none currently)
2. **E2E tests** - primary method; UI flows
3. **Manual Verification** - for fixes where CI tests add low value; use checklist + log analysis

Never mock HTTP; `convex-test` mocks Convex backend only. Verify functional intent/behavior over code coverage.

## Test Planning
Outline scenarios upfront. Create `.ts` (for E2E) or a manual checklist (for verification) with description comment - confirm approach before implementing. 

For manual verification, structure the checklist and log requirements so they could be automated via an LLM (e.g. "analyze logs for X abnormality"). Add results/logs to issue comments.

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
