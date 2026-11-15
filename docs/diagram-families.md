# Adding a diagram family

Sketchi supports a fixed set of canonical diagram families: flowchart, mindmap,
sequence, timeline, chart, state-machine, gantt, er, class, org-chart, venn, journey, sankey, wireframe, and quadrant. `DIAGRAM_TYPES` in `packages/diagram/core/src/types.ts` is the
registry. A family is supported only when it completes every stage below, and
only supported families are advertised. Swimlanes and architecture diagrams are
flowchart features. A prompt for anything else generates the closest family, and
a request whose `type` names no family is invalid input.

Start with the generator, then work down the list:

```sh
pnpm nx g @sketchi/generators:diagram-type <name> --title "<Fixture title>"
pnpm run format
```

The generator registers the name in `DIAGRAM_TYPES` (and in
`GRAPH_DIAGRAM_TYPES`, since it scaffolds a node/edge contract) and creates the
core contract, its test, a renderer test, and a Storybook story. The compiler
checks the exhaustive family maps. `tools/diagram-families.test.ts` exercises
each family's generated-response ingestion and offline document build; it does
not require particular source, story, scenario or test files to exist.

| Stage | Where | Guard |
| --- | --- | --- |
| core contract and fixture | `packages/diagram/core/src/types/<name>.ts`: Effect Schema contract, semantic validation, `parse<Name>Diagram`, and a fixture in `diagramFixtures`. Add it to `CanonicalDiagramSchema` in `diagram.ts`, following the shared Effect diagnostic policy. If the family is not nodes and edges, replace the scaffold with its own contract (as `sequence.ts` does) and remove it from `GRAPH_DIAGRAM_TYPES`. | compile (`satisfies Record<DiagramTypeValue, …>`), generated-response pipeline |
| deterministic renderer | A `renderDiagram` case in `packages/diagram/renderer/src/diagram.ts`, plus `diagram-types/<name>.test.ts`. | family renderer regressions, generated-response pipeline |
| Excalidraw conversion | `packages/drawing`. Any new renderer role must convert and validate. | offline-build pipeline |
| generation prompt | `IR_INSTRUCTIONS` and `FAMILY_EXAMPLES` in `packages/diagram/generation/src/lib/messages.ts`. Remove the name from `UnsupportedDiagramIntentKindSchema` (`intent.ts`); the prompt's refusal list is built from it. | compile, message-builder tests; generated quality in Frontierclimb |
| generation output parsing | The `parsers` entry and requirement targets in `candidates.ts`. Diagnostics should carry repair hints. | compile, generated-response pipeline |
| Code Mode build | A Code Mode authoring spec and build operation in `packages/diagram/agent`, registered in `CANONICAL_DOCUMENT_SPECS`, `buildCanonicalDocument`, and `canonicalDocumentFromDiagram` (`documents.ts`), plus MCP docs in `apps/playground/src/server/codemode/mcp-docs/catalog.ts`. | compile, offline-build pipeline |
| CLI document dispatch | `sketchi create` and the offline builder read the agent registry. Add a changeset for `@sketchi/cli`. | offline-build pipeline |
| CLI generate type | `generate --type` reads the registry, and the wizard choice comes from `GENERATION_TYPE_CHOICES` in `apps/cli/src/generation-types.ts`. | compile, CLI behavior tests |
| generate API request | `POST /api/v1/generate` accepts every registered family (`apps/playground/src/server/generation/request.ts`). Unsupported kinds come from `UnsupportedDiagramIntentKindSchema`. | request schema |
| maintained scenarios | `packages/diagram/scenarios`: scenarios with checks scored on the model's own diagram, registered in `diagramScenarios` or the reliability scenarios. | scenario regressions and Frontierclimb |
| Storybook story | `tools/storybook/families/<name>.stories.tsx`. | Storybook build and review |

The offline-build pipeline parses document JSON through the CLI, builds it with
Code Mode (which validates its Excalidraw conversion), checks the returned scene
and file, and reads both artifacts back from storage. The separate generated-response pipeline decodes a
model-shaped response and renders the decoded diagram. Both paths exercise all
15 families. These fixture checks do not establish model quality; Frontierclimb
owns the graded generation catalogs. Family renderer regressions and full fuzz
targets remain separate requirements when their implementations change.

Groups (labeled regions around related steps) are a flowchart feature, not a
family; see `docs/flowchart-groups.md`. So are nested architecture zones and
infrastructure shapes (database, queue, document); see `docs/flowchart-zones.md`.
So are swimlanes (one band per actor); see `docs/flowchart-lanes.md`. State machines reuse them for composite
states; see `docs/state-machines.md`. ER diagrams place their own tables and
route on the graph router with pinned row ends; see `docs/er-diagrams.md`.
How a flowchart avoids crossing lines is in `docs/flowchart-crossings.md`.
Curved lines are in `docs/flowchart-curved-lines.md`.
Class diagrams place their boxes in rows, superclasses above, and route the
same way with a port for every end; see `docs/class-diagrams.md`. Org charts
place their own tree, a bus from each manager to their reports, and route only
their dotted lines; see `docs/org-charts.md`. Venn diagrams have their own
contract of sets and regions and size their circles until each region's text
fits; see `docs/venn-diagrams.md`. Journey maps lay out stages as columns
with an emotion curve and draw no connectors; see `docs/journey-maps.md`.
Sankey diagrams are not nodes and edges: they place weighted bands between
columns of bars, label every total and flow, and leave `GRAPH_DIAGRAM_TYPES`;
see `docs/sankey.md`. Wireframes are no graph at all: screens of nested
components the renderer boxes like flex layout; see `docs/wireframes.md`.
Quadrant charts place every dot at its scores and every label clear of the
rest; see `docs/quadrant-charts.md`. Mindmaps radiate from their central topic; see
`docs/mindmaps.md`.

Surfaces that offer a family to people also need updating: the playground
generate API (`apps/playground/src/server/generation/api.server.ts`), Studio
chat build tools (`apps/playground/src/server/chat/`), and `llms.txt`. Add
optional `icon` support through the shared `DiagramIconRef` when a family's
elements represent named technologies.

Verify with `pnpm nx affected -t typecheck,test --base=origin/main`,
`pnpm run test:tools`, `pnpm run check`, and
`pnpm nx build-storybook diagram-ui`.
