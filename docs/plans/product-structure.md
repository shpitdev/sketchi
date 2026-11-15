# Sketchi product structure

Direction: replace the existing technical layers with product ownership. Work proceeds serially: define the complete structure, implement mindmap as one end-to-end example, then assess the result before expanding. Existing staging and unfinished branches are preserved. This supersedes the package-preservation assumption and execution order in [the original Effect adoption plan](effect-everywhere.md).

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
    mindmap/              # document schema, layout, quality and build operation
    flowchart/            # document, edits, graph policy, layout and build
    ...other families/
    canvas/               # direct authoring operations over the shared drawing model
    generate/             # model-to-document workflow and family-specific prompts
    build.ts              # shared build/export orchestration, not a method for every family
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
  generators/             # only useful composition of upstream Nx generators
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
- diagram-scenarios and native-conversion-storybook become tools. Keep actual scenario/fuzz inputs and counterexamples near their domain owner; no repository-hosted replacement for Frontierclimb grading.
- CLI, web, icon-batch, observability, ui and social-card remain where they have actual ownership. A restructure is not a reason to manufacture changes to them.

## What Effect owns

Decode unknown input once with the owning Schema. Derive tool/HTTP/client descriptions from that contract. Do not recreate Schema's issue tree or legacy wording unless a real caller consumes it. Carry typed errors through the workflow and project them into a transport response at the host edge.

Effect owns resource scope, interruption, retry policy, bounded concurrency, streams, cache/in-flight ownership and application state. Remove the corresponding maps, callbacks, listener registries, Promise queues, timers and parallel status models. A service tag is justified by an external capability or replaceable implementation, not by the existence of a helper function.

Pure layout remains a direct computation using appropriate Effect data/graph primitives. Effect does not supply Sketchi's layout policy, readable text placement, curve geometry or native editor bindings. Replacing a native map with MutableHashMap while keeping the same redundant representation is not completion.

Fixed API-usage diagnostics and old exact-output oracles do not define the new architecture. Preserve correctness enforcement and real product behavior. If an internal representation is intentionally removed, update its callers and discard its obsolete oracle rather than retaining an adapter just to preserve old bytes.

## One complete example: mindmap

Before: nested request → normalized tree → flat nodes/edges with repeated depth/order metadata → graph validation → rebuilt measured tree → scene → Excalidraw → several editor wrappers.

After: shared recursive document schema → one normalization/limit check → measured ordered tree → layout → shared drawing scene → one Excalidraw adapter/editor. Build/export uses the common Effect workflow and actual artifact/render services.

Delete the flat mindmap node/edge metadata schemas, flattening/reconstruction, repeated parent/depth/order validation and duplicated generated/Code Mode schemas. Move the family's code and real tests together. Adapt generation, CLI/build, sample UI, scenarios and documented examples to the same document. Do not leave old exports, aliases or dual internal models.

This example must demonstrate the target ownership in running product code. Do not expand into rewriting the other fourteen families, chat, providers, MCP hosting or preference controllers. Mechanical prerequisite moves should preserve their blobs; identify them separately from the actual semantic changes. All existing worker candidates remain reference checkpoints, not required inputs.

Input and output are different promises: changing private canonical IR is allowed; readable drawings, stable exported identity/order where used, valid bindings, edits and save/reload must still work. Existing CanvasSpec is a real createCanvas input and existing artifacts may contain it; do not delete it on an assumption that it has no consumers.

## Tests and stored data

Delete tests of impossible metadata states with the removed representation. Delete forwarding, file/existence, source spelling, upstream collection/schema behavior and repeated fixture-validity checks. Consolidate duplicate stage checks at the actual consumer. Keep family policy/geometry counterexamples, useful invalid input, export binding laws and actual editor/build behavior. A smaller title count alone proves nothing.

Use a temporary before/after output comparison for the redesign; do not turn it into a new permanent census. One meaningful whole-path example and focused domain properties should replace repeated schemas→renderer→converter fixture smoke. Retain valuable fuzz and quality-checker counterexamples, with one owner per guarantee.

Stored inputs are the remaining migration question. Source shows mindmap builds store scenes/Excalidraw/PNG, while semantic document persistence is explicitly present for flowcharts. The existing bounded R2 sample is not a complete inventory. Trace browser/CLI/project persistence and inspect the actual affected records before claiming no data migration. Change our live callers outright; any actual data conversion must be explicit and costed. No hypothetical compatibility layer.

## Working sequence

1. Establish the example's actual persistence scope and the minimum dependency moves needed for the target structure.
2. One author implements the complete example on an isolated branch. Other workers remain paused. No new units in parallel.
3. Review and exercise the example through the real build/editor path. Report deleted concepts, implementation/test deltas and remaining limitations.
4. Use that result to revise the design before migrating other features. The old slice checklist and a green staging PR do not establish architectural acceptance.

No new push, merge, preview or paid provider call is needed to define the structure. The first example is implemented and verified locally before broader rollout.
