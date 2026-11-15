# Sketchi generators

Use the workspace plugin for an Effect package or a UI component.

```sh
pnpm nx g @sketchi/generators:effect-library packages/example \
  --name=example --importPath=@sketchi/example --tags=scope:package,type:lib
pnpm nx g @sketchi/generators:ui-component StatusBadge
pnpm nx sync
pnpm nx sync:check
```

`effect-library` composes the installed `@nx/js:library` generator. Nx owns package
exports, ESM configuration and references; the composition selects the workspace's
pinned `effect-tsgo` runner, adds `effect` through the pnpm catalog, and creates an
empty export entrypoint. It removes upstream's sample function and unused `tslib`
dependency (`importHelpers` is false). It refuses an existing destination before
writing anything. Directory, import identity, name and boundary tags are explicit.

New packages build and typecheck with the native compiler. Root Oxlint and oxfmt
already cover them; no package-local lint/format config or sample test is generated.
Add a test runner when the package first has an application behavior to test. This
composition creates no service abstraction or business implementation.

The UI generator creates a component, story and export. Family ownership follows
[the product structure](../../docs/plans/product-structure.md); the former node/edge
family scaffold has been removed.

```sh
pnpm nx test sketchi-generators
pnpm nx typecheck sketchi-generators
pnpm nx build sketchi-generators
```

The integration test generates two packages in a disposable workspace, builds their
real exports, runs a consumer, checks a type error and affected dependency discovery,
and verifies that repeat generation cannot overwrite user source.
