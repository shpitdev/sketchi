# @sketchi/cli

## 0.25.10

### Patch Changes

- [#513](https://github.com/shpitdev/sketchi/pull/513) [`a0fdb78`](https://github.com/shpitdev/sketchi/commit/a0fdb784627cc582a70ef14fd45bb3c12c95ce98) Thanks [@anandpant](https://github.com/anandpant)! - In a zoned flowchart, a line into a band hanging under its source no longer hooks around the region's margin to reach a step that another step of its rank stands in front of. It leaves forward and turns back into that step's far side, while the line to the nearer step drops straight down. A zone wrap that would cross only because of how the plain router drew its lines is routed again across as few lines as possible before it is judged, so sibling zones along a left-to-right flow stay side by side more often instead of stacking.

## 0.25.9

### Patch Changes

- [#511](https://github.com/shpitdev/sketchi/pull/511) [`6bce0d7`](https://github.com/shpitdev/sketchi/commit/6bce0d74133998898a393327c91d6bfd59f430c4) Thanks [@anandpant](https://github.com/anandpant)! - A top-to-bottom flowchart that is still taller than 2.3:1 and cannot wrap draws its rank gaps tighter. A gap that lines only cross straight shrinks from 96 to 56 units; a gap that lines turn in shrinks to the stubs either side of each turn. This applies to the common shape where a decision's failure branch skips down to a shared end. The tighter layout is kept only when it routes no worse and no line gets longer, hooks or detours. A single-row timeline wider than 2.3:1 stands its labels farther out on longer stems instead of drawing a wide, shallow strip.

## 0.25.8

### Patch Changes

- [#509](https://github.com/shpitdev/sketchi/pull/509) [`40a394b`](https://github.com/shpitdev/sketchi/commit/40a394bed4f756686ee8b8f6a6f1885d200a4bf4) Thanks [@anandpant](https://github.com/anandpant)! - A flowchart or state-machine line no longer runs through another line's arrowhead, where that reads as pointing the line into the head's target. When a layout still draws one, the lines through a head are routed again after every other line, clear of arrowheads first, and in a graph of up to 24 edges every line is; the clearer layout is kept when it draws no more crossings, reader findings or crowded labels and no longer a drawing.

## 0.25.7

### Patch Changes

- [#506](https://github.com/shpitdev/sketchi/pull/506) [`7460cf2`](https://github.com/shpitdev/sketchi/commit/7460cf29433ddc557a6165c6f5941278e373391f) Thanks [@anandpant](https://github.com/anandpant)! - Gantt dependency arrows no longer hook back where a straight route exists. An arrow passing a bar that ends just short of a milestone drops straight onto the diamond's edge. A second arrival that would loop around its successor shares the first arrival's last run into one arrowhead. An arrow forced around a bar clears it by half a bar height instead of tracing its edge, then runs back to its successor's start. A chart keeps these routes only when they cross no more often and read no worse than the earlier routing.

## 0.25.6

### Patch Changes

- [#504](https://github.com/shpitdev/sketchi/pull/504) [`a0cf902`](https://github.com/shpitdev/sketchi/commit/a0cf9020ad87e17a8df5e251dfc1777d11cde281) Thanks [@anandpant](https://github.com/anandpant)! - A composite state with no initial entry now starts in its first listed regular substate. The build returns a non-blocking warning naming the composite and chosen substate; an explicit initial still takes precedence and invalid entries are rejected.

## 0.25.5

### Patch Changes

- [#500](https://github.com/shpitdev/sketchi/pull/500) [`a6f8e10`](https://github.com/shpitdev/sketchi/commit/a6f8e107ec1b3b9b6fd09a66820a82b7828cd910) Thanks [@anandpant](https://github.com/anandpant)! - A long flowchart that wraps into rows or columns now carries its flow from one band to the next through the gap between them: the line leaves the band's last step by the side facing the next band, runs along the gap and steps into the next band's first step, instead of running around both outer margins. A decision opening the next band is entered by its side vertex, its branches leaving by the other two. Where that route would add a crossing or a reader finding, the line runs around the end of the band it leaves, or around both ends as before. A transition or edge label that only a frame crowds, rather than another line, no longer slides out past the drawing and widens it.

## 0.25.4

### Patch Changes

- [#495](https://github.com/shpitdev/sketchi/pull/495) [`85f8783`](https://github.com/shpitdev/sketchi/commit/85f87834f094547541a46660c67474008515c234) Thanks [@anandpant](https://github.com/anandpant)! - Flowchart node descriptions now draw: each one is a smaller, muted subtitle under its node's label, inside the node, wrapped at whole words and grouped with the node in Excalidraw. A long description widens its node, up to a bound, so it fits in two lines; past three lines at that width it still draws in full and the build returns a `label_too_long` warning. Nodes without descriptions render exactly as before.

## 0.25.3

### Patch Changes

- [#496](https://github.com/shpitdev/sketchi/pull/496) [`311bd55`](https://github.com/shpitdev/sketchi/commit/311bd5590d683b7e819f797927945476e90dc92c) Thanks [@anandpant](https://github.com/anandpant)! - Transition and flowchart edge labels stay nearer their own line than any other. When another transition's run passes closer to a label than the label's own line, that run moves clear of it, but only where the move adds no crossings or reader findings. Text beside a vertical line now aligns toward that line, so it reads as attached to it. A return label no longer sits under a neighbouring cancellation run, as it did in the order lifecycle.

## 0.25.2

### Patch Changes

- [#492](https://github.com/shpitdev/sketchi/pull/492) [`e811feb`](https://github.com/shpitdev/sketchi/commit/e811feb20bb24f3a942a2130f6d7aafe94570ad2) Thanks [@anandpant](https://github.com/anandpant)! - Sequence diagrams accept self-messages: a message whose source is its target, such as an identity provider validating credentials or a service retrying. It draws as a loop out of the participant's lifeline and back on its own row, with its label clear of the lifeline, and a self-call returns into a short nested activation bar. Self-messages never open or answer a call between participants. Diagrams without self-messages render exactly as before.

## 0.25.1

### Patch Changes

- [#483](https://github.com/shpitdev/sketchi/pull/483) [`6f23984`](https://github.com/shpitdev/sketchi/commit/6f23984070a5805f60f98139f991c640cc9742d1) Thanks [@anandpant](https://github.com/anandpant)! - Vendor logos follow the label: a cloud vendor's or platform's logo (`aws`, `cloudflare`, `kubernetes`, `gke`) stays on a flowchart node or sequence participant whose label names that vendor ("Cloudflare Workers", "AWS Lambda", "GKE cluster") and is dropped with an `icon_dropped` warning elsewhere ("Ingress controller", or "S3 bucket" with `aws`). A product's own logo is never touched.

## 0.25.0

### Minor Changes

- [#476](https://github.com/shpitdev/sketchi/pull/476) [`0ecd7b5`](https://github.com/shpitdev/sketchi/commit/0ecd7b5ecb7215a1421d757126d42a6144239bdf) Thanks [@anandpant](https://github.com/anandpant)! - Draw architecture diagrams: a flowchart spec's groups nest through `parent` (a subnet in a VPC in a region) and say what they stand for through `kind` (`cloud`, `datacenter`, `region`, `zone`, `vpc`, `subnet`, `cluster` or `namespace`), and a node's `shape` draws it as a `database` cylinder, a `queue`, a `document` or a `storage` bucket. Zones come out as styled, locked rectangles with their labels in a header strip, children inside their parents, and edges cross zone outlines without running along them. `sketchi create` builds them offline, and `sketchi generate` nests zones when a prompt describes an architecture.

## 0.24.0

### Minor Changes

- [#478](https://github.com/shpitdev/sketchi/pull/478) [`82185f4`](https://github.com/shpitdev/sketchi/commit/82185f4bf7602fa9318ccba79ac2a9dc41677880) Thanks [@anandpant](https://github.com/anandpant)! - Add native org charts: `sketchi create` builds `{ "type": "org-chart", "spec": { "title", "people", "dottedLines" } }` documents offline, and `sketchi generate --type org-chart` generates them. Each person draws as a card of name, title and department; each manager stands above the reports their bus line feeds, long lists of reports stack in one or two columns, assistants hang beside their manager, and dotted-line reports draw dashed with a head at the second manager, around the hierarchy where they can, with their stated scope as a label on the line. `groupByDepartment: true` draws each department as a labeled region.

## 0.23.1

### Patch Changes

- [#473](https://github.com/shpitdev/sketchi/pull/473) [`3e86361`](https://github.com/shpitdev/sketchi/commit/3e86361da7c5e95e842f8d440eb79036c9acd4bb) Thanks [@anandpant](https://github.com/anandpant)! - ER diagrams of larger schemas read cleaner. Tables move between columns while that leaves fewer crossings, so a hub such as an organizations table sits among its children with links on both sides. Two relationship ends on one side of a row now stand far enough apart that their bars and feet no longer run together, lines no longer wrap around their own table to reach a neighbor, and small schemas stack their tables instead of running out to a wide strip.

## 0.23.0

### Minor Changes

- [#469](https://github.com/shpitdev/sketchi/pull/469) [`cce6c8a`](https://github.com/shpitdev/sketchi/commit/cce6c8a1117ced72b1cd407e0fcb976232872a2e) Thanks [@anandpant](https://github.com/anandpant)! - Gantt charts name every task in a table left of the plot: a name column, indented under phase headers, beside the date column, with a light rule between rows so each name reads against its bar. The plot holds only bars, diamonds and dependency arrows, so arrows take forward routes where names once stood in the way. In Excalidraw, a bar dragged to new dates leaves its name and dates in the table.

## 0.22.0

### Minor Changes

- [#463](https://github.com/shpitdev/sketchi/pull/463) [`32d4ced`](https://github.com/shpitdev/sketchi/commit/32d4cedbe55dfc0ec4a4af56bfbff39b5a90dc72) Thanks [@anandpant](https://github.com/anandpant)! - Draw swimlane flowcharts: a flowchart spec's `lanes: [{ id, label }]` and each node's `lane` draw one full-length band per actor, in order, with its name in a header. Steps sit in their lane's band, a handoff to the neighboring lane runs straight across the boundary, and lanes come out as locked shapes in Excalidraw, so steps stay free to move. `sketchi create` builds them offline, and `sketchi generate` adds lanes when a prompt describes a process across actors.

## 0.21.1

### Patch Changes

- [#465](https://github.com/shpitdev/sketchi/pull/465) [`07d7273`](https://github.com/shpitdev/sketchi/commit/07d72739ce4c450173505d7a0bbc7654c7212b42) Thanks [@anandpant](https://github.com/anandpant)! - Gantt dependency arrows read cleaner on dense plans. Arrows out of one task leave it down a shared trunk and branch off instead of crossing, a successor that starts under its predecessor's end takes a straight drop or a single elbow rather than a small step before the arrowhead, arrivals into one task spread above and below its middle, and arrows keep off the edges of bars they pass.

## 0.21.0

### Minor Changes

- [#464](https://github.com/shpitdev/sketchi/pull/464) [`b689eb5`](https://github.com/shpitdev/sketchi/commit/b689eb599566f0a5a8cf1651b6608b3ad88a008c) Thanks [@anandpant](https://github.com/anandpant)! - Add native UML class diagrams: `sketchi create` builds `{ "type": "class", "spec": { "title", "classes", "relationships" } }` documents offline, and `sketchi generate --type class` generates them. Each class draws as a box of three compartments: its name under any `«interface»`, `«abstract»` or `«enumeration»` keyword, its attributes and its methods, with visibility and `{static}` or `{abstract}` markers. Superclasses and interfaces stand above the classes that extend or implement them. Relationships draw with their UML heads: hollow triangles for inheritance and (dashed) realization, filled and hollow diamonds for composition and aggregation, open arrows for navigable associations and (dashed) dependencies, with multiplicities and roles beside their ends. Members may be written on one line, as in `"+ area(): double"`.

## 0.20.0

### Minor Changes

- [#457](https://github.com/shpitdev/sketchi/pull/457) [`3581590`](https://github.com/shpitdev/sketchi/commit/35815906556edabdf2a4fddd547e40015d136dc8) Thanks [@anandpant](https://github.com/anandpant)! - Add native ER diagrams: `sketchi create` builds `{ "type": "er", "spec": { "title", "entities", "relationships" } }` documents offline, and `sketchi generate --type er` generates them. Each entity draws as a table of its fields, with PK, FK and UK markers, types and nullable fields marked `?`. Each relationship draws as an orthogonal line between the rows it joins, with a crow's-foot end for its cardinality at each table: one, zero or one, many, one or many, or zero or many. Fields may be written on one line, as in `"customer_id uuid FK"`.

## 0.19.0

### Minor Changes

- [#450](https://github.com/shpitdev/sketchi/pull/450) [`5a82007`](https://github.com/shpitdev/sketchi/commit/5a82007ed648c9b12c67cff2635a8089c58d0162) Thanks [@anandpant](https://github.com/anandpant)! - Add native Gantt charts: `sketchi create` builds `{ "type": "gantt", "spec": { "title", "tasks" } }` documents offline, and `sketchi generate --type gantt` generates them. Tasks take a start day and an end day or a duration in calendar days, and may be milestones, sit under phases, record progress, and depend on other tasks finishing first. The chart draws a to-scale date axis, a date column, and dependency arrows routed clear of every bar and label.

## 0.18.0

### Minor Changes

- [#455](https://github.com/shpitdev/sketchi/pull/455) [`606641f`](https://github.com/shpitdev/sketchi/commit/606641f3a9d976e1f5fdba325ca255d8969cf51c) Thanks [@anandpant](https://github.com/anandpant)! - Mindmaps now draw as mindmaps: the central topic sits in the middle as an ellipse, main branches balance on both sides in clockwise order on an arc around it, and each branch's subtree grows outward in its own color, joined by curves that never cross or run through a topic. Label size steps down from the center, and a map too wide to read folds its deepest topics into lists below them. In Excalidraw each curve stays a curved arrow bound to both topics, and each main branch moves as one group.

## 0.17.2

### Patch Changes

- [#448](https://github.com/shpitdev/sketchi/pull/448) [`3c60efa`](https://github.com/shpitdev/sketchi/commit/3c60efadd4aacc90c453a4049a82aee48e57f827) Thanks [@anandpant](https://github.com/anandpant)! - Top-to-bottom flowcharts that run about 2.5 times taller than they are wide now wrap into side-by-side columns, as left-to-right flows already wrap into rows, when the flow splits into columns of similar height; a tall flow then exports closer to square with larger text. A flow whose only split would leave a short column beside a long one stays one column.

## 0.17.1

### Patch Changes

- [#447](https://github.com/shpitdev/sketchi/pull/447) [`1a37c6d`](https://github.com/shpitdev/sketchi/commit/1a37c6d4c231f0c971cfa9a43b45a0ee817ad2bb) Thanks [@anandpant](https://github.com/anandpant)! - Flowcharts and state machines draw fewer crossing lines: where lines still cross after layout, a line may move to another side of its node, a loop to the other side of the flow, or a decision's branches to other vertices, whenever that removes a crossing without adding other defects. Lines also keep a clear gap from every node they pass, rounded and pointed ones included, and a transition's label sits clearly nearer its own line than any other.

## 0.17.0

### Minor Changes

- [#439](https://github.com/shpitdev/sketchi/pull/439) [`fd92ae1`](https://github.com/shpitdev/sketchi/commit/fd92ae12eb8c7b26fc75bcbb6aa62878c57ca5bd) Thanks [@anandpant](https://github.com/anandpant)! - Add native state machines: `sketchi create` builds `{ "type": "state-machine", "spec": { "title", "initial", "states", "transitions" } }` documents offline, and `sketchi generate --type state-machine` generates them. States may be final or choices, states that name a `parent` form a composite drawn as a frame, and transitions are drawn `event [guard] / action`, including self-loops and transitions into or out of a composite.

## 0.16.0

### Minor Changes

- [#437](https://github.com/shpitdev/sketchi/pull/437) [`b78af27`](https://github.com/shpitdev/sketchi/commit/b78af2768cf4321d479283c334be898c3e899784) Thanks [@anandpant](https://github.com/anandpant)! - Add native bar, line and pie charts: `sketchi create` accepts `{"type":"chart"}` documents and `generate --type chart` builds them from a prompt. The renderer draws nice-tick axes, grouped or stacked bars that handle negative values, multi-series lines with distinct markers, and pies or donuts whose percentage labels move outside on leader lines for thin slices. Chart PNGs no longer get a second title banner.

## 0.15.1

### Patch Changes

- [#438](https://github.com/shpitdev/sketchi/pull/438) [`84b6ce3`](https://github.com/shpitdev/sketchi/commit/84b6ce3d4fa91516125e5ef1fb0a03ced7a2125f) Thanks [@anandpant](https://github.com/anandpant)! - Timeline axis breaks now state the time they leave out, such as `5 months` or `4.3 years`, and a break over a longer gap draws longer, so compressed spacing still reads in the order of real time.

## 0.15.0

### Minor Changes

- [#421](https://github.com/shpitdev/sketchi/pull/421) [`5299529`](https://github.com/shpitdev/sketchi/commit/529952956fcc4c9afe48bead342fa55236ccb353) Thanks [@anandpant](https://github.com/anandpant)! - Draw flowchart groups: declare `groups: [{ id, label }]` and set a node's `group` to put related steps in a labeled region, such as a team, a network zone or a phase. Each group exports as an Excalidraw frame named by its label.

## 0.14.1

### Patch Changes

- [#420](https://github.com/shpitdev/sketchi/pull/420) [`7672606`](https://github.com/shpitdev/sketchi/commit/7672606b227fba4e274c117d9de5e05da63124a2) Thanks [@anandpant](https://github.com/anandpant)! - Render PNGs of drawings that contain frames: each frame's name is painted above it instead of failing the offline export.

## 0.14.0

### Minor Changes

- [#404](https://github.com/shpitdev/sketchi/pull/404) [`e8518bb`](https://github.com/shpitdev/sketchi/commit/e8518bb84d83247b844328a9e0f520d0a787314e) Thanks [@anandpant](https://github.com/anandpant)! - Render timelines on a time-scaled axis with humanized dates, alternating labels, axis breaks and wrapped rows, and accept phases (`end`), milestones, lanes, a stated `today`, year or month precision, and zoned instants.

## 0.13.0

### Minor Changes

- [#400](https://github.com/shpitdev/sketchi/pull/400) [`fcf33cb`](https://github.com/shpitdev/sketchi/commit/fcf33cb78c2d34bdea57cbffa9232eb086d96400) Thanks [@anandpant](https://github.com/anandpant)! - Add native timeline creation, generation, storage, and export from semantic events with dates or explicit order.

## 0.12.0

### Minor Changes

- [#380](https://github.com/shpitdev/sketchi/pull/380) [`ac83f4d`](https://github.com/shpitdev/sketchi/commit/ac83f4d0d8f526bdc0bbd697d25a9cae143aeecf) Thanks [@anandpant](https://github.com/anandpant)! - Sequence diagrams now draw brand logos in participant headers. In `sketchi create`, a participant may set `"icon": { "slug": "github" }`. `sketchi generate` places logos only on participants whose labels name a technology the prompt mentions. The logos appear in PNG and Excalidraw exports, using the same catalog, offline resolution, and drop-with-a-warning rules as flowchart node logos.

## 0.11.0

### Minor Changes

- [#379](https://github.com/shpitdev/sketchi/pull/379) [`6cc6b39`](https://github.com/shpitdev/sketchi/commit/6cc6b391463e6372952b7737796e7aeb4bfeb62a) Thanks [@anandpant](https://github.com/anandpant)! - `sketchi generate --type` now lists and accepts only the diagram types Sketchi draws: flowchart, mindmap, and sequence. Help no longer advertises ER, architecture, swimlane, or state-machine. Without `--type`, a prompt that asks for another kind of diagram still fails with the typed `unsupported_diagram_type` error instead of being coerced. `sketchi create` and the generate builder now take their document types from one shared family registry.

## 0.10.0

### Minor Changes

- [#376](https://github.com/shpitdev/sketchi/pull/376) [`49c0292`](https://github.com/shpitdev/sketchi/commit/49c0292023a1a18ac9ab5a8d36dd367357449272) Thanks [@anandpant](https://github.com/anandpant)! - Sequence diagrams from `sketchi create` and `sketchi generate` now draw activation bars. A message of type `return` answers the latest open call between the two participants, and the callee's lifeline shows a bar from that call to its return. Re-entrant calls nest, and calls nobody answers draw no bar. Messages attach to the bars in the PNG and Excalidraw exports.
  
  Activation bars use ids under `<participant>:lifeline:`, so a participant id that starts with another participant's id followed by `:lifeline` (for example `api:lifeline:v2` next to `api`) is now rejected. Before, only an exact `api:lifeline` collided. The repair hint is now "Rename the participant so its id does not start with another participant id followed by :lifeline."

## 0.9.0

### Minor Changes

- [#367](https://github.com/shpitdev/sketchi/pull/367) [`9319c86`](https://github.com/shpitdev/sketchi/commit/9319c866476dfb0ea95df54b2e6501b68889f97e) Thanks [@anandpant](https://github.com/anandpant)! - `sketchi generate` now draws brand logos inside flowchart nodes for the technologies a prompt names, such as GitHub, Docker, or Postgres. Logos are limited to the ones the prompt mentions, and everyday words such as "stream" or "segment" never count as a product name. Unknown slugs in `create` and `edit` point at https://icons.sketchi.app. `sketchi docs` explains how to add a node `icon` by hand.

## 0.8.0

### Minor Changes

- [#366](https://github.com/shpitdev/sketchi/pull/366) [`71d19ca`](https://github.com/shpitdev/sketchi/commit/71d19ca947f56d74863f09fd6f778720f352ca35) Thanks [@anandpant](https://github.com/anandpant)! - Node logos now appear in exported drawings and PNGs. `sketchi export --format png` rasterizes the logo images embedded in a diagram, and `sketchi pull` keeps a shared drawing's image files instead of dropping them. PNG export also handles drawings whose image ids contain characters like `:`, and its embedded-image size limit counts only images still in the drawing.

## 0.7.0

### Minor Changes

- [#357](https://github.com/shpitdev/sketchi/pull/357) [`31eb8e7`](https://github.com/shpitdev/sketchi/commit/31eb8e77a012f0ef0f2b86d1a14c85b3cc732fa0) Thanks [@anandpant](https://github.com/anandpant)! - Flowchart specs accept an optional node `icon: { "slug": "docker" }` from the Sketchi logo catalog, resolved offline from logos bundled with the CLI. Unknown slugs, wordmarks, and oversized marks are dropped with an `unknown_icon` warning and never fail the build.

## 0.6.3

### Patch Changes

- [#355](https://github.com/shpitdev/sketchi/pull/355) [`c2786fb`](https://github.com/shpitdev/sketchi/commit/c2786fb9e0352166e33f33070a548b32d46cd061) Thanks [@anandpant](https://github.com/anandpant)! - Generated diagrams no longer clip CJK, emoji, or long connector labels when opened in Excalidraw. Nodes are sized for wide glyphs, long edge labels wrap, long sequence participant names wrap inside their headers, and a label that would still overflow its node is reported instead of clipped. Latin-only layouts keep their exact previous widths. Text-style symbols such as © ™ ✔ ⚠ keep the default width; only emoji-presentation glyphs count as emoji.

## 0.6.2

### Patch Changes

- [#337](https://github.com/shpitdev/sketchi/pull/337) [`4bfbd96`](https://github.com/shpitdev/sketchi/commit/4bfbd968045cab7c6e7f9f9e61581fbd7baba0b8) Thanks [@anandpant](https://github.com/anandpant)! - List and show stored diagrams faster by avoiding PNG decompression during metadata reads. PNGs are still fully validated when written or consumed; command behavior is otherwise unchanged.

## 0.6.1

### Patch Changes

- [#332](https://github.com/shpitdev/sketchi/pull/332) [`02cc491`](https://github.com/shpitdev/sketchi/commit/02cc4912246048f7a3a036f0e7015fd731533f6e) Thanks [@anandpant](https://github.com/anandpant)! - Keep stored diagrams discoverable when individual records are busy or unreadable, and prevent exports from writing into storage. Bound network requests and response bodies, document 90-second canvas timeouts with exit code 11, cancel pending prompts and browser openers, and keep output-format selection consistent.

## 0.6.0

### Minor Changes

- [#321](https://github.com/shpitdev/sketchi/pull/321) [`641849e`](https://github.com/shpitdev/sketchi/commit/641849e8dba066c2c405cc444aa610a24e94e3f7) Thanks [@anandpant](https://github.com/anandpant)! - Add the noninteractive `sketchi canvas` command for typed Universal CanvasSpec creation, local persistence, and artifact export through the public production API.

## 0.5.0

### Minor Changes

- [#318](https://github.com/shpitdev/sketchi/pull/318) [`5bb5d20`](https://github.com/shpitdev/sketchi/commit/5bb5d202770520b76b39d27cc1cd97e7dc60eb3c) Thanks [@anandpant](https://github.com/anandpant)! - Add native sequence generation, model-selected diagram types, deterministic intent-plan validation, and adaptive PNG export scaling for large diagrams.

## 0.4.3

### Patch Changes

- [#306](https://github.com/shpitdev/sketchi/pull/306) [`074acf7`](https://github.com/shpitdev/sketchi/commit/074acf78a8132f2e6360ed4cf684522579e7cd20) Thanks [@anandpant](https://github.com/anandpant)! - Paint a legible pencil mark on root help and stop dropping colour on terminals that omit `COLORFGBG`. The lockup is a half-block pixel icon and `sketchi` wordmark; root help collapses to `START HERE` and `WORK WITH A DIAGRAM`. Pipes, `NO_COLOR`, JSON and non-UTF-8 locales still render plain text with no block art.

## 0.4.2

### Patch Changes

- [#304](https://github.com/shpitdev/sketchi/pull/304) [`ab9cd3f`](https://github.com/shpitdev/sketchi/commit/ab9cd3fd44e833502dce2342ae1e2b2a51847ead) Thanks [@anandpant](https://github.com/anandpant)! - Add a human-TTY-only generate wizard and responsive, terminal-aware CLI presentation while preserving direct and machine-readable generation contracts.

## 0.4.1

### Patch Changes

- [#302](https://github.com/shpitdev/sketchi/pull/302) [`b8ed328`](https://github.com/shpitdev/sketchi/commit/b8ed328b5d90ed758e016d354c42c8004aec084a) Thanks [@anandpant](https://github.com/anandpant)! - Redesign root help as a progressive, terminal-aware Sketchi landing screen with a recognizable pencil lockup, a prompt-first example, and ANSI-free pipe, JSON, and `NO_COLOR` output.

## 0.4.0

### Minor Changes

- [#300](https://github.com/shpitdev/sketchi/pull/300) [`60e1c1e`](https://github.com/shpitdev/sketchi/commit/60e1c1e6cc2df18841ea79932d743b473c0dc1bf) Thanks [@anandpant](https://github.com/anandpant)! - Make the default CLI help concise and human-readable, move complete automation
  contracts to `sketchi docs`, and export generated diagrams to PNG by default.

## 0.3.0

### Minor Changes

- [#276](https://github.com/shpitdev/sketchi/pull/276) [`9e55dc4`](https://github.com/shpitdev/sketchi/commit/9e55dc4c6d3f254938fb25bf4b7c5c9cde921b52) Thanks [@anandpant](https://github.com/anandpant)! - Apply offline semantic patches to stored diagrams with scene authority, atomic revision recovery, and coherent Excalidraw and PNG export.

## 0.2.0

### Minor Changes

- [#273](https://github.com/shpitdev/sketchi/pull/273) [`01beea6`](https://github.com/shpitdev/sketchi/commit/01beea637c597b57434c027322e66b43c023096b) Thanks [@anandpant](https://github.com/anandpant)! - Add encrypted Excalidraw share links, validated pull-to-detached authority, full-snapshot revisions, and offline restore.

## 0.1.1

### Patch Changes

- [#269](https://github.com/shpitdev/sketchi/pull/269) [`ef6b392`](https://github.com/shpitdev/sketchi/commit/ef6b3925125d197649559331fb5c7c2e0059fd93) Thanks [@anandpant](https://github.com/anandpant)! - Add linked changelog entries and publish matching GitHub Releases for new CLI versions.

## 0.1.0

### Minor Changes

- a78a753: Render deterministic PNG exports on demand from local diagram artifacts and include an agent-friendly display hint for PNG file exports.

## 0.0.2

### Patch Changes

- 7f6e4f3: Ship shell completions, harden `install.sh`, and include the CLI README in the npm package.
