# Experiments

Source of truth: code under `packages/backend/experiments/`.

Convex usage today
- `packages/backend/convex/export.ts` imports `packages/backend/experiments/lib/render-png.ts` + `packages/backend/lib/diagram-structure.ts`
- `packages/backend/convex/diagramGenerateFromIntermediate.ts` uses `packages/backend/lib/diagram-intermediate.ts` + `packages/backend/lib/diagram-renderer.ts`

Evidence on disk (artifacts)
- optimization runs: `packages/backend/experiments/output/optimization_2026-01-24_17-00-50`, `packages/backend/experiments/output/optimization_2026-01-24_17-30-14`, `packages/backend/experiments/output/optimization_2026-01-25_06-29-42`, `packages/backend/experiments/output/optimization_2026-01-25_06-53-18`
- diagram layout (Convex): `packages/backend/test-results/diagram-layout.json` + `packages/backend/test-results/diagram-layout.md`
- visual grading (Convex): `packages/backend/test-results/visual-grading.json` + `packages/backend/test-results/visual-grading.md` + `packages/backend/test-results/visual-grading-*.png`
- visual grading (legacy runs): `packages/backend/experiments/output/visual-grading_2026-01-25_02-15-21`, `packages/backend/experiments/output/visual-grading_2026-01-25_06-33-38`, `packages/backend/experiments/output/visual-grading_2026-01-25_06-53-19` (includes `summary.json` with 3/3 pass)
- Browserbase export evidence: Convex test writes PNG + report in `packages/backend/test-results/` (file name derived from test name)
- no `summary.json` under any `optimization_*` folder (expected by `packages/backend/experiments/tests/test-diagram-optimization.ts`)

Mermaid pre-flight
- Use `.opencode/plugins/sketchi/mermaid.ts` tool `mermaid_validate` before committing Mermaid diagrams to GitHub issues/PRs

## Standalone experiment scripts

### 0.1 Share link round-trip
- experiment files: none (migrated)
- test files: `packages/backend/convex/excalidrawShareLinks.test.ts`
- convex migration: yes (`packages/backend/convex/excalidrawShareLinks.ts`)
- evidence: Convex test uses mocked fetch to verify encrypt → upload → fetch → decrypt flow

### 0.2 AI generation quality
- experiment files: none (migrated)
- test files: `packages/backend/convex/diagramGenerateFromIntermediate.test.ts`
- convex migration: yes (`packages/backend/convex/diagramGenerateFromIntermediate.ts`)
- evidence: `packages/backend/test-results/diagram-generate-from-intermediate.json` + `.md`
- unknowns/risks: prompt → IntermediateFormat remains experimental (`packages/backend/experiments/agents/content-analyzer.ts`)

### 0.3 Diagram modification
- experiment files: `packages/backend/experiments/diagram-modification.ts`, `packages/backend/lib/json-repair.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: modification format (add/remove/modify) is not used anywhere else; no tests/artifacts

### 0.4 Auto-layout (dagre)
- experiment files: none (migrated)
- test files: `packages/backend/convex/diagramLayout.test.ts`
- convex migration: yes (`packages/backend/lib/diagram-layout.ts`)
- evidence: `packages/backend/test-results/diagram-layout.json` + `.md`
- notes: arrow routing controlled by diagram type + `graphOptions.layout.edgeRouting`

### 0.5 Arrow optimization
- experiment files: `packages/backend/experiments/arrow-optimization.ts`
- test files: none
- convex migration: no
- evidence: none found on disk
- unknowns/risks: assumes arrows are in Excalidraw element format, not the internal diagram format

## Experiment test suites

### AI utils retry/timeout
- experiment files: `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-ai-utils.ts`
- convex migration: no
- evidence: none found on disk

### Structured output + schema conversion
- experiment files: `packages/backend/lib/diagram-structure.ts`, `packages/backend/lib/diagram-intermediate.ts`, `packages/backend/lib/diagram-renderer.ts`, `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-structured-output.ts`
- convex migration: yes (diagram renderer + intermediate types used by Convex actions)
- evidence: none found on disk

### Two-agent pipeline
- experiment files: `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/experiments/lib/prompts.ts`, `packages/backend/lib/diagram-intermediate.ts`, `packages/backend/lib/diagram-renderer.ts`, `packages/backend/experiments/lib/ai-utils.ts`
- test files: `packages/backend/experiments/tests/test-two-agent-pipeline.ts`, `packages/backend/experiments/tests/test-harder-diagrams.ts`
- convex migration: no
- evidence: none found on disk
- unknowns/risks: two generation paths (`generateDiagram` vs `generateDiagramDirect`) could confuse migration

### PNG render/export (local + Browserbase)
- experiment files: `packages/backend/experiments/lib/render-png.ts`, `packages/backend/lib/diagram-layout.ts`, `packages/backend/lib/diagram-structure.ts`
- test files: `packages/backend/convex/export.test.ts`
- convex migration: yes (`renderDiagramToPngRemote` used by `packages/backend/convex/export.ts`)
- evidence: `packages/backend/test-results/browserbase-export.json` + PNG output

### Visual grading (PNG + LLM)
- experiment files: `packages/backend/experiments/lib/grading.ts`, `packages/backend/experiments/lib/render-png.ts`, `packages/backend/experiments/lib/output.ts`, `packages/backend/experiments/lib/ai-utils.ts`, `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/lib/diagram-intermediate.ts`, `packages/backend/lib/diagram-renderer.ts`, `packages/backend/experiments/lib/prompts.ts`
- test files: `packages/backend/convex/visualGrading.test.ts`
- convex migration: yes
- evidence: `packages/backend/test-results/visual-grading.json` + `packages/backend/test-results/visual-grading.md` + `packages/backend/test-results/visual-grading-*.png`
- local tools: `.opencode/plugins/sketchi/excalidraw-to-png-local.ts` (`excalidraw_png_local`, `visual_grade_local`)
- CLI: `bun run .opencode/plugins/sketchi/excalidraw-to-png-local.ts png <diagram.json> [output.png] [chartType]`

### Diagram optimization suite
- experiment files: `packages/backend/experiments/lib/grading.ts`, `packages/backend/experiments/lib/render-png.ts`, `packages/backend/experiments/lib/output.ts`, `packages/backend/experiments/agents/content-analyzer.ts`, `packages/backend/experiments/agents/diagram-generator.ts`, `packages/backend/experiments/lib/ai-utils.ts`, `packages/backend/lib/diagram-intermediate.ts`, `packages/backend/lib/diagram-renderer.ts`, `packages/backend/experiments/lib/prompts.ts`
- test files: `packages/backend/experiments/tests/test-diagram-optimization.ts`
- convex migration: no
- evidence: multiple output folders (see top); includes `*-intermediate.json`, `*-diagram.json`, `*-grading.json`, `*.png`
- unknowns/risks: no `summary.json` saved in any `optimization_*` folder

## Ambiguities to resolve before Convex migration
- Two generation paths: `generateDiagram` (LLM) vs `generateDiagramDirect` (deterministic). Decide the blessed path for Convex and remove/rename the other.
- Arrow formats differ across experiments (`start/end` bindings vs `fromId/toId`). Standardize before porting.
