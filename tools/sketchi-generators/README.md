# Sketchi Generators

Local Nx generators for the v2 Sketchi workspace.

## Diagram Types

Use this when adding a new maintained diagram contract:

```sh
pnpm nx g @sketchi/generators:diagram-type mindmap \
  --label="Mind map" \
  --description="Radial knowledge map contract" \
  --prompt="Show a radial mindmap fixture."
```

The generator creates the core fixture/test, renderer contract test, Studio
Storybook story, catalog entry, fixture registry entry, and package export.

## Studio Components

Use this before hand-authoring a reusable Studio component:

```sh
pnpm nx g @sketchi/generators:ui-component diagram-status-strip
```

The generator creates a component file, test, Storybook story, local barrel
export, and package export. After generation, replace the placeholder props and
markup with the real component contract.

The `diagram-studio-ui` test target includes a structure guard that fails if a
component under `src/components/*` is missing its test, story, local export, or
package export.

## Checks

```sh
pnpm nx test sketchi-generators
pnpm nx typecheck sketchi-generators
pnpm nx test diagram-studio-ui
pnpm nx build-storybook diagram-studio-ui
pnpm nx test-storybook diagram-studio-ui
```
