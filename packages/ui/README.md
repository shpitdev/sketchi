# ui

Shared shadcn primitives for Sketchi's Tailwind apps (`apps/web` and
`apps/playground`), plus `cn` and the stylesheet that maps shadcn tokens onto the
shared theme.

```tsx
import { Button } from "@sketchi/ui/components/button";
```

Add a primitive with `pnpm dlx shadcn@latest add <name>` from an app directory;
the app's `components.json` writes it here. Primitives own their appearance
through variants. See [UI style contracts](../../docs/ui-style-contracts.md).

## Commands

```sh
pnpm nx build ui
pnpm nx typecheck ui
```
