# Adding a diagram family

Sketchi supports a fixed set of canonical diagram families: flowchart, mindmap,
and sequence. `DIAGRAM_TYPES` in `packages/diagram/core/src/types.ts` is the
registry. A family is supported only when it completes every stage below, and
only supported families are advertised. Everything else, such as ER or
swimlane, fails with a typed `unsupported_diagram_type` and is never coerced
into another family.

Start with the generator, then work down the list:

```sh
pnpm nx g @sketchi/generators:diagram-type <name> --title "<Fixture title>"
pnpm run format
```

The generator registers the name in `DIAGRAM_TYPES` (and in
`GRAPH_DIAGRAM_TYPES`, since it scaffolds a node/edge contract) and creates the
core contract, its test, a renderer test, and a Storybook story. From that
moment, the compiler and `tools/diagram-families.test.ts` fail until every
stage exists.

| Stage | Where | Guard |
| --- | --- | --- |
| core contract and fixture | `packages/diagram/core/src/types/<name>.ts`: Effect Schema contract, semantic validation, `parse<Name>Diagram`, and a fixture in `diagramFixtures`. Add it to `CanonicalDiagramSchema` in `diagram.ts`, and add the file to the Effect schema-boundary lists in `.oxlintrc.json` and `tools/project-graph.test.ts`. If the family is not nodes and edges, replace the scaffold with its own contract (as `sequence.ts` does) and remove it from `GRAPH_DIAGRAM_TYPES`. | compile (`satisfies Record<DiagramTypeValue, …>`), pipeline test |
| deterministic renderer | A `renderDiagram` case in `packages/diagram/renderer/src/diagram.ts`, plus `diagram-types/<name>.test.ts`. | compile, `type-structure.test.ts`, pipeline test |
| Excalidraw conversion | `packages/diagram/excalidraw`. Any new renderer role must convert and validate. | pipeline test |
| generation prompt | `IR_INSTRUCTIONS` and `FAMILY_EXAMPLES` in `packages/diagram/generation/src/lib/messages.ts`. Remove the name from `UnsupportedDiagramIntentKindSchema` (`intent.ts`); the prompt's refusal list is built from it. | compile, pipeline test |
| generation output parsing | The `parsers` entry and requirement targets in `candidates.ts`. Diagnostics should carry repair hints. | compile, pipeline test |
| Code Mode build | A Code Mode authoring spec and build operation in `packages/diagram/agent`, registered in `CANONICAL_DOCUMENT_SPECS`, `buildCanonicalDocument`, and `canonicalDocumentFromDiagram` (`documents.ts`), plus MCP docs in `apps/playground/src/server/codemode/mcp-docs/catalog.ts`. | compile, pipeline test |
| CLI document dispatch | `sketchi create` and the offline builder read the agent registry. Add a changeset for `@sketchi/cli`. | pipeline test |
| CLI generate type | `generate --type` reads the registry, and the wizard choice comes from `GENERATION_TYPE_CHOICES` in `apps/cli/src/generation-types.ts`. | compile, pipeline test |
| generate API request | `POST /api/v1/generate` accepts every registered family (`apps/playground/src/server/generation/request.ts`). Unsupported kinds come from `UnsupportedDiagramIntentKindSchema`. | pipeline test |
| maintained scenarios | `packages/diagram/scenarios`: scenarios with checks scored on the model's own diagram, registered in `diagramScenarios` or the reliability scenarios. | pipeline test |
| Storybook story | `packages/diagram/ui/src/diagram-types/<name>.stories.tsx`. | `type-structure.test.ts`, pipeline test |

Surfaces that offer a family to people also need updating: the playground
generate API (`apps/playground/src/server/generation/api.server.ts`), Studio
chat build tools (`apps/playground/src/server/chat/`), and `llms.txt`. Add
optional `icon` support through the shared `DiagramIconRef` when a family's
elements represent named technologies.

Verify with `pnpm nx affected -t typecheck,test --base=origin/main`,
`pnpm run test:tools`, `pnpm run check`, and
`pnpm nx build-storybook diagram-ui`.
