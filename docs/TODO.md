# Sketchi - Development TODO

## Phase 0: Experiments (ground truth = code + artifacts)

### Dev server gate (required for every TODO)
- [ ] Run `bun dev` from repo root; confirm Next dev on `:3001` + Convex typecheck passes
- [ ] If `:3001` is in use, stop the old process (e.g. `lsof -nP -iTCP:3001 -sTCP:LISTEN`)

### Evidence + completion tracking
- [x] **0.1 Share Link Round-Trip** - migrated to Convex + tested; experiment removed
- [x] **0.2 AI Generation Quality** - migrated to Convex test + artifacts; experiment removed
- [x] **0.3 Diagram Modification** - migrated to Convex actions + tests + artifacts; experiment removed
- [x] **0.4 Auto-Layout** - migrated to deterministic layout module + Convex test + artifacts; experiment removed
- [x] **0.5 Arrow Optimization** - migrated to lib module + Convex test + artifacts
- [x] **Optimization suite** - artifacts in `packages/backend/test-results/arrow-optimization.*`
- [x] **Visual grading (experiment)** - legacy experiments removed; artifacts now in `packages/backend/test-results/visual-grading.*`
- [x] **Visual grading (Convex test)** - migrated to `packages/backend/convex/visualGrading.test.ts`; artifacts in `packages/backend/test-results/visual-grading.*`
- [x] **Browserbase export** - Convex test writes PNG + report in `packages/backend/test-results/` (output name derived from test name)

### Unify + simplify (delete, don’t rename)
- [x] Delete duplicate schema: keep ONE diagram schema and remove the other
- [ ] Delete unused prompt formats that target the removed schema
- [ ] Two-stage pipeline: LLM **only** for domain analysis → `IntermediateFormat`; deterministic renderer **only** for diagram elements
- [ ] Delete direct LLM-to-diagram element generation path
- [ ] Standardize arrow format to LLM-friendly relation-only input + deterministic layout/edges
- [x] Define `IntermediateFormat` for Excalidraw agent:
  - nodes: id, label, kind, description?, metadata?
  - edges: fromId, toId, label?
  - graphOptions: diagramType + optional global edge/style overrides (apply to whole graph)

### Prompt library
- [x] Create `packages/backend/lib/prompts/library/` with per-domain prompt files (Palantir, GCP, etc.)
- [x] Add `packages/backend/lib/prompts/index.ts` to export prompt registry + helpers
- [ ] Remove giant prompt strings from experiment code once migrated

### Migration policy (per experiment)
- [ ] Define exit criteria: evidence artifact + Convex test + API test (if HTTP)
- [ ] Once done: move logic into Convex, add `.test.ts` next to code, delete experiment script

## Phase 1: Core API

### Infrastructure
- [ ] Add `@orpc/server`, `@orpc/openapi`, `@orpc/zod` to apps/web
- [ ] Add `dagre` or `elkjs` to packages/backend
- [ ] Set up oRPC router with OpenAPIReferencePlugin
- [ ] Configure Scalar docs at `/api/docs`

### Convex Backend
- [ ] Define schema (diagrams, techStacks tables)
- [ ] Implement `diagrams.generate` action
- [ ] Implement `diagrams.modify` action
- [ ] Implement `diagrams.parse` action
- [ ] Implement `diagrams.share` action
- [ ] Rename `packages/backend/convex/export.ts` to a hyper-descriptive action file (and update imports)

### Core Libraries
- [ ] `lib/excalidraw-share.ts` - encrypt/upload/parse share links (LLM-friendly schema only)
- [x] `lib/json-repair.ts` - repair LLM JSON output
- [x] `lib/diagram-layout*.ts` - deterministic layout + arrow routing (single source of truth)
- [ ] `lib/diagram-simplify.ts` - simplify diagram for agent consumption
- [ ] `lib/prompt-registry.ts` - consume `packages/backend/prompts/` exports

### oRPC Endpoints
- [ ] `POST /api/diagrams/generate`
- [ ] `POST /api/diagrams/modify`
- [ ] `POST /api/diagrams/share`
- [ ] `GET /api/diagrams/parse`

### Verification
- [ ] Convex tests colocated with code (`*.test.ts` next to actions)
- [ ] API tests in `tests/api/` only for HTTP protocol behavior
- [ ] End-to-end API test: prompt → share link
- [ ] End-to-end API test: share link → modify → new share link
- [ ] Scalar docs render correctly

## Phase 2: OpenCode Plugin

- [ ] Create `packages/opencode-plugin` workspace
- [ ] Implement `diagram_generate` tool
- [ ] Implement `diagram_modify` tool
- [ ] Implement `diagram_parse` tool
- [ ] Publish to npm as `@sketchi/opencode-plugin`
- [x] Add local PNG exporter: `.opencode/plugins/sketchi/excalidraw-to-png-local.ts` (invokable; optimization later)

## Phase 3: Tech Stack Schemas

- [ ] Extend Convex schema (components, validationRules, examples)
- [ ] Seed Palantir Foundry schema
- [ ] Implement validation engine
- [ ] Add tech stack selection to API

## Future

- [ ] Phase 4: Icon Library Generator
- [ ] Phase 5: Export Rendering (PNG/SVG/PDF via Daytona)
- [ ] Web UI with embedded Excalidraw canvas
- [ ] Auth integration with WorkOS 
- [ ] explore viability of cloudflare browser rendering api. need new experiment
