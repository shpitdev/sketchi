# Sketchi - Development TODO

## Phase 0: Experiments

- [x] **0.1 Share Link Round-Trip** - Validate encrypt → upload → fetch → decrypt
- [x] **0.2 AI Generation Quality** - Test prompts, measure success rate (gemini-3-flash: 100%)
- [x] **0.3 Diagram Modification** - Test simplified vs full JSON for agent
- [x] **0.4 Auto-Layout** - Validate dagre for positioning
- [x] **0.5 Arrow Optimization** - Edge-to-edge arrow connections

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

### Core Libraries
- [ ] `lib/excalidraw-share.ts` - encrypt/upload/parse share links
- [ ] `lib/json-repair.ts` - repair LLM JSON output
- [ ] `lib/optimize-arrows.ts` - edge-to-edge arrow connections
- [ ] `lib/layout.ts` - auto-layout with dagre/elkjs
- [ ] `lib/simplify.ts` - simplify diagram for agent consumption
- [ ] `lib/prompts.ts` - system prompts for generation/modification

### oRPC Endpoints
- [ ] `POST /api/diagrams/generate`
- [ ] `POST /api/diagrams/modify`
- [ ] `POST /api/diagrams/share`
- [ ] `GET /api/diagrams/parse`

### Verification
- [ ] End-to-end test: prompt → share link
- [ ] End-to-end test: share link → modify → new share link
- [ ] Scalar docs render correctly

## Phase 2: OpenCode Plugin

- [ ] Create `packages/opencode-plugin` workspace
- [ ] Implement `diagram_generate` tool
- [ ] Implement `diagram_modify` tool
- [ ] Implement `diagram_parse` tool
- [ ] Publish to npm as `@sketchi/opencode-plugin`

## Phase 3: Tech Stack Schemas

- [ ] Extend Convex schema (components, validationRules, examples)
- [ ] Seed Palantir Foundry schema
- [ ] Implement validation engine
- [ ] Add tech stack selection to API

## Future

- [ ] Phase 4: Icon Library Generator
- [ ] Phase 5: Export Rendering (PNG/SVG/PDF via Daytona)
- [ ] Web UI with embedded Excalidraw canvas
- [ ] Auth integration with WorkOS AuthKit
