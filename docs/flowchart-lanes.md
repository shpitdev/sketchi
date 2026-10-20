# Flowchart swimlanes

Swimlanes draw a process across actors: one full-length band per customer, team, role or system, in a fixed order, with each step in its actor's band and handoffs crossing between bands. They are part of the flowchart family, not a family of their own.

```json
{"type":"flowchart","spec":{"title":"Order fulfilment","lanes":[{"id":"customer","label":"Customer"},{"id":"sales","label":"Sales"},{"id":"warehouse","label":"Warehouse"}],"nodes":[{"id":"place","label":"Place order","kind":"start","lane":"customer"},{"id":"review","label":"Review the order","kind":"process","lane":"sales"},{"id":"stock","label":"Items in stock?","kind":"decision","lane":"sales"},{"id":"backorder","label":"Notify backorder","kind":"end","lane":"sales"},{"id":"ship","label":"Ship the order","kind":"end","lane":"warehouse"}],"edges":[{"source":"place","target":"review"},{"source":"review","target":"stock"},{"source":"stock","target":"ship","label":"yes"},{"source":"stock","target":"backorder","label":"no"}],"layout":{"direction":"LR"}}}
```

Pass this to `sketchi create --json`, or its `spec` to `sketchi.buildFlowchart`. Studio's `build_flowchart` and `POST /api/v1/flowcharts/build` take the same spec, and generation adds lanes when a prompt describes a process across actors.

## Contract

- `lanes` declares `{ id, label }` bands in drawing order, at most 8. Lane ids are unique.
- Every node sets `lane` to a declared id, and every lane holds at least one node.
- The layout direction orients the lanes: `LR` and `RL` draw rows stacked top to bottom with their headers on the left, `TB` and `BT` columns side by side with their headers on top.
- Lanes and groups never mix: lanes already say who does each step, and a group inside or across lanes would cut the bands apart.

Builds reject a node with no lane or an undeclared one (`unknown_node_lane`, with the declared ids in its hint), a repeated lane id (`duplicate_lane_id`), a lane with no nodes (`empty_lane`), lanes declared with groups (`lanes_with_groups`) and more than 8 lanes (`flowchart_too_large`). A flowchart without lanes renders exactly as before.

## Layout

- Steps take columns along the flow. A step comes after every earlier step in its own lane and after any step that reaches it from a lane further than the next one.
- A handoff to the neighboring lane may stay in its column, so it runs straight across the boundary. A source hands off straight to one step per lane; the rest move on a column.
- Steps that share a lane and a column stack across the lane, in the order that crosses the fewest edges. Each lane is as broad as its busiest column needs, and holds its steps' stubs with room to turn; every lane runs the same length, so lanes may have empty stretches.
- Edges stay inside the lanes, never cross a header, and never run along or hard beside a boundary. Crossing a boundary is fine.
- Lanes still longer than 2.3:1 for their breadth (as the hosted PNG frames them) tighten along the flow, each step kept only when it reads shorter, routes no worse, lengthens, hooks or detours no line and crowds no label more:
  - a handoff to a lane further than the next stays in its source's column where none of the lanes between holds a step there, so it runs straight down across them. In order fulfilment, Pay invoice drops straight into Record payment, two lanes down;
  - then each gap between columns draws as short as the lines in it allow: 56 units where lines only cross it straight, two 36-unit stubs where they turn in it, and 18 more for each further turn. Incident response goes from 2.6:1 to 2.35:1.
- Pools still wrap only past 4:1: a pool split off at the only cut a loop leaves reads worse than one long, tightened pool.

## Excalidraw

Each lane draws as a locked rectangle for its band and a locked header strip holding its name, under everything else. Steps are ordinary shapes on top, so they move, reconnect and edit freely, and a click on an empty stretch of lane selects nothing. Lane shapes keep square corners, so neighbors share one boundary, and the export validator lets arrows cross a band but not a header.

## Scenarios

Maintained scenarios: `swimlane-order-fulfilment` (four lanes, left to right, with handoffs between distant lanes), `swimlane-hiring` (three lanes, a rejection back to the candidate and another interview round) and `swimlane-incident-response` (three lanes, a handoff that skips a lane and a loop back to the SRE). Their `--input` checks require a lane under a prompt-grounded label for each stated lane holding every step the prompt puts in it, distinct lanes in the stated order, and each stated handoff to leave its lane for the other, directly or through unmatched steps in either lane.
