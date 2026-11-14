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
existing lint gate. The checked-in diagnostic levels are the starting point for
slice 1c's per-scope promotions, not permission to disable findings to pass CI.

The old Effect import bans and Promise/runtime inventories remain owned by
slice 1c. The new compiler is not complete coverage of that inventory: a probe
detects `async`, `new Promise`, and nested Effect runners, but does not flag
assigned `Promise.resolve`, `.then`, or an outer `Effect.runPromise`. Do not
delete those checks on an assumption of equivalent coverage.

## Remaining TypeScript 6 consumers

The `typescript` module remains the official `@typescript/typescript6` 6.0.2
compatibility package (its API reports 6.0.3). Nx 24's `@nx/js:tsc` executor
builds `sketchi-generators` using `createProgram`/`createCompilerHost`, and
`tools/project-graph.test.ts` also consumes that API. TypeScript 7's package-root
export exposes its version, not that compiler API. Remove this dependency only
when those real consumers migrate to supported APIs; native CLI availability
does not establish API compatibility.

Existing TS6 declaration emit, root build mode, and paired TS6 checks are retained
at this staging checkpoint. Native emit was exercised for all 15 package builds:
373 declarations were emitted, 338 byte-identical to TS6, but seven builds exit
nonzero on existing Effect correctness diagnostics. All 15 package entrypoint
exports are mutually assignable between the two emitted outputs under both
compilers; an actual observability consumer also compiles and runs. Retaining the
old commands
does not bypass the native gate: `ci:local` still requires both checks. It also
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
