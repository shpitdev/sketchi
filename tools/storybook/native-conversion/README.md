# Native conversion Storybook

Unified Chromatic surface for the SVG native-conversion vertical and the diagram
family stories in `tools/storybook/families`. It publishes:

- Icons supported, warned, blocked, and original capability states;
- editor (`apps/editor`) editable and blocked SVG workspace states;
- the shared native editable-element canvas story;
- one story per diagram family.

The Nx project has explicit dependencies on `editor`, `excalidraw` (`apps/editor`),
`icons`, and `playground` (`apps/studio`), so changes to any product surface mark
this Storybook as affected and trigger the single Chromatic publication.

```sh
pnpm nx build-storybook native-conversion-storybook
pnpm nx chromatic native-conversion-storybook
```
