# Quadrant charts

A quadrant chart places items by two measures on a square plot split into four named quadrants: effort against impact, urgency against importance, price against quality. It is a canonical family (`quadrant`), built with `sketchi.buildQuadrantChart`, Studio's `build_quadrant_chart`, `POST /api/v1/quadrant-charts/build`, `sketchi create`, or `generate --type quadrant`.

```json
{"type":"quadrant","spec":{"title":"Effort vs impact","xAxis":{"title":"Effort","low":"Low effort","high":"High effort"},"yAxis":{"title":"Impact","low":"Low impact","high":"High impact"},"quadrants":{"topLeft":"Quick wins","topRight":"Major projects","bottomLeft":"Fill-ins","bottomRight":"Thankless tasks"},"points":[{"label":"Single sign-on","x":0.3,"y":0.85},{"label":"Dark mode","x":0.2,"y":0.4}]}}
```

## Contract

- `xAxis` and `yAxis` are `{ title, low, high }`: the axis's variable and the labels at its low end (left, or bottom) and its high end (right, or top). The labels are free text, so an axis may run from "Urgent" to "Not urgent" when the request draws it that way.
- `quadrants` names the four quadrants by corner, which fixes their order: `topLeft` is low x and high y, `topRight` high x and high y, `bottomLeft` low x and low y, `bottomRight` high x and low y.
- `points: [{ label, x, y, group? }]` places up to 30 items. `x` and `y` run from 0 at the low end to 1 at the high end, so a score out of 100 is score / 100 and 0.5 sits on a middle line. An empty list draws the matrix alone.
- `group` colors a point in the categorical palette, in first-appearance order, and adds a legend; at most six groups. Points without a group are neutral beside grouped ones.
- Validation rejects a score outside 0 to 1, a repeated label, more than 30 points or six groups, blank text, and text too long to place (labels and quadrant names over 40 characters, axis titles over 40, end labels over 30, groups over 30). Each rejection carries a repair hint. No field takes coordinates.

## Layout

- The plot is a square of four tinted quadrants. Each name sits in its quadrant's outer corner, and slides along the outer edge (then inward, wrapping onto more lines) to stay clear of every dot, keeping room beside each dot for its label.
- The x axis runs under the plot and the y axis beside it, each an arrow toward its high end. The x axis carries its low label at the left, its high label at the right and its title between them (on a second row when they would meet); the y axis carries its high label at the top, its low label at the bottom and its title between, right-aligned beside the arrow.
- Every dot sits at its exact position, drawn over the middle lines with a surface ring, so a point on a line or an edge stays readable. A dot's label takes the first clear spot beside it (right, left, above, below, then the corners), only where it sits nearer its own dot than any other. A reader pairs a label with a dot level with it or under or over it, so a corner spot that lines up with another dot near it, and not with its own, waits behind every leader. The most constrained label is placed first.
- The two dividers and both axes are always drawn whole. No label sits across a divider; a label beside a dot on a middle line takes the side of the line it fits on.
- A crowded label moves away from its dot on a leader line, nearest spot first and straight away from the crowd. A clump of four or more dots a reader cannot tell apart labels them in a column beside it, in the dots' top-to-bottom order. A label that finds no clear spot displaces the one label in its way when that label can move, and otherwise the fewest it can. No leader crosses another leader, a label, a quadrant name or another clump's dot, and leaders keep their far halves apart, so each reads as its own line.
- A crowded chart grows its plot from 560 to 960 pixels until its labels sit clear and few take leaders, and the plot starts large enough for every quadrant name's longest word and for the x axis's two end labels side by side. A plot still too crowded at its largest sets labels a size smaller, searches longer, and as a last resort lets a leader pass over another dot. A chart is rejected only once it has tried every plot size and the smaller labels, within a fixed budget of work, so a chart that can never read, such as thirty points at one corner, fails fast.
- A chart that still cannot place every label clear is never drawn: the build fails with `quadrant_too_large` and a repair hint (spread points that nearly coincide, shorten labels or names, or split the chart). A word too long for the largest plot fails with `invalid_quadrant_text`.
- Labels and names wrap at whole words and never break one; authored newlines are line breaks.

## Excalidraw

Each quadrant is a square-cornered tint grouped with its name; each dot is an ellipse grouped with its label and leader, so dragging a point moves them together; each axis is an arrow grouped with its title and end labels; each legend key is grouped with its name. Tints, dots and keys carry the `quadrant-mark` renderer role: roughness 0, no generated labels, and patches keep the role. Every export validates before and after a save and reload.

## Scenarios

Maintained scenarios: `effort-impact-quadrant-v2` (fifteen backlog items by score, eight crowded into Quick wins, one on the effort midline; challenge), `eisenhower-matrix-quadrant-v2` (eight tasks by quadrant only, axis direction left open; smoke) and `competitor-positioning-quadrant-v2` (nine products by score, one quadrant empty, our product set apart in color; standard). Checks read every placement through the axis ends as drawn, so an axis that runs high to low passes when every name and point follows it:

- `axis:x`, `axis:y`: each stated variable titles its axis. `axis-ends:x`, `axis-ends:y`: the stated end labels, in either direction.
- `quadrant:<key>`: each name sits in the corner its conditions describe.
- `point:<key>` and `points-exact`; `position:<key>` within 0.02 of score / 100 on each axis, mirrored when that axis runs high to low; `quadrant-of:<key>` for items stated only by quadrant, strictly inside it and at least 0.03 from both middle lines.
- `highlight:<key>`: a group no other point shares. `empty:<key>`: no point inside a quadrant the scores leave empty.
- `quadrant-drawn` (output): every dot at its position within half a pixel with its label, each name in its quadrant, and both axes' titles and end labels. `quadrant-layout` (hint): no label overlaps another text or a dot, every label stays in the plot nearest its own dot or on a leader to it, none lines up with another dot instead of its own, and no line crosses text.

The fuzz (`pnpm nx run diagram-excalidraw:quadrant-fuzz`, CI runs 14) draws 700 random charts: uniform, clustered, on round scores (many on a midline or an edge), nearly coinciding, crowded into one quadrant or all at one spot, with long and non-Latin labels, long names and groups. Every dot must sit at its exact position, every label in the plot, clear of every text and dot and nearest its own dot or on a leader, none lined up with another dot instead of its own, every leader clear of text and other leaders, every word whole, both dividers and both axes whole with no label across them, and the export valid. A rejected chart counts as a defect too.
