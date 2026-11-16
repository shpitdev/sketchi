# MCP SDK compatibility

In the checked-in source, Sketchi's two MCP servers are inbound and authless,
and neither uses the MCP SDK:

- Studio (`apps/studio/src/features/mcp/mcp.server.ts`) registers `docs`,
  `search` and `execute` on Effect's `McpServer` from `effect/ai`.
- Icons (`apps/icons/src/features/mcp/mcp.server.ts`) registers its read-only icon
  tools the same way.
- Both route each session to a Durable Object (`StudioMcpSession`,
  `IconsMcpSession`) through `routeMcpSession` in
  `packages/cloudflare/src/mcp-session.ts`.

No manifest declares `agents` or a `@modelcontextprotocol/*` package. The
lockfile still resolves `@modelcontextprotocol/sdk@1.32.2` as an optional peer
of `@cloudflare/codemode`, which the Code Mode sandbox uses; Sketchi source
imports nothing from it.

That version must stay at 1.31.0 or later. `GHSA-6qxp-vccf-f47h` affects SDK
versions from 1.12.0 up to, but not including, 1.31.0. The vulnerability is in
the HTTP OAuth client: credentials can be sent to an authorization server
selected by an untrusted MCP server. The advisory excludes MCP servers, and
Sketchi constructs no SDK client.

No test pins the SDK version. The MCP server tests
(`apps/studio/src/features/mcp/tests/mcp.server.test.ts`,
`apps/icons/tests/mcp.test.ts`) list and call tools without credentials, and
the hand-run `pnpm sanity` initializes a deployed Studio's MCP endpoint and
calls `execute` without an Authorization header.

Reassess this before adding any outbound MCP client or OAuth flow.

Source: <https://github.com/advisories/GHSA-6qxp-vccf-f47h>
