# V2 Architecture Notes

## Goal

Sketchi v2 starts as a package-first workspace. The application shell, MCP/API surface, and editor UI all depend on the same diagram contracts instead of inventing parallel shapes.

## Package Boundaries

- `diagram-core` owns the intermediate representation, validation, and durable fixtures.
- `diagram-renderer` converts valid intermediate diagrams into deterministic scene elements.
- `diagram-exporter` owns host-neutral Excalidraw file/share parsing, safe PNG output paths, and local Playwright-backed PNG rendering.
- `diagram-studio-ui` owns reusable React controls and visual states with Storybook coverage.
- `diagram-agent-tools` owns host-neutral diagram tool names, input schemas, descriptions, and routing hints.
- `mcp-server` adapts the shared diagram tool catalog to MCP over stdio and accepts host-provided executors. Its default HTTP executor can call Sketchi's server-backed generation/edit APIs and the shared PNG exporter; host-owned grading remains an explicit executor responsibility.
- `apps/web` is a TanStack Start shell. It should stay thin.

## Deployment

The web app targets Cloudflare Workers. The app package contains the Cloudflare Vite plugin and Wrangler configuration so deploy proof does not depend on Vercel build chaining.

## Final Integration

The fork remains a lab. When v2 reaches parity proof, land it into `shpitdev/sketchi` with one integration PR so GitHub stars/watchers remain attached to the original repository.
