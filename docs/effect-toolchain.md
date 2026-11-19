# Effect compiler and lint toolchain

Project `typecheck` targets run native TypeScript 7 through `effect-tsgo`. Package emit and the root reference check also use the native runner. Lint runs `effect-tsgo oxlint`. These runners select the compiler and load the matching Oxlint binding directly; do not run `effect-tsgo patch`.

Check the [runner's supported versions](https://github.com/Effect-TS/tsgo#supported-package-versions) before upgrading `@effect/tsgo`, `@typescript/native`, Oxlint, `@oxlint/plugins` or `oxlint-tsgolint`. Use `pnpm toolchain:verify` to check the executables the workspace selects.

## Diagnostics

`tsconfig.base.json` configures `@effect/language-service` for the native compiler. Correctness errors fail the typecheck; advisory diagnostics do not. API maturity alone is not an error. Oxlint's `effecttsgo` plugin also checks raw I/O in JavaScript outside the TypeScript project graph. See [Effect conventions](effect-conventions.md) for rule scopes and exceptions.

## Why TypeScript 6 is installed

Nx uses the TypeScript 6 `typescript` module for compiler APIs such as `createProgram` and for reference sync. The TypeScript 7 package root does not expose those APIs. This is a build-tool dependency, not a second CLI typecheck.

## Project references

Root references point to project directories. Each project's solution config references its source and spec configs. `@nx/js:typescript-sync` owns dependency references: `pnpm nx sync` repairs drift and `pnpm nx sync:check` checks it in the local gate.

`disableSourceOfProjectReferenceRedirect` makes typechecks read dependency declarations rather than their source. Build dependencies first so those declarations exist.
