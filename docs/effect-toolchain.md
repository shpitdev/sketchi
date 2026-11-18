# Effect compiler and lint toolchain

Package emit, project `typecheck`, and the root reference build use
`effect-tsgo tsc@7.0.2`. Lint uses `effect-tsgo oxlint`.
These are upstream direct runners: they select the packaged compiler and load
the matching Oxlint binding without patching `node_modules` or pnpm's store.
Do not run `effect-tsgo patch` in this workspace.

The coupled pins are `@effect/tsgo` 0.69.0, TypeScript 7.0.2 under the
`@typescript/native` alias, Oxlint and `@oxlint/plugins` 1.93.0, and
`oxlint-tsgolint` 7.0.2007. All three executable versions are supported by the
[published Effect runner](https://github.com/Effect-TS/tsgo#supported-package-versions).
Upgrade the plugin API and native lint engine together with Oxlint, checking the
new runner's published compatibility table first. `pnpm toolchain:verify` checks
the executables actually selected locally.

## Diagnostic ownership

`tsconfig.base.json` configures the upstream `@effect/language-service` plugin
name recognized by the native compiler; a separate TS6 language-service package
is not needed. All native project targets and the tooling compiler use it.

- The upstream correctness group is explicitly error, except maturity checks.
- Effect boundary errors, including raw I/O, layer lifetime, and synchronous
  schema rules, fail the compiler. Advisory diagnostics do not affect its exit code.
- `experimentalApiUsage`, `unstableApiUsage`, and `apiStabilityLeak` are off.
  Maturity alone does not reject an API.
- Other upstream diagnostics retain their defaults. Suggestion output is
  omitted from compiler logs; style suggestions are not promoted to errors.

Oxlint's upstream `effecttsgo` plugin also enforces the raw I/O rules, including
in JavaScript outside the compiler's project graph, with the same test, build
script and Node program scopes. Both runners recognize `@effect-diagnostics` directives. See
[Effect conventions](effect-conventions.md) for exceptions and advisory rules.

Slice 1c removes the old Effect exclusions and Promise/runtime syntax census after
live diagnostic proof. Coverage is not identical: assigned `Promise.resolve`, `.then`
and outer runtime runners may have no Effect diagnostic. Retain real lifecycle tests,
Nx dependency constraints and existing Promise misuse lint; review host ownership.
Do not replace this acknowledged gap with another syntax inventory.

## Remaining TypeScript 6 consumers

The `typescript` module remains the official `@typescript/typescript6` 6.0.2
compatibility package (its API reports 6.0.3). Nx 24's `@nx/js:tsc` executor
builds `sketchi-generators` using `createProgram`/`createCompilerHost`, and the
reference-sync generator parses configurations through the TS6 API. The custom
project-graph compiler walker was removed in slice 1c; the existing formatting and
generator title-escaping checks still use the TS6 API. TypeScript 7's package-root
export exposes its version, not that compiler API. Remove this dependency only
when the remaining compiler-API consumers migrate to supported APIs; native CLI availability
does not establish API compatibility.

The duplicate TS6 CLI checks and emit commands are retired. Each project's
`typecheck` target runs the native compiler over the same source/spec configs in
the same order; dependency builds still run first. Package emit uses the native
runner, including the declaration step after the diagram UI Vite build and the
compiler step before icon asset generation. The local gate runs native
`typecheck,build` targets and native root build mode. There is no separate paired
`typecheck-native` target or compatibility script alias.

The existing `sketchi-generators:build` target retains the real upstream
`@nx/js:tsc` executor and its TS6 API dependency, including asset handling. Its
standalone typecheck is native. No direct TS6 CLI command remains. Replace that
executor only when upstream supports the required compiler API or a supported
replacement preserves its actual output/assets contract; do not emulate it in a
custom executor merely to remove TS6.

Retirement follows successful native root forced emit, all 15 package outputs,
affected builds/checks and real downstream declaration/runtime consumers. The
previous two-compiler declaration-assignability proof remains useful evidence;
it is not a permanent duplicate gate. Receipts are in
`.memory/effect-native-retirement/receipt.md` and `.memory/effect-nx/receipt.md`.

## Nx references and generation

Root references name project directories. Libraries expose empty solution configs
referencing their emitting lib config and no-emit spec config; apps and Node tools
have empty solutions over no-emit app/spec configs. Empty solutions allow emit but
contain no source, so consumers can reference them without TS6310. Spec configs use
`composite: false` and include the existing source/test surface and config files;
this avoids requiring unrelated imported test helpers to be emitted as one project.

`@nx/js:typescript-sync` owns dependency references. `pnpm nx sync` repairs drift;
`pnpm nx sync:check` rejects it and runs in the local gate. The old hardcoded
project-root/reference arrays are removed. Project boundary lint and meaningful
host restrictions remain. Vitest/Worker/Storybook/browser/corpus targets retain
their existing executors and behavior; no new inference plugin replaces them.

`disableSourceOfProjectReferenceRedirect` makes checks consume built declarations.
On the installed TS7 runner, referenced packages with empty solution configs otherwise
resolve their source files yet report missing re-exported bindings (for example
`SketchiIcon` from icon-catalog). TS6 accepts those sources, and the native check passes
against the emitted declarations. Each project's own source remains checked; dependency
build ordering and native declaration integration proof remain required.

New packages use the same native build/typecheck targets through the thin
[Effect library composition](../tools/sketchi-generators/README.md). Its compiler
version comes from the root package pin; runtime versions remain in the pnpm catalog.
