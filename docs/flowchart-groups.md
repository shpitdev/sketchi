# Flowchart groups

Groups draw labeled regions around flowchart steps that belong together: a team in an approval process, a network zone on a request path, or a phase of a rollout. They are part of the flowchart family, not a family of their own.

```json
{"type":"flowchart","spec":{"title":"Expense approval","nodes":{"submit":"Submit expense report","approved":"Approved?","revise":"Revise the report","pay":"Pay the employee"},"edges":[["submit","approved"],["approved","pay","yes"],["approved","revise","no"],["revise","approved"]],"groups":{"employee":{"label":"Employee","contains":["submit","revise"]},"finance":{"label":"Finance","contains":["pay"]}}}}
```

Pass this to `sketchi create --json`, or its `spec` to `sketchi.buildFlowchart`. Studio's `build_flowchart` and `POST /api/v1/flowcharts/build` take the same spec, and generation adds groups when a prompt groups its steps.

## Contract

- `groups` maps an id to `{ label, contains }`, at most 8. `contains` lists the nodes (and, for zones, the groups) inside it.
- A node outside every group's list stays outside every group, and a flowchart can mix both.
- A group with no `kind` that no other group lists draws as a frame, as below. Groups that nest or name what they stand for draw as zones; see [architecture zones](./flowchart-zones.md).

Builds reject a group that lists an id that is no node or group (`unknown_member`, with the nearest declared ids in its hint) and a node two groups list when neither group holds the other (`overlapping_containers`).

## Layout

- Each group's members are laid out as a flow of their own, in the diagram's direction. The top level then lays out each group as one block among the ungrouped nodes, so a group's members stay together and no two groups, or a group and an outside node, overlap.
- A block alone in its rank lines up with the step it connects to, so the flow runs straight from one group into the next.
- A grouped flow never wraps, since a band cut would split a group. When it runs too long, its groups lie across the flow instead, so zones on a left-to-right path become columns. This is kept only when it routes no worse.
- Edges route around every group neither end belongs to, never cross a group's name and never run along a frame. A group's own edges stay inside its frame, and the frame grows to give them room.

## Excalidraw

Each group is an Excalidraw frame named by its label. Excalidraw paints the name above the frame's top-left corner. Members and their labels, and a group's own edges that lie wholly inside, are children of the frame. Dragging the frame moves the group, and dragging a node out of it removes the node from the group. The validator treats a frame as an obstacle except for arrows bound to its own children.

## Scenarios

Maintained scenarios: `grouped-expense-approval-v2` (three teams and a loop back into the first), `three-zone-request-path-v2` (three network zones, left to right) and `mixed-fulfilment-groups-v2` (grouped and ungrouped steps). Their `--input` checks require a group under a prompt-grounded label for each stated group, that group to hold every step the prompt puts in it, distinct groups, and the steps the prompt keeps outside every group to be ungrouped.
