# @sketchi/cli

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
