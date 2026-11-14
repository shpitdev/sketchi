# Effect compiler and lint toolchain

The native check uses `effect-tsgo tsc@7.0.2`. Lint uses `effect-tsgo oxlint`.
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
- The Effect-native group, `runEffectInsideEffect`, `strictEffectProvide`, and
  `schemaSyncInEffect` are warnings while their scopes await conversion.
- Warnings do not change the compiler exit code. Correctness errors do.
- `experimentalApiUsage`, `unstableApiUsage`, and `apiStabilityLeak` are off.
  Maturity alone does not reject an API.
- Other upstream diagnostics retain their defaults. Suggestion output is
  omitted from compiler logs; style suggestions are not promoted to errors.

Effect diagnostics run in the compiler. Oxlint retains its existing
type-aware rules, custom plugins, and `denyWarnings` gate; it does not duplicate
the Effect rules. This keeps migration warnings visible without relaxing the
existing lint gate. The checked-in levels are the fixed policy for domain, server,
React and tooling purposes in [Effect conventions](effect-conventions.md). Converted
scopes promote the applicable native group; they do not narrow correctness.

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

Existing TS6 declaration emit, root build mode, and paired TS6 checks are retained
at this staging checkpoint. Native emit was exercised for all 15 package builds:
373 declarations were emitted, 338 byte-identical to TS6, but seven builds exit
nonzero on existing Effect correctness diagnostics. All 15 package entrypoint
exports are mutually assignable between the two emitted outputs under both
compilers; an actual observability consumer also compiles and runs. Retaining the
old commands does not bypass the native gate: `ci:local` still requires both checks. It also
does not make the slice accepted while native diagnostics fail.

Remove the TS6 CLI build/check commands after the affected native builds and
checks pass, their real consumers accept the generated declarations, and root
reference builds pass through the native runner. Keep only Nx's demonstrated
compiler-API consumer after that transition. Do not claim TS7 cannot emit:
the current blockers are application diagnostics, not a demonstrated native
emit incompatibility. Detailed one-time evidence belongs in
`.memory/effect-toolchain/receipt.md`, not in a permanent source inventory.

`scripts/lib/effect-toolchain.test.mjs` exercises the actual workspace compiler
configuration: error/warning exit behavior, executable emit, and a separate
consumer that succeeds with the correct declaration type and fails with the
wrong one after the original source has been removed.

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

Existing TS6 builds and paired checks remain while this configuration migration is
reviewed. New packages use the native build/typecheck targets from the thin
[Effect library composition](../tools/sketchi-generators/README.md). Its compiler
version comes from the root package pin; runtime versions remain in the pnpm catalog.
