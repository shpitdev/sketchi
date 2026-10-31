# UI style contracts

`apps/web` and `apps/playground` are Tailwind apps that share one set of shadcn
primitives in `packages/ui` (`@sketchi/ui`). Each app's `components.json` points
its `ui` and `utils` aliases at that package, so `shadcn add` writes new
primitives there and both apps import the same file:

```tsx
import { Button } from "@sketchi/ui/components/button";
import { cn } from "@sketchi/ui/lib/utils";
```

`packages/ui/src/styles.css` imports Tailwind, `tw-animate-css` and the shared
theme (`packages/diagram/ui/src/theme.css`), then maps shadcn's token names onto
the theme. The theme is imported into Tailwind's `base` layer, so utilities win
over its element rules while each app's own unlayered stylesheet still wins over
both. Each app imports that file first and adds `@source` for its own
files; automatic source detection is off. The theme stays the one place for
colours, radii, shadows and fonts. `icons` and `excalidraw` still use the theme
with plain CSS.

## Rules

Use a primitive's variants and sizes for appearance. `className` on a primitive
owns layout only. When a page needs a new look, add a variant to the primitive
(Button's `brand` fill and `xl` size are the site's call to action) instead of
overriding it at the call site. Page sections keep their own classes in the
app's stylesheet.

Use theme tokens and the Tailwind scale, not raw colours or arbitrary values.
Pass per-element values, such as a hero node's position, through CSS custom
properties in `style`; other inline style properties are rejected.

## Enforcement

`pnpm run lint` runs [`@shadcn/lint`](https://github.com/shadcn-ui/lint) and
[`eslint-plugin-better-tailwindcss`](https://github.com/schoero/eslint-plugin-better-tailwindcss)
as Oxlint JS plugins, configured in `tools/oxlint/ui-style-policy.json`:

- In `apps/web/src` and `apps/playground/src`: `no-restyle` (layout only),
  `no-raw-colors`, `no-arbitrary-values` (layout only), `no-inline-styles`,
  `require-static-classes` and `no-unknown-classes`. Plain class selectors in the
  app's stylesheet count as known classes, so a class with no CSS behind it fails.
- better-tailwindcss adds only `no-conflicting-classes` and
  `no-duplicate-classes`, against each app's stylesheet.
- In `packages/ui/src/components` the primitives style themselves, so
  `no-restyle`, `no-arbitrary-values` and `require-static-classes` are off.

## Exceptions

Each exception names exact files or classes:

- The vendored AI Elements in `apps/playground/src/components/ai-elements`
  compose primitives the way upstream does so registry updates apply cleanly.
  Only `no-raw-colors` and `no-unknown-classes` run there; the upstream marker
  classes `not-prose`, `is-user` and `is-assistant` are allowed.
- Radix's `Collapsible` root is unstyled, so it accepts colour as well as layout.
- The playground's starter prompts render `Suggestion` buttons as two-line cards
  through `studio__starter`.

Static analysis cannot see the cascade, contrast or the rendered shape. Check UI
changes on the real page at desktop and mobile widths.
