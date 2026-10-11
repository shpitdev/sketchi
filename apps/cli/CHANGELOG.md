# @sketchi/cli

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
