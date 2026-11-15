# Sketchi product structure and Effect execution

Replace the technical layers with product ownership, and remove the custom mechanisms Effect can own. This is the agreed execution plan following the complete mindmap example and the architecture review with the existing Fable collaborator. It supersedes the package-preservation assumption and slice order in [the original Effect plan](effect-everywhere.md); that plan remains evidence for runtime requirements and baselines.

PR 810 remains staging. The user will review and merge it. A structural checkpoint is useful progress, but does not complete the Effect migration. The primary continues through the full plan, reporting actual gaps rather than promising a finishing date.

Units 0–3 are accepted and integrated. The shared family list and build operation are in place, with mindmap, Venn and sequence converted. The remaining families, host state and resource ownership, app/tool moves and final preview proof remain open. This is the structural checkpoint, not final PR readiness.

The Icons client feature unit is also accepted locally: native atoms, Cache, streams, browser storage and Radix now own its state, action lifetimes and modal behavior. Real local preference recovery, cross-tab changes, exports and warm-cache failure/retry flows passed. The native IntersectionObserver and clipboard activation boundaries are named gaps. Icons server/domain work and shared diagnostic promotion remain open; this client acceptance is not final preview or production proof.

Sequence also removes its duplicate contract, normalization/projection and runtime workflow. The first plain-family unit derives descriptors from build policy, binds host capabilities once, exposes generic preparation, shares family counts and slug policy, and preserves the released CLI’s accepted warning codec. Seven immutable cases retain identical scene/native/file artifacts, full sequence fuzz and real local edit/save/reload/export passed, and malformed CLI document paths were corrected. Its measured build/export cost increased 3.17%; layout timing was unchanged within the paired runs. Other plain and graph families remain open.

## Target structure

```text
apps/
  studio/                 # current playground: chat, projects, tool hosting, Worker assembly
  icons/                  # catalog/community pages and their Worker assembly
  editor/                 # current excalidraw: the standalone editing application
  web/                    # marketing site
  cli/                    # commands, terminal input/output, Node assembly
packages/
  diagrams/src/
    families/
      mindmap/            # document, layout, readout, policy and focused tests
      flowchart/          # document, edits and graph policy
      ...other families/
    graph/                # shared rank/place/route/label/group algorithms
    family.ts             # derives host wiring from each family schema and operation
    canvas/               # direct authoring operations over the shared drawing model
    generate/             # model-to-document workflow and family-specific prompts
    build/                # shared typed build/export operation and result schemas
    http-api.ts           # real shared HTTP contract and generated client
  icons/src/
    catalog/              # manifest, search and SVG source operations
    community/            # moderation, persistence, publication and contract
    draw/                 # author/judge workflow and recipe semantics
  drawing/src/
    scene.ts              # one canvas representation shared by diagrams and icons
    geometry/             # real shared text/shape/curve operations
    excalidraw/            # native types, binding translation, files and exports
    svg/                  # SVG import
    artifacts.ts          # shared export/storage capability required by build workflows
  editor/src/             # one React editor surface over native Excalidraw scenes
  cloudflare/src/         # only concrete shared host adapters, e.g. stored-key gateway transport
  observability/src/      # actual shared telemetry exporter
  ui/src/                 # presentation primitives
  social-card/src/        # real shared web/icons server renderer; no forced rewrite
tools/
  scenarios/              # scenario runner; product fixtures belong to their family
  icon-batch/             # executable caller of icons/draw
  storybook/              # composition and visual inspection
  generators/             # useful composition of upstream Nx generators only
  lint/                   # real lint rules
  ops/                    # typed operational commands
```

These are ownership boundaries, not a requirement to generate a new Nx project for each folder. Keep schema/browser/server subpath imports explicit. No barrel that loads providers or Workers into browser consumers. Public entrypoints are the few actual operations callers need, not every helper, fixture or intermediate type.

Dependency direction: diagrams may use icons and drawing; icons uses drawing; drawing imports neither domain. Editor uses drawing. Apps assemble workflows with real host layers. Shared Cloudflare code contains actual foreign binding adapters, not a runtime manager, service base or configurable universal platform.

The currently shared icon recipe/shape data moves to its proper owner with consumers updated. It must not create icons→diagrams→icons cycles. Provider codecs belong to installed upstream providers; only a demonstrated binding or SDK gap remains local. Studio projects have only Studio consumers in the inspected source, so their browser/server code belongs to Studio's projects feature rather than a standalone package.

## Where existing projects go

- diagram-core, diagram-renderer and diagram-agent stop being separate public layers. Family contracts, normalization, layout, quality and operations move together in diagrams. Their shared canvas/geometry/artifact machinery moves to drawing.
- diagram-generation joins diagrams/generate. Its icon provider transport dependency is removed by placing the concrete shared gateway adapter at the host boundary.
- diagram-excalidraw and svg-excalidraw join drawing/excalidraw and drawing/svg.
- diagram-ui becomes editor; app-specific panels and page controllers return to their owning app. Remove forwarding components and restated scene types.
- icon-catalog, community-icons and icon-draw become the corresponding icons features. Actual browser/server exports stay distinct.
- studio-projects moves into studio/features/projects. Rename playground/excalidraw app directories to studio/editor when their wiring is moved; preserve actual deployed identities unless deliberately changing them.
- diagram-scenarios and native-conversion-storybook become tools. Keep the Nx name `diagram-scenarios` during relocation and pair the real Frontierclimb path/fingerprint update. Frontierclimb runs the graded catalogs but currently calls Sketchi for deterministic case discovery and grading; those implementations cannot be deleted on the assumption that Frontierclimb already owns them. Family expected diagrams belong with their family; editor regression support retains an explicit local owner.
- CLI remains an application with feature-owned commands/store/render/share/terminal folders; its custom I/O and lifetime mechanisms are addressed below. Web, icon-batch, observability, ui and social-card change only for actual ownership or Effect gaps.

## What Effect owns

Decode unknown input once with the owning Schema. Derive tool/HTTP/client descriptions from that contract. Do not recreate Schema's issue tree or legacy wording unless a real caller consumes it. Carry typed errors through the workflow and project them into a transport response at the host edge.

Effect owns resource scope, interruption, retry policy, bounded concurrency, streams, cache/in-flight ownership and application state. Remove the corresponding maps, callbacks, listener registries, Promise queues, timers and parallel status models. A service tag is justified by an external capability or replaceable implementation, not by the existence of a helper function.

Pure layout remains a direct computation using appropriate Effect data/graph primitives. Effect does not supply Sketchi's layout policy, readable text placement, curve geometry or native editor bindings. Replacing a native map with MutableHashMap while keeping the same redundant representation is not completion.

Fixed API-usage diagnostics and old exact-output oracles do not define the new architecture. Preserve correctness enforcement and real product behavior. If an internal representation is intentionally removed, update its callers and discard its obsolete oracle rather than retaining an adapter just to preserve old bytes.

## Shared operations and family policy

A family folder owns its authored document schema, normalization and limits, layout, readout and quality policy. Filenames are a convention: do not create empty modules or checks that require a particular file count. Shared graph code is split by real functions and dependency direction.

The family list covers all 15 families using their existing build operations before the next semantic conversion. Studio, HTTP, Toolkit/MCP documentation, CLI catalog and Storybook consume this one list. Derive types and schemas from actual owners; no casts, second runtime dispatch framework or duplicated metadata definitions. Flowchart edits and direct canvas remain distinct operations.

The mindmap example deletes the tree-to-flat-graph-to-tree representation, duplicate schemas and metadata validation, and forwarding editor components. Its remaining generic request/result schemas, issue projection and quality/render/export branches must move to `diagrams/src/build/` before a second family is converted. One shared operation takes the document schema and the actual normalization/check/assessment/render functions; one schema derivation supplies the request/result envelope. Family build files contain only policy and disappear where none is needed. Issue codes stay with their owner and are composed in build, not accumulated in a new monolithic contract.

The units 2–3 architectural review adds five refinements to the first plain-family unit before the pattern is repeated: derive converted family descriptors from their build policy and bind capabilities once; make assessment optional for families with no quality policy and share family counts with the app; expose pre-decode preparation through the descriptor instead of naming mindmap at generic boundaries; keep one slug function in `clean-text.ts`; and preserve published warning codes in accepted responses because the released CLI decodes those against a closed code list. Failure diagnostics have a different consumer. Keep the shared result definitions free of another family registry or dependency cycle.

## Tests and persistence

Delete tests with obsolete representations and mechanisms, including forwarding, source/file inventories, upstream framework guarantees and repeated fixture smoke. Preserve real domain counterexamples, invalid inputs, export bindings, CLI security/process behavior, storage ownership and editor operations once. Record the purpose and retained owner of removed tests. Test counts are not quotas, and a full gate is not proof that the architecture is smaller. Each unit reports source and test line deltas separately, distinguishing mechanical moves; explain net growth.

Use temporary before/after corpora for redesign proof; do not install another permanent census. The mindmap example keeps nested CLI documents, CanvasSpec and native drawing formats unchanged. Its real CLI persistence and local editor save/reload checks passed; remote historical population remains unknown. A later stored-shape change requires actual affected-data inventory and an explicit migration with cost. Live owned callers change outright, without speculative compatibility layers.

## Units, in order

Each implementation unit has one author and one coherent commit set in an isolated worktree, integrated by the primary only. Read-only reviews and gate helpers can use the held checkout.

Concurrency: units 0 to 3 are strictly serial, one author. After the structural checkpoint, at most two implementation authors at once, and at most four active agents in total counting the primary, authors and reviewers. A Fable review takes one of those slots while it runs. Host units overlap with family units only where the owned files are shown to be disjoint.

| # | Unit | Author | Proof before integration |
|---|------|--------|--------------------------|
| 0 | Integrate the reviewed mindmap example and its three boundary corrections. Record the agreed roles, structure and actual Frontierclimb ownership in the repository instructions and this plan. | primary | Review findings closed; gate on the integrated tree |
| 1 | Mechanical move, no semantics. The other 14 families' schema, layout, readout and fixtures into `diagrams/src/families/<name>/`; mindmap relocated there. `scene.ts`, `curved-routes`, `scene-rules`, `planarity`, `intermediate` into `diagrams/src/graph/` unsplit. `agent` runtime and contract into `diagrams/src/build/` unsplit. `generation` and `coverage.ts` into `diagrams/src/generate/`; gateway transport into `packages/cloudflare`. Delete `packages/diagram/{core,renderer,agent,generation}` with no aliases. Hardcoded project inventories in `tools/` go with the layout they describe; dependency direction stays enforced by Nx tags and lint. | Sol high | Emitted-body identity as in `mechanical-proof.json`; byte-identical CanvasSpec and native artifacts for the named corpus in every family; full gate |
| 2 | `family.ts` over all 15 existing operations. Studio, MCP docs, CLI catalog and Storybook loop over it. Delete the 15 route folders, the per-family chat tool files and the per-family sections of `mcp-docs/catalog.ts`. URLs, tool names and docs output unchanged. | Astra xhigh | Captured HTTP and MCP corpora replay identically; real local Studio build of two families; gate |
| 3 | Generic build envelope (described above), applied to mindmap and venn. Venn collapses to one document schema. | Astra xhigh | Identical stored/native artifacts; captured result differences checked against real consumers; venn fuzz full run; gate |
| 4 | The remaining plain families, one unit each: sequence, timeline, chart, quadrant, journey, sankey, gantt, org-chart, wireframe. Gantt precedes org-chart because org-chart uses its routing; timeline precedes Gantt, chart precedes Sankey, and org-chart precedes wireframe for their existing shared dependencies. Each deletes its copies in the old contract and runtime and its duplicated tests. | Sol high; primary integrates one at a time | Identical artifacts, or an explained difference with PNGs inspected; that family's full fuzz; timing budget; removed-test mapping; net lines |
| 5 | Graph families: split `graph/`, then flowchart, state machine, ER, class. | Astra xhigh | As unit 4, plus the full routing fuzz and the edit, save and reload path in the real editor |
| 6 | Host side, by feature folder: Studio (`chat`, `build`, `mcp`, `render`, `projects`), Icons, CLI (`commands`, `store`, `render`, `share`). Each folder move carries its Effect replacement from the mechanism table below; a move without the replacement is not this unit. The paused MCP and provider candidates are evidence to port, not branches to merge. May overlap units 4 and 5 only within the concurrency cap and with disjoint ownership shown first. | Sol high for splits, Astra xhigh for chat and MCP transport | The per-mechanism proof below; real-page checks |
| 7 | `packages/diagram/scenarios` to `tools/scenarios` with the paired Frontierclimb PR. `scripts/` to `tools/ops`, `tools/oxlint` to `tools/lint`. Close the test-purpose audit. | Sol high | Frontierclimb's real runner lists and grades one case from the new path; gate |

Use the authorized Codex models by default. A stalled or overly complex unit gets a smaller scope and a design review before any model substitution.

## Two finish lines

The tree above is the structural target only. The goal is still Effect owning application internals and state. The primary reports against these two lines separately and never lets the first stand in for the second.

**Structural checkpoint** (units 0 to 3):

- The diagrams, drawing and editor ownership cut is done: all family, graph, build and generate code lives under `packages/diagrams`, `packages/drawing` and `packages/editor`, and `packages/diagram/{core,renderer,agent,generation}` are gone with no aliases. App, CLI and tools folders have not moved yet; that is units 6 and 7.
- The family list drives Studio, MCP docs, the CLI catalog and Storybook; the per-family app files are gone.
- The generic build envelope exists and mindmap and venn use it.
- Drawings and persisted formats remain unchanged, and HTTP/MCP statuses and real consumers are preserved. All captured mindmap bodies are identical. Venn intentionally adds its document tag, owning rejection codes, Schema diagnostic wording and storage partial identity; these are recorded response changes, not blanket byte-identity claims. The product gate passes, with focused proof for the final test-only correction.
- It makes no claim about Effect ownership beyond what was already adopted. PR 810 at this point is titled and described as a checkpoint and lists every row below that is still open.

**Complete final PR** requires all of:

1. Every row in the mechanism table is closed: the old mechanism and its dependency are deleted, or the residual native code is named with the specific upstream gap.
2. All 15 families have one document schema and use the generic build; the old contract and runtime copies are gone.
3. None of these remain in any manifest: `ai`, `@ai-sdk/*`, `@tanstack/react-query`, `idb-keyval`, `@modelcontextprotocol/*`, `agents` (after its `vite.config.ts` consumer is resolved). A host dependency may stay only under the rule in criterion 1: one named, bounded Effect service around it, with the concrete upstream gap and its cost proof recorded. `@google/genai` is the known case (see the provider row). Deleting a dependency is never a reason to drop provider options or to write a custom generic `LanguageModel`.
4. The Effect-native diagnostic group is error in every project, and each suppression carries a local reason.
5. Each replaced runtime has its real proof from the last column, not an in-memory test.
6. Every retained test has a stated behaviour and one owner; the removed-test mapping exists for each unit.
7. The PR description states the evidence gaps below that are still open. A gap is closed by evidence, not by the code compiling.

## Mechanism disposition

Starting state is the mindmap example; exact checkpoints and reviews are in the local handoff receipts. "Keep" means already on the upstream capability; do not re-migrate it.

| Mechanism today | Where | Disposition | Proof that closes it |
|---|---|---|---|
| AI SDK chat loop and browser `useChat` (11 files) | `server/chat/*`, `server/ai/model.server.ts`, `features/playground/*`, `components/ai-elements/*` | Replace both ends together with `Chat.streamText`, AG-UI events and atoms on a new route; delete the old `/api/chat`. No dual loop. | Gateway payload diff for the same turn; held text, one build at a time, empty-output retry, 400/413/503 before stream; real page success, cancel, retry, reload; Frontierclimb quality and cost on the same inputs |
| MCP SDK servers, `agents/mcp`, `effect-mcp-adapter.server.ts` | `server/codemode/mcp.server.ts`, `apps/icons/src/lib/mcp.server.ts`, `vite.config.ts` | Replace with Effect `McpServer` over the shared Toolkit. Host is `layerHttpRequestScoped` only if every configured client is sessionless; otherwise `layerHttp` in a session-owned Durable Object. No per-isolate session map. | Real clients initialise, list, call and fetch artifacts across requests, isolate change, redeploy and an idle gap; `mcp-validation-issues-v2.json` replayed |
| Code Mode sandbox loader | `execute.server.ts` | Keep as a narrow external service. Replace the Promise composition, lifetime and error translation around it. | Receipts, partial results and PNG budgets unchanged |
| Handwritten HTTP clients and route handlers | `packages/studio/projects/src/client-api.ts`, `server/codemode/api.server.ts`, `server/generation/api.server.ts`, CLI `generation.ts`, `canvas.ts`, `icon-draw.ts` | One `HttpApi` contract in `diagrams/http-api.ts` and the projects feature; generated clients in browser and CLI. | The last released CLI completes its four network commands against a preview of both Workers; `http-status-compatibility-v1.json` replayed |
| Icons HTTP API and community client | `packages/icons/*/http-api.ts`, `apps/icons/src/lib/http.server.ts`, `apps/cli/src/community-client.ts` | Keep. Already `HttpApi`. | None new |
| React Query | `features/resources/use-async-resource.ts` | Replace with atoms; remove the dependency. | Real SSR request makes no query I/O |
| Query atoms in Icons and the SVG workspace | `apps/icons/src/lib/*-atoms.ts`, `apps/excalidraw/src/lib/svg-source-atom.ts` | Keep. | None new |
| `useSyncExternalStore` stores, direct `localStorage` | `apps/icons/src/lib/selection.ts`, `use-drawn-names.ts`, `use-modifier-label.ts`, `icon-library.tsx` | Atoms plus `BrowserKeyValueStore`, keeping the raw `on`/`off` values and cross-tab sync. Candidate `3586d2f0` is reference. | Existing preference survives reload; storage event from a second tab; failed write |
| Editor synchronisation | `packages/editor/.../excalidraw-scene-canvas.tsx` | Keep as the one foreign-library adapter. Residual by design. | Edit, save, reload in the real editor |
| `idb-keyval` drafts and their Promise queue | `features/studio/drawing-drafts.ts` | Typed IndexedDB service opening the existing version-1 store without an upgrade, plus a coalescing queue. | A draft written by current production code reopens; rapid edits coalesce; clear cannot resurrect a queued write |
| Raw D1 access | `packages/icons/community/src/store.ts`, `apps/icons/src/lib/excalidraw-publish.server.ts` | `@effect/sql-d1` with `batch` for atomic work. No migrator for one table. | Existing rows and constraints intact on a preview; note previews share one D1 database |
| Quota and rate-limit Durable Objects | `IconDrawBudget`, `ClientRateLimit` (both Workers) | Effect SQL programs inside the existing object shells by default. Move to `CloudflareCluster` only with the freeze-and-seed transfer from `effect-everywhere.md` slice 8 proven. | Last-slot contention, UTC rollback, budget not reopened by retry |
| PNG renderer object and render pool | `CodeModePngRenderer`, `browser-render-pool.server.ts` | Keep `Pool` and `RcMap`. Keep the object shell unless a live browser handle is shown to survive the Effect host path. | Warm export latency unchanged |
| R2 project storage | `packages/studio/projects/src/server/bucket.ts` | Keep as one typed adapter with ETag and conditional writes. Residual by design: no upstream R2 service. | Failed write exposes no partial artifact; cross-session access denied |
| Icon author, judge and Jev providers | `packages/icons/draw/src/lib/google-judge.ts` (`@google/genai`), `author-model.ts`, `generation/jev-workers-ai.ts` | Author and Jev: upstream provider packages over the gateway binding transport in `packages/cloudflare`. Google judge: keep `@google/genai` inside one named Effect service. Effect 4.1.4 has no compatible Google provider, and the native `media_resolution` request returned 400 through OpenAI compatibility; the credential-free SDK path in a Worker was proven and accepted (receipts in t1mg's `.memory/effect-google-judge` and `effect-google-judge-host`). Replace it only if upstream reaches real parity. Never lose the media or thinking options. Paused provider candidates are reference. | Same wire options, thinking and cache usage, cancellation; same cost and quality receipts; the Google gap restated with its evidence in the PR |
| CLI crypto, filesystem, process | `share-protocol.ts`, `storage.ts`, `filesystem.ts`, `png-renderer-runtime.ts` (32 files import `node:*`) | Effect crypto, `FileSystem`, `process`. Keep a platform fallback only where it preserves a real guarantee such as no-follow writes. | Existing encrypted share decrypts; offline commands stay offline; symlink protection; child process tree terminates |
| Operator scripts | `scripts/**/*.mjs` (2,606 lines) | Typed Effect in `tools/ops`. `ci-local.mjs` stays a minimal bootstrap. Source-string tests are deleted, not translated. | Preview deletion cannot remove another owner's resource; one real gate run |
| Telemetry exporter | `packages/observability` | Upstream spans and exporters with a narrow Pipeline sink. Request-scoped flush through `waitUntil`; no module-scope timer. | One live request joined to its gateway log, artifact and retained span rows |
| Remaining `async` functions (98 files), `Effect.tryPromise` wrappers (33), global `fetch` (13), timers (10) | throughout | Not a count to drive down for its own sake. Each goes with its owner above; what is left must be a host callback or a named gap under the diagnostic ratchet. | Diagnostic group at error |

## Evidence and cost gaps that cannot be inferred closed

These are open today. Code that compiles and a green local gate do not close any of them.

- **Stored data.** R2 was sampled at 12 metadata objects and one artifact prefix, with the listing truncated at 100. Historic mindmap blobs and other users' browser drafts are unknown, not absent. Any unit that changes a stored shape needs a real inventory first; units that keep formats need none.
- **MCP clients.** Which protocol revisions the real configured clients use decides the host. Frontierclimb's wrapper has a source-only reconnect receipt; reset, idle and redeploy against a real session host are unproven.
- **Released CLI.** Retained evidence includes released-command runs, captured error bodies and decoder replays, but not all four successful commands against the final combined Worker tree. Complete that real preview proof; reuse unchanged captures.
- **Studio persistence.** Both mindmap and Venn now have real local artifact edit/export/reload proof and browser-local Studio project edit/save/reload/export proof. The normal UI says there is no account yet, and its session resolver creates anonymous sessions; signed-in R2 proof is not an implemented flow that merely needs a login. Clarification is pending on whether to keep sign-in outside this restructure and verify the existing persistence boundaries, or add that product flow. No additional authentication scope is assumed.
- **Preview.** The last preview deployed web, icons and editor; Studio failed on source-map size. The independently reviewed fix `0657e0d6` is integrated as `877012f6` with identical patch identity and passes local Worker packaging. It has not been deployed; the new Studio tree has no preview proof yet.
- **Provider cost and quality.** No inference was run in the restructure so far. Chat, generation and icon provider changes each need the same Frontierclimb inputs before and after. Honor the actual prior authorization and remaining call budgets; obtain a concrete bounded budget only where none exists. Do not repeat paid proof for unchanged code.
- **Durable Object cost.** Requests, rows and billable operations per admission are unmeasured for any cluster-based quota design.
- **Bundle and cold start.** Moving API dispatch to the worker entry changes eager evaluation. Unmeasured.
- **Performance budgets.** Only mindmap was re-measured for this structural example. Earlier planarity and other-family receipts cover their exact prior checkpoints, including the SVG RSS repeatability limitation. Changed families need their own final comparison; unchanged groups can reuse identity-backed proof.
- **Test purpose audit.** 3,211 test bodies were unresolved at the last count. The estimates in `target-structure.html` are not an audit.

## Ownership and reporting

One fresh Astra/high primary owns the canonical staging branch and integration; authors own isolated worktrees. Work remains serial through units 0–3. Afterwards use at most two authors, at most four active agents including the primary and reviewers, and only demonstrably disjoint ownership. The existing Fable collaborator reviews after unit 1, after units 2–3, after the graph split and before the PR is called ready; do not spawn another Fable. Independent code reviews stay read-only and use the smallest unreviewed base. The same model in separate sessions is not self-review.

Reuse immutable passing evidence for unchanged code and verified moves. Changed behavior needs focused real-consumer proof; run the required local gate on a coherent integrated tree before publication. Keep one watcher and preserve user focus. Unfinished MCP, preference and provider candidates are evidence to port into the new ownership, not branches to merge blindly. The final PR describes completed ownership, deleted mechanisms and tests, actual proof, and every remaining limitation. Do not mark the full migration ready merely because the structural checkpoint passes.
