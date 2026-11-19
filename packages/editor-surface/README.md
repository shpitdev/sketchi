# editor-surface

Reusable React components for Sketchi diagram review surfaces.

```mermaid
flowchart LR
  Packages["diagram packages"] --> Components["review components"]
  Components --> Studio["apps/studio"]
  Components --> Editor["apps/editor"]
```

| Owns                                  | Does not own                   |
| ------------------------------------- | ------------------------------ |
| reusable diagram review components    | app routes or navigation       |
| Excalidraw canvas wrappers for review | Worker APIs or persistence     |
| shared component CSS                  | model calls or Code Mode tools |
|                                       | production domain deployment   |

## Commands

```sh
pnpm nx test editor-surface
pnpm nx typecheck editor-surface
pnpm nx build editor-surface
```

## Usage

Apps compose this package when they need a diagram preview or an Excalidraw
canvas. Keep reusable state and component
coverage here; app-specific routing and service calls stay inside `apps/*`.

See the [local diagram family gallery](../../tools/storybook/native-conversion/README.md)
for canvas examples.
