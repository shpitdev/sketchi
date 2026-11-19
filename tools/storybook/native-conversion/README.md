# Diagram family gallery

Review all 15 diagram families in Studio's `GenerationWorkspace`, plus the shared
Excalidraw canvas and the Editor's SVG-to-native workspace. Family fixtures live
in `tools/storybook/families/`. The gallery serves Excalifont from the shared
editor-surface package.

From the repository root:

```sh
pnpm storybook        # http://127.0.0.1:6010
pnpm build-storybook  # storybook-static/native-conversion/
```

The gallery is optional. It does not run in CI or deploy to a Worker.
