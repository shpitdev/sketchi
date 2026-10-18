# Flowchart groups

Groups draw labeled regions around flowchart steps that belong together: a team in an approval process, a network zone on a request path, or a phase of a rollout. They are part of the flowchart family, not a family of their own.

```json
{"type":"flowchart","spec":{"title":"Expense approval","groups":[{"id":"employee","label":"Employee"},{"id":"finance","label":"Finance"}],"nodes":[{"id":"submit","label":"Submit expense report","kind":"start","group":"employee"},{"id":"approved","label":"Approved?","kind":"decision"},{"id":"revise","label":"Revise the report","kind":"process","group":"employee"},{"id":"pay","label":"Pay the employee","kind":"end","group":"finance"}],"edges":[{"source":"submit","target":"approved"},{"source":"approved","target":"pay","label":"yes"},{"source":"approved","target":"revise","label":"no"},{"source":"revise","target":"approved"}]}}
```

Pass this to `sketchi create --json`, or its `spec` to `sketchi.buildFlowchart`. Studio's `build_flowchart` and `POST /api/v1/flowcharts/build` take the same spec, and generation adds groups when a prompt groups its steps.

## Contract

- `groups` declares `{ id, label }` regions, at most 8. Group ids are unique.
- A node joins a group by setting `group` to a declared id. Nodes without `group` stay outside every group, and a flowchart can mix both.
- Groups are flat: a group never contains another group.

Builds reject a node whose `group` names no declared group (`unknown_node_group`, with the declared ids in its hint), a repeated group id (`duplicate_group_id`) and a group with no nodes (`empty_group`).

## Layout

- Each group's members are laid out as a flow of their own, in the diagram's direction. The top level then lays out each group as one block among the ungrouped nodes, so a group's members stay together and no two groups, or a group and an outside node, overlap.
- A block alone in its rank lines up with the step it connects to, so the flow runs straight from one group into the next.
- A grouped flow never wraps, since a band cut would split a group. When it runs too long, its groups lie across the flow instead, so zones on a left-to-right path become columns. This is kept only when it routes no worse.
- Edges route around every group neither end belongs to, never cross a group's name and never run along a frame. A group's own edges stay inside its frame, and the frame grows to give them room.

## Excalidraw

Each group is an Excalidraw frame named by its label. Excalidraw paints the name above the frame's top-left corner. Members and their labels, and a group's own edges that lie wholly inside, are children of the frame. Dragging the frame moves the group, and dragging a node out of it removes the node from the group. The validator treats a frame as an obstacle except for arrows bound to its own children.

## Scenarios

Maintained scenarios: `grouped-expense-approval` (three teams and a loop back into the first), `three-zone-request-path` (three network zones, left to right) and `mixed-fulfilment-groups` (grouped and ungrouped steps). Their `--input` checks require a group under a prompt-grounded label for each stated group, that group to hold every step the prompt puts in it, distinct groups, and the steps the prompt keeps outside every group to be ungrouped.
