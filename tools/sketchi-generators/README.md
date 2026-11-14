# Sketchi generators

Use the workspace plugin for an Effect package, a UI component, or a diagram family.

```sh
pnpm nx g @sketchi/generators:effect-library packages/example \
  --name=example --importPath=@sketchi/example --tags=scope:package,type:lib
pnpm nx g @sketchi/generators:ui-component StatusBadge
pnpm nx g @sketchi/generators:diagram-type timeline --title "Sketchi timeline fixture"
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

The UI generator creates a component, story and export. The diagram generator
registers a Struct contract and fixture, a renderer behavior test and a story.
Neither generates the former trivial component-render or fixture-equality test.
Complete the actual family pipeline described in
[adding a diagram family](../../docs/diagram-families.md); its compiler and behavioral
checks remain required.

```sh
pnpm nx test sketchi-generators
pnpm nx typecheck sketchi-generators
pnpm nx build sketchi-generators
```

The integration test generates two packages in a disposable workspace, builds their
real exports, runs a consumer, checks a type error and affected dependency discovery,
and verifies that repeat generation cannot overwrite user source. Title escaping
coverage remains where the diagram template interpolates user input.
