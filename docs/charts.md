# Native charts

Use `chart` for bar, line and pie charts of numbers across categories: revenue by quarter, tickets by channel, latency over a week, market share. Dashboards, scatter plots, dual axes and maps are out of scope.

```json
{"type":"chart","spec":{"title":"Quarterly revenue","kind":"bar","categories":["Q1","Q2","Q3","Q4"],"series":[{"name":"2025","values":[42,51,47,63]},{"name":"2026","values":[48,57,61,72]}],"unit":"$M","categoryAxisTitle":"Quarter","valueAxisTitle":"Revenue"}}
```

Pass this document to `sketchi create --json`, or its `spec` to `sketchi.buildChart({ spec, options: { artifactFormats: ["scene", "excalidraw", "png"] } })`. Public HTTP builds use `POST /api/v1/charts/build`; generation accepts `type: "chart"`. Studio exposes `build_chart`.

## Contract

- `kind`: `bar` compares categories, `line` shows change across ordered categories, `pie` splits one whole.
- `categories`: the x-axis labels, or the pie's slice names, in display order. Each is unique.
- `series`: `[{ name?, values }]`, one value per category in category order. Every series needs a distinct `name` when there are several; the legend shows it.
- `unit`: shown on ticks and value labels. Currency symbols lead (`$` gives $12 and `$M` gives $12M); `%`, `°` and the scale letters k, M, B and T follow tightly; other units follow a space (`12 ms`).
- `categoryAxisTitle` and `valueAxisTitle` name the axes of bars and lines.
- `stacked: true` stacks a bar chart's series within each category; positive and negative segments stack apart from zero.
- `orientation` forces `vertical` or `horizontal` bars. Without it, bars turn horizontal when their category names cannot fit under columns in two lines.
- `donut: true` draws a pie as a ring.

A pie has exactly one series of non-negative values, at least one of them positive, and at most 8 slices. Bars and lines allow negative values, up to 40 categories, 6 series and 120 values. Options that do not apply to a kind (stacked lines, donut bars, a pie's axis titles), mismatched series lengths, repeated categories and missing series names are rejected with repair hints. No field takes coordinates.

## Rendering

The renderer owns every position:

- Value axes step by 1, 2 or 5 × 10ⁿ and cover the data. Bars always keep a bold zero baseline. Lines keep zero too, unless the data sits in a band narrower than a sixth of its magnitude. The scale grows a step where a value label would otherwise leave the plot. Ticks from 10,000 up use k, M, B or T.
- Every authored value is drawn as text; none is left to subtraction. Columns carry their values on their caps and horizontal bars at their ends, and bars widen until each value fits. A stacked segment holds its value whenever the text fits inside. A sliver that cannot gets its value beside the stack (a row under it for horizontal bars) on a short elbow leader, clear of the total, the neighbouring bands and the zero baseline. Every stack also shows its total. Grouped bars sit 2 px apart, and stacked segments are separated by a 2 px surface gap.
- Every category is named. Names wrap at word boundaries and never break a word; points and bars spread until each name fits.
- Several series get a legend; a lone series' name shows under the title when the titles don't already say it. Line series also get a distinct marker shape each (circle, square, diamond, triangle, ring, inverted triangle), so they read without color. A single line labels each point where its label stays clear of the line, its marker and the zero baseline. Otherwise a data table under the axis gives every value, one row per series, aligned with its category.
- Gridlines, the zero baseline and the axis break behind every text box, so no rule crosses a label.
- Pie slices start at 12 o'clock and run clockwise in input order. Each shows its name and percentage, plus the value unless the percentage already states it (percent data that totals 100%). Each percentage is its slice's value ÷ total, rounded on its own. A chart with a slice under 10% shows one decimal, and takes a second when two different values would otherwise share a label, so 0.7% and 1.1% never both read 1%. Trailing zeros drop (92.0% reads 92%), and a positive slice too thin for two decimals reads as below 0.01%. A label sits inside its slice only when it fits with a margin; otherwise it moves outside on a leader line. Outside labels sit in a column on each side. A label within 20° of straight up or down may move to the emptier side, so a run of thin slices near the top splits across both. Labels above the pie's middle stack upward and those below stack downward, so no leader crosses the pie, another leader or a label.
- Colors come in a fixed categorical order validated for color-vision deficiencies on the card surface. A 7-slice pie swaps violet for red, so the slices at the seam stay apart. Text on a fill is ink or white, whichever contrasts more.
- Data marks carry the `chart-mark` renderer role. Bars export as square-cornered Excalidraw rectangles, and slices as closed filled polygons, all at roughness 0 so proportions stay exact. Each bar is grouped with its value label, each stack with its total, each line series with its markers, and each slice with its label and leader.

## Scenarios

Maintained CLI scenarios: `quarterly-revenue-bar-chart` (grouped), `support-tickets-stacked-bar-chart` (stacked), `net-income-bar-chart` (negative values), `product-line-revenue-bar-chart` (long names, horizontal), `monthly-signups-bar-chart` (12 categories), `weekly-active-users-line-chart` (three series), `api-latency-line-chart` (one series), `temperature-anomaly-line-chart` (crossing zero), `revenue-cost-line-chart` (two series), `browser-share-pie-chart` (percent data), `cloud-spend-pie-chart` (tiny slices), and `traffic-sources-donut-chart` (donut). Their `--input` checks use the model's own spec: the chart kind, every category in order, every series and its values in category order (a lone series may take any name), the unit, axis titles, and the stacked or donut choice. `chart-geometry` reads the rendered scene back: every bar's length must follow its value within 0.6 px, and every slice's angle its share within 0.1°. `chart-pie-labels` checks that each slice label states its share at the chart's precision and that different values never share a label. `chart-drawn-data` grades fidelity on what is drawn: every prompt value, formatted as the renderer formats it, must appear in the chart's value text as often as the prompt gives it, and every category, series name and axis title must appear in its text. `chart-clear-rules` checks that no gridline, baseline or axis crosses text. Fixture proof is deterministic, not model-quality evidence.
