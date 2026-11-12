---
name: sketchi-code-mode
description: "Draw editable Excalidraw diagrams with the Sketchi MCP server: flowcharts and architecture maps, sequence, state machine, ER, class, Gantt, timeline, chart, mindmap, org chart, Venn, journey map, Sankey, wireframe and quadrant diagrams. Use when the user asks for one of these diagrams, names Sketchi, or wants to change a diagram Sketchi drew."
allowed-tools:
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__docs
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__search
  - mcp__plugin_sketchi-code-mode-claude_sketchi-code-mode__execute
---

# Sketchi

Sketchi draws diagrams as editable Excalidraw scenes with a PNG. Its MCP server, `sketchi-code-mode` at `https://playground.sketchi.app/mcp`, needs no account or API key and has three tools:

- `execute` runs one async JavaScript function against the `sketchi` client.
- `docs` returns one topic's request type, rules and example, such as `{ topic: "buildGantt" }`.
- `search` finds documentation by keyword.

## Draw a diagram

1. Choose the builder for what the diagram shows:

   | The diagram shows                                         | Builder                                        |
   | --------------------------------------------------------- | ---------------------------------------------- |
   | steps, decisions, how systems connect, architecture zones | `sketchi.buildFlowchart`                       |
   | messages between participants over time                   | `sketchi.buildSequenceDiagram`                 |
   | states and the events that move between them              | `sketchi.buildStateMachine`                    |
   | tables, keys and relationships                            | `sketchi.buildErDiagram`                       |
   | classes, members and relationships                        | `sketchi.buildClassDiagram`                    |
   | dated tasks with durations and dependencies               | `sketchi.buildGantt`                           |
   | dated or ordered events                                   | `sketchi.buildTimeline`                        |
   | numbers across categories: bar, line or pie               | `sketchi.buildChart`                           |
   | a topic hierarchy                                         | `sketchi.buildMindmap`                         |
   | people and reporting lines                                | `sketchi.buildOrgChart`                        |
   | what overlapping sets share                               | `sketchi.buildVennDiagram`                     |
   | a user journey scored stage by stage                      | `sketchi.buildJourneyMap`                      |
   | weighted flows between stages                             | `sketchi.buildSankey`                          |
   | UI screens                                                | `sketchi.buildWireframe`                       |
   | items placed on a 2×2 matrix                              | `sketchi.buildQuadrantChart`                   |
   | a layout no builder covers                                | `sketchi.createCanvas` (read its `docs` first) |

2. Call `execute` with one async arrow function in plain JavaScript (no TypeScript or imports). The `code` parameter's description gives every builder's spec and rules. For a flowchart, also pass the user's words as `request`: the result lists anything they state that the drawing misses.

   ```js
   async () =>
     sketchi.buildFlowchart({
       request: "Draw our release approval flow: submit a release for review, ship it if approved, revise it if not.",
       spec: {
         title: "Release approval",
         nodes: { submit: "Submit release", review: "Approved?", ship: "Ship release", revise: "Revise release" },
         edges: [
           ["submit", "review"],
           ["review", "ship", "yes"],
           ["review", "revise", "no"],
         ],
       },
     })
   ```

3. If the result is `{ ok: false, issues }`, fix the spec as each issue's `hint` says and call `execute` again.
4. Copy `artifactDelivery.finalResponseText` as your final answer and stop. It starts with `Sketchi artifact ready.` and gives the artifact id with the Excalidraw and PNG URLs. Do not redraw the diagram as Mermaid, Markdown or a local file, and do not fetch the `scene` format to describe it.

## Change a diagram

- A flowchart: `sketchi.editFlowchart({ artifactId, edits })` adds, removes, relabels, recolors or reshapes steps by id or label, for example `edits: [{ op: "set", nodes: { review: { color: "purple" } } }]`. Never rebuild or patch a flowchart to change it.
- Any other diagram: `sketchi.applyDiagramPatch(...)`. Read its `docs` first.
- `sketchi.getArtifact({ artifactId, format: "document" })` returns a flowchart's current document.

Every change returns a new artifact; deliver its `artifactDelivery.finalResponseText` the same way.

## Logos

`sketchi.searchIcons({ q })` returns logo slugs for named technologies, and `sketchi.drawIcon({ name, svg })` hand-draws a logo the catalog lacks. Each builder's spec says where an icon goes.

## Boundaries

- The endpoint is public. Do not ask the user to authenticate to Sketchi, and never put secrets or credentials in `execute` code.
- Sketchi renders PNGs itself. Do not install or require a local browser.
- If the PNG fails to render, retry once. If it fails again, give the Excalidraw URL and say the PNG is unavailable.
- Read the user's files only to learn what to draw. Write files only when asked.
