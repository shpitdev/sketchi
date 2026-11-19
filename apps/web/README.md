# web

Public Sketchi home and docs surface for the v2 product direction.

```mermaid
flowchart LR
  Routes["home and docs routes"] --> Marketing["marketing components"]
  Routes --> Docs["docs view"]
  Marketing --> Worker["Cloudflare Worker"]
  Docs --> Worker
```

| Owns                            | Does not own                     |
| ------------------------------- | -------------------------------- |
| public home and docs routes     | diagram generation runtime       |
| marketing and product copy UI   | Code Mode MCP/API implementation |
| app-specific Storybook states   | artifact storage or rendering    |
| Worker deployment for `sketchi` | Excalidraw nav                   |

## Commands

```sh
pnpm nx dev web               # http://127.0.0.1:6201
pnpm nx test web
pnpm nx typecheck web
pnpm nx build web
pnpm nx preview web           # serve the build at http://127.0.0.1:6301
pnpm nx storybook web
pnpm nx build-storybook web
pnpm nx run web:social-card    # redraw the link-preview card
pnpm nx run web:home-diagram   # re-export the home diagram after replacing its scene
```

Production deploys run through the
[production workflow](../../.github/workflows/app-production-deploy.yml).

### Local sibling links

Web links to the public Icons and Playground sites by default. To link to the
local dev servers instead, put these values in `apps/web/.dev.vars` and restart
Web:

```dotenv
SKETCHI_ICONS_URL=http://127.0.0.1:6203
SKETCHI_PLAYGROUND_URL=http://127.0.0.1:6210
```

## Usage

Keep public-facing product explanation here. Public navigation should point to
Sketchi Playground, Icons, docs, and setup routes, not the standalone
Excalidraw workspace. If docs become interactive, route through
shared packages deliberately instead of letting the marketing app own diagram
runtime behavior.
