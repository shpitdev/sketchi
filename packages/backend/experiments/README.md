# Experiments

Source of truth: code under `packages/backend/experiments/`.

Convex usage today
- `packages/backend/convex/export.ts` imports `packages/backend/experiments/lib/render-png.ts` and `packages/backend/experiments/lib/schemas.ts`

Evidence on disk (artifacts)
- optimization runs: `packages/backend/experiments/output/optimization_2026-01-24_17-00-50`, `packages/backend/experiments/output/optimization_2026-01-24_17-30-14`, `packages/backend/experiments/output/optimization_2026-01-25_06-29-42`, `packages/backend/experiments/output/optimization_2026-01-25_06-53-18`
- visual grading runs: `packages/backend/experiments/output/visual-grading_2026-01-25_02-15-21`, `packages/backend/experiments/output/visual-grading_2026-01-25_06-33-38`, `packages/backend/experiments/output/visual-grading_2026-01-25_06-53-19` (includes `summary.json` with 3/3 pass)
- Browserbase export evidence: Convex test writes PNG + report in `packages/backend/test-results/` (file name derived from test name)
- no `summary.json` under any `optimization_*` folder (expected by `packages/backend/experiments/tests/test-diagram-optimization.ts`)

## Standalone experiment scripts

### 0.1 Share link round-trip
- experiment files: none (migrated)
- test files: `packages/backend/convex/excalidrawShareLinks.test.ts`
- convex migration: yes (`packages/backend/convex/excalidrawShareLinks.ts`)
- evidence: Convex test uses mocked fetch to verify encrypt → upload → fetch → decrypt flow

### 0.2 AI generation quality
- experiment files: `packages/backend/experiments/ai-generation.ts`, `packages/backend/experiments/json-repair.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: uses Excalidraw element skeleton array (different from `lib/schemas.ts` diagram format)

### 0.3 Diagram modification
- experiment files: `packages/backend/experiments/diagram-modification.ts`, `packages/backend/experiments/json-repair.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: modification format (add/remove/modify) is not used anywhere else; no tests/artifacts

### 0.4 Auto-layout (dagre)
- experiment files: `packages/backend/experiments/auto-layout.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: uses `start/end` arrow bindings, not `fromId/toId` used by `lib/schemas.ts`

### 0.5 Arrow optimization
- experiment files: `packages/backend/experiments/arrow-optimization.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: assumes arrows are in Excalidraw element format, not the internal diagram format

### Schema exploration (Excalidraw skeleton)
- experiment files: `packages/backend/experiments/excalidraw-schema.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: duplicates `DiagramSchema` naming but with different structure vs `lib/schemas.ts`

## Experiment test suites

### AI utils retry/timeout
- experiment files: `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-ai-utils.ts`
- convex migration: no
- evidence: none found on disk

### Structured output + schema conversion
- experiment files: `packages/backend/experiments/lib/schemas.ts`, `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-structured-output.ts`
- convex migration: yes (Diagram type used by `packages/backend/convex/export.ts`)
- evidence: none found on disk

### Two-agent pipeline
- experiment files: `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/experiments/lib/prompts.ts`, `packages/backend/experiments/lib/schemas.ts`, `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-two-agent-pipeline.ts`, `packages/backend/experiments/tests/test-harder-diagrams.ts`
- convex migration: no
- evidence: none found on disk
- unknowns/risks: two generation paths (`generateDiagram` vs `generateDiagramDirect`) could confuse migration

### PNG render/export (local + Browserbase)
- experiment files: `packages/backend/experiments/lib/render-png.ts`, `packages/backend/experiments/lib/layout.ts`, `packages/backend/experiments/lib/schemas.ts`
- test files: `packages/backend/convex/export.test.ts`
- convex migration: yes (`renderDiagramToPngRemote` used by `packages/backend/convex/export.ts`)
- evidence: `packages/backend/test-results/browserbase-export.json` + PNG output

### Visual grading (PNG + LLM)
- experiment files: `packages/backend/experiments/lib/grading.ts`, `packages/backend/experiments/lib/render-png.ts`, `packages/backend/experiments/lib/output.ts`, `packages/backend/experiments/lib/ai-utils.ts`, `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/experiments/lib/schemas.ts`, `packages/backend/experiments/lib/prompts.ts`
- test files: `packages/backend/experiments/tests/test-visual-grading.ts`
- convex migration: no
- evidence: `packages/backend/experiments/output/visual-grading_2026-01-25_06-53-19/summary.json` (3/3 pass)

### Diagram optimization suite
- experiment files: `packages/backend/experiments/lib/grading.ts`, `packages/backend/experiments/lib/render-png.ts`, `packages/backend/experiments/lib/output.ts`, `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/experiments/lib/ai-utils.ts`, `packages/backend/experiments/lib/schemas.ts`, `packages/backend/experiments/lib/prompts.ts`
- test files: `packages/backend/experiments/tests/test-diagram-optimization.ts`
- convex migration: no
- evidence: multiple output folders (see top); includes `*-intermediate.json`, `*-diagram.json`, `*-grading.json`, `*.png`
- unknowns/risks: no `summary.json` saved in any `optimization_*` folder

## Ambiguities to resolve before Convex migration
- Two different diagram schemas share the name `DiagramSchema`: `packages/backend/experiments/excalidraw-schema.ts` (element skeleton array) vs `packages/backend/experiments/lib/schemas.ts` (shapes+arrows). Pick one and delete/rename the other to avoid copy-paste drift.
- Two generation paths: `generateDiagram` (LLM) vs `generateDiagramDirect` (deterministic). Decide the blessed path for Convex and remove/rename the other.
- Arrow formats differ across experiments (`start/end` bindings vs `fromId/toId`). Standardize before porting.
