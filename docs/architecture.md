# V2 Architecture Notes

## Goal

Sketchi v2 starts as a package-first workspace. The application shell, MCP/API surface, and editor UI all depend on the same diagram contracts instead of inventing parallel shapes.

## Package Boundaries

- `diagram-core` owns the intermediate representation, validation, and durable fixtures.
- `diagram-renderer` converts valid intermediate diagrams into deterministic scene elements.
- `diagram-studio-ui` owns reusable React controls and visual states with Storybook coverage.
- `apps/web` is a TanStack Start shell. It should stay thin.

## Deployment

The web app targets Cloudflare Workers. The app package contains the Cloudflare Vite plugin and Wrangler configuration so deploy proof does not depend on Vercel build chaining.

## Final Integration

The fork remains a lab. When v2 reaches parity proof, land it into `shpitdev/sketchi` with one integration PR so GitHub stars/watchers remain attached to the original repository.

