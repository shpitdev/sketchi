# @sketchi/cli

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
