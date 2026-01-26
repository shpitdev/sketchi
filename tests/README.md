# Tests
- no unit tests or function-level here
- reserved for black-box API or web app flows; run in CI against real services

# Guidance
- avoid brittle checks; core flows only; minimal assertions
- LLMs for grading: Stagehand or visual sanity checks
- goal: few tests, max coverage

# Test SDLC
- pre-implementation: create scenario files w/ expected behavior for approval (pseudo TDD)
- early lifecycle: prompt-first, flexible assertions; expect churn
- mature phase: more deterministic checks

# Test types
- e2e: Stagehand + visual grader of PNG screenshots
- api: only user-facing APIs (e.g., 4 routes for opencode plugin). HTTP actions/functions tested via Convex in packages/backend, not here. see `docs/venom/README.md`
- ci: run on PR creation, produce skim report artifact + full details. Example Stagehand workflow: https://github.com/anand-testcompare/voxelate/blob/main/.github/workflows/release.yml. For release, include artifacts for final merge to main
