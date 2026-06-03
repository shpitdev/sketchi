# @sketchi/mcp-server

Generic MCP adapter for Sketchi diagram tools.

The package exposes the shared `@sketchi/diagram-agent-tools` catalog over MCP instead of copying OpenCode plugin definitions. `createSketchiMcpServer` accepts a host-provided executor, and the `sketchi-mcp` stdio entrypoint uses `createSketchiHttpToolExecutor` by default.

## Local Stdio

```sh
SKETCHI_BEARER_TOKEN=... pnpm nx build mcp-server
node packages/mcp-server/dist/stdio.js
```

`SKETCHI_API_URL` defaults to `https://www.sketchi.app`. `SKETCHI_ACCESS_TOKEN` and `SKETCHI_BEARER_TOKEN` are accepted for bearer auth.

## Current Executor Coverage

- `diagram_from_prompt`: calls `/api/diagrams/thread-run`.
- `diagram_tweak`: calls `/api/diagrams/session-seed` for inline Excalidraw scenes when needed, then `/api/diagrams/thread-run`.
- `diagram_restructure`: calls `/api/diagrams/session-seed` for inline Excalidraw scenes when needed, then `/api/diagrams/thread-run`.
- `diagram_to_png`: requires a host renderer executor.
- `diagram_grade`: requires a host LLM/grading executor.
