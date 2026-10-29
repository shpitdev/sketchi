# Native Sankey diagrams

Use `sankey` for weighted flows between stages: a budget from departments to services, website traffic from sources through landing pages to outcomes, a hiring funnel with its drop-offs, or energy from sources to end uses. Flows that loop back, and diagrams whose arrows carry no amounts, are flowcharts.

```json
{"type":"sankey","spec":{"title":"Cloud budget","unit":"$k","nodes":[{"id":"eng","label":"Engineering"},{"id":"data","label":"Data"},{"id":"compute","label":"Compute"},{"id":"storage","label":"Storage"}],"links":[{"source":"eng","target":"compute","value":310},{"source":"eng","target":"storage","value":45},{"source":"data","target":"compute","value":140},{"source":"data","target":"storage","value":4}]}}
```

Pass this document to `sketchi create --json`, or its `spec` to `sketchi.buildSankey({ spec, options: { artifactFormats: ["scene", "excalidraw", "png"] } })`. Public HTTP builds use `POST /api/v1/sankey-diagrams/build`; generation accepts `type: "sankey"`. Studio exposes `build_sankey`.

## Contract

- `nodes`: `[{ id, label, color? }]`. Ids hold no colon and are unique. `color` (`#rrggbb`) colors a node's bar and every band leaving it.
- `links`: `[{ source, target, value, label? }]`. `value` is the flow's amount and must be positive. One link per source and target pair; `label` names what the flow carries and is drawn above its value.
- `unit`: formatted as charts format it. Currency symbols lead (`$k` gives $310k), `%` and scale letters follow tightly, and a word (`visits`, `GWh`) follows a space. A word unit reads on node totals only, so flow values stay short beside them.

Flows run one way. A cycle (`cart → checkout → cart`), a self-link, a repeated pair, a value of zero or less (a zero flow is reported as zero, apart from a missing value), a blank label, an unknown or unlinked node, more than 40 nodes or 100 links, and more than 8 columns are rejected with repair hints. A node's inflow and outflow may differ, as a stage that keeps some of what reaches it does.

Totals keep every authored digit: a sum drops floating-point noise at the finest precision among its values (0.1 + 0.2 reads 0.3) and never rounds coarser, so a 1e-13 flow totals 1e-13.

Code Mode and generation also read `flows` or `edges` for links, `from`/`to` for source and target, `amount`, `weight` or `count` for value, nodes written as bare names or with `name` for label, links that name nodes by label (an exact node id always wins over a label that spells it), and links alone with no node list (each name becomes a node). A malformed list (`nodes: null`, an object or a name) is never replaced; it is rejected with the field named. An authored newline in a label is a line break. No field takes coordinates.

## Rendering

The renderer owns every position:

- **Columns.** Each node sits one column past the longest run of links into it, so sources start the left. A sink (a node nothing leaves) fed by several nodes, such as a shared drop-off or an outcome, aligns with the last column; a sink fed by one node stays beside it, so a funnel's per-stage drop-offs read stage by stage. A flow that spans columns passes each one between its bars, as straight as the room allows.
- **Bars and bands.** Each node draws as a bar as tall as the larger of its inflow and outflow, and each flow as a band as wide as its value, the same width at both ends. On each side of a bar the bands stack without overlapping, and the fuller side fills it. A flow narrower than 3 px draws at 3 px, the only width that departs from scale, and keeps its exact value. The tallest column's bars span about 360 px, more when the diagram would read wider than about 2.2 to 1 or its values need room.
- **Order.** Each column is ordered so that as little band weight crosses as possible, a crossing weighing the product of its two flows' values: two wide bands crossing in the middle cost far more than a sliver crossing a wide one. Barycenter sweeps and moving each node to its best place in its column, from several starting orders, find the order; crossing count breaks ties, and the slots at each bar follow the bands' other ends. The authored order is kept whenever nothing beats it. Bars then relax toward the bands they join, keeping a 22 px gap (more where labels need it).
- **Labels.** Every node shows its label and total: left of the first column, right of the others, riding its own bands' straight leads out in a middle column. Every flow shows its value (under its label when it has one): inside its band where it enters its target when the band is thick enough, otherwise just above or below the band at either end or along its curve, wherever nothing else is. A value with no clear spot nearby first asks for a taller diagram, then sits at the nearest clear spot on a short leader that crosses no label or bar. If some value still has no clear spot, the layout reflows with wider gaps between columns and room to grow taller. A diagram that still cannot place every label clear is rejected (`quality_failed`, with a hint to shorten node and link labels, leave link labels out, or split the flows); overlaps are never accepted. Words wrap whole, and no label overlaps another label, a bar, or a band other than its own.
- **Color.** Nodes with outflow take the charts' categorical palette, column by column, so the sources whose bands meet differ; bands take their source's color at 45% opacity, so overlaps read in light and dark; a node nothing leaves draws in neutral gray.
- **Excalidraw.** Bands export as closed, filled, roughness-0 lines, each grouped with its value; bars as square-cornered rectangles grouped with their labels. Both carry the `sankey-mark` renderer role, which patches keep.

## Proof

`pnpm nx run diagram-excalidraw:sankey-fuzz` draws 1,200 seeded random flows (two-column budgets, funnels with shared or per-stage drop-offs, layered flows with skipped columns, splitting trees and merges, values across five orders of magnitude, long and non-Latin labels). Every export is valid; on each side of every bar the bands sum to its height; no band leaves its gap or crosses another bar; no label overlaps; every width follows its value at one scale, apart from the 3 px floor; and crossings never weigh more than the authored order's. CI draws 10.

## Scenarios

Maintained scenarios: `cloud-budget-sankey` (the challenge: flows from 2 to 310 and long service names), `website-traffic-sankey` (three columns that cross), `hiring-funnel-sankey` (drop-offs from every stage) and `city-energy-sankey` (five columns with flows that skip columns). `--input` checks use the model's own spec: `node:<key>` for every stated node by label, `flow:<source>-><target>` for every stated flow with its exact value, `unit` when the prompt states one (`$k`, `k$`, "thousand dollars", or the same amounts in `$`), and `nodes-exact` and `flows-exact`, so no balancing node or split flow slips in. A drop-off the prompt does not pin down passes as one shared node or one per stage. `sankey-drawn` reads the scene: every bar with its label and total, every band between its bars with its value, widths in proportion apart from the floor, and each bar as tall as its fuller side. `sankey-layout` checks that labels stand clear, bands keep to their gaps, and crossings weigh no more than the authored order's, each crossing weighing the product of its two flows' values.
