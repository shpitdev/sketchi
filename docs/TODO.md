# Sketchi - Development TODO

## Phase 0: Experiments (ground truth = code + artifacts)

### Evidence + completion tracking
- [x] **0.1 Share Link Round-Trip** - migrated to Convex + tested; experiment removed
- [ ] **0.2 AI Generation Quality** - no artifacts on disk; decide schema + add artifact or convert to Convex test + delete experiment
- [ ] **0.3 Diagram Modification** - no artifacts on disk; decide format + add artifact or convert to Convex test + delete experiment
- [ ] **0.4 Auto-Layout** - no artifacts on disk; standardize arrow format + add artifact or convert to Convex test + delete experiment
- [ ] **0.5 Arrow Optimization** - no artifacts on disk; move to deterministic module + add artifact or convert to Convex test + delete experiment
- [x] **Optimization suite** - artifacts in `packages/backend/experiments/output/optimization_*`
- [x] **Visual grading** - artifacts in `packages/backend/experiments/output/visual-grading_*` with summary.json
- [ ] **Browserbase export** - artifact name mismatch (`spike-browserbase-export.png` vs expected `browserbase-test.png`); re-run or update script

### Unify + simplify (delete, don’t rename)
- [ ] Delete duplicate schema: keep ONE diagram schema and remove the other
- [ ] Delete unused prompt formats that target the removed schema
- [ ] Two-stage pipeline: LLM **only** for domain analysis → `IntermediateFormat`; deterministic renderer **only** for diagram elements
- [ ] Delete direct LLM-to-diagram element generation path
- [ ] Standardize arrow format to LLM-friendly relation-only input + deterministic layout/edges

### Prompt library
- [ ] Create `packages/backend/prompts/` with per-domain prompt files (Palantir, GCP, etc.)
- [ ] Add `packages/backend/prompts/index.ts` to export all prompts
- [ ] Remove giant prompt strings from experiment code once migrated

### Migration policy (per experiment)
- [ ] Define exit criteria: evidence artifact + Convex test + API test (if HTTP)
- [ ] Once done: move logic into Convex, add `.test.ts` next to code, delete experiment script

## Phase 1: Core API

### Infrastructure
- [ ] Add `@orpc/server`, `@orpc/openapi`, `@orpc/zod` to apps/web
- [ ] Add `dagre` or `elkjs` to packages/backend
- [ ] Set up oRPC router with OpenAPIReferencePlugin
- [ ] Configure Scalar docs at `/docs`

### Convex Backend
- [ ] Define schema (diagrams, techStacks tables)
- [ ] Implement `diagrams.generate` action
- [ ] Implement `diagrams.modify` action
- [ ] Implement `diagrams.parse` action
- [ ] Implement `diagrams.share` action
- [ ] Rename `packages/backend/convex/export.ts` to a hyper-descriptive action file (and update imports)

### Core Libraries
- [ ] `lib/excalidraw-share.ts` - encrypt/upload/parse share links (LLM-friendly schema only)
- [ ] `lib/json-repair.ts` - repair LLM JSON output
- [ ] `lib/diagram-layout.ts` - deterministic layout + arrow routing (single source of truth)
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
- [ ] Add local PNG exporter: `.opencode/plugins/sketchi/excalidraw-to-png-local.ts` (invokable; optimization later)

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
