# Native conversion Storybook

Unified Chromatic surface for the SVG native-conversion vertical. It publishes:

- Icons supported, warned, blocked, and original capability states;
- Excalidraw editable and blocked SVG workspace states;
- the shared native editable-element canvas story.

The Nx project has explicit dependencies on `icons`, `excalidraw`, and
`diagram-ui`, so changes to any product surface mark this Storybook as
affected and trigger the single Chromatic publication.

```sh
pnpm nx build-storybook native-conversion-storybook
pnpm nx chromatic native-conversion-storybook
```
