# Diagram families

Sketchi supports a fixed set of canonical diagram families: flowchart, mindmap,
sequence, timeline, chart, state-machine, gantt, er, class, org-chart, venn, journey, sankey, wireframe, and quadrant. `families` in `packages/diagrams/src/family.ts` is the
registry of advertised families; `DIAGRAM_TYPES` derives from it. Each supported family has a complete document-to-export
path. Swimlanes and architecture diagrams are
flowchart features. A prompt for anything else generates the closest family, and
a request whose `type` names no family is invalid input.

Each [family](../packages/diagrams/src/families/) owns its document, layout and build.

| Stage | Where | Guard |
| --- | --- | --- |
| family folder | `packages/diagrams/src/families/<name>/`: `document.ts` (Effect Schema contract and semantic validation), `build.ts` (the `defineBuild` operation: normalize, check, render, counts), `docs.ts`, `rules.ts`, and layout, rendering, readout and fixtures as the family needs them. Follow the shared Effect diagnostic policy. | compile, family tests, generated-response pipeline |
| registry | A descriptor in `families` (`packages/diagrams/src/family.ts`) with the operation, label, HTTP path, build, fixture, docs and any canvas roles. `DIAGRAM_TYPES`, `CanonicalDiagramSchema`, `diagramFixtures` and `renderDiagram` derive from it. Export the bound build from `build/builds.ts` and add the family to `canonicalDocumentFromDiagram` (`build/documents.ts`). | compile, offline-build pipeline |
| family docs | `families/<name>/docs.ts`: the CLI wizard choice, the MCP catalog entry and examples, and the Studio chat tool name and description. MCP docs, the CLI wizard (`GENERATION_TYPE_OPTIONS` in `apps/cli/src/generation-types.ts`) and Studio chat tools loop over it. | compile, MCP tool list |
| family tests | `families/<name>/tests/`: at most `<name>.test.ts`, `<name>-fuzz.test.ts` and `regressions.test.ts` (see the Tests section of `AGENTS.md`). Use `test-<name>` for the family suite. Timeline fuzz runs in `test-timeline`; families with larger fuzz runs have separate targets in `packages/diagrams/project.json`. | the family's own tests |
| Excalidraw conversion | `packages/drawing`. Any new renderer role must convert and validate (`src/scene.ts`). | offline-build pipeline |
| generation prompt | The family's entries in `IR_INSTRUCTIONS` and `FAMILY_EXAMPLES` (`packages/diagrams/src/generate/messages.ts`) and in `FAMILY_OPTIONS` (`family-questions.ts`). | compile, generate tests; generated quality in Frontierclimb |
| generation output parsing | The `parsers` entry and validation-error mapping in `generate/candidates.ts`. Diagnostics should carry repair hints. | compile, generated-response pipeline |
| Studio chat | The family's `tool-<toolName>` entry in `BUILD_TOOLS` (`apps/studio/src/features/chat/build-result.ts`) and its line in the chat policy (`packages/diagrams/src/build/policy.ts`). | review; the chat agent test covers only the tool list |
| CLI | `sketchi create`, `generate --type` and the offline builder read the registry. Add a changeset for `@sketchi/cli`. | offline-build pipeline, CLI behavior tests |
| generate API request | `POST /api/v1/generate` decodes `GenerateRequest` (`packages/diagrams/src/generate/contract.ts`), whose `type` is any of `DIAGRAM_TYPES`, in `apps/studio/src/features/generate/api.server.ts`. | request schema |
| maintained scenarios | `tools/scenarios`: scenarios with checks scored on the model's own diagram, registered in `diagramScenarios` or the reliability scenarios. | scenario regressions and Frontierclimb |
| Storybook story | `tools/storybook/families/<name>.stories.tsx`. | Storybook build and review |

The [offline CLI test](../apps/cli/tests/cli.test.ts) creates diagrams from JSON
and exports a valid Excalidraw file. Family tests check document builds and
rendering. The [Studio generate API test](../apps/studio/src/features/generate/tests/api.server.test.ts)
feeds a model reply per family through HTTP and decodes the returned document,
scene, and Excalidraw file as the CLI would. Frontierclimb owns the graded model
quality checks. Run the affected family regressions and full fuzz targets when
changing their implementations.

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
columns of bars, and label every total and flow;
see `docs/sankey.md`. Wireframes are no graph at all: screens of nested
components the renderer boxes like flex layout; see `docs/wireframes.md`.
Quadrant charts place every dot at its scores and every label clear of the
rest; see `docs/quadrant-charts.md`. Mindmaps radiate from their central topic; see
`docs/mindmaps.md`.

Surfaces that offer a family to people also need updating: the playground
generate API (`apps/studio/src/features/generate/api.server.ts`), Studio
chat build tools (`apps/studio/src/features/chat/`), and `llms.txt`. Add
optional `icon` support through the shared `DiagramIconRef` when a family's
elements represent named technologies.

Verify with `pnpm ci:local --no-signoff` (includes the affected family and shared
test targets, tools, typechecks and editor Storybook).
