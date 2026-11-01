# MCP SDK compatibility

Sketchi pins `agents@0.32.0` with the MCP packages its peers ask for:
`@modelcontextprotocol/sdk@1.32.2`, `@modelcontextprotocol/client@2.4.0` and
`@modelcontextprotocol/server@2.4.0`. `agents/mcp` imports all three, so the
root manifest declares them instead of relying on optional peers being
installed.

The SDK must stay at 1.31.0 or later. `GHSA-6qxp-vccf-f47h` affects SDK versions
from 1.12.0 up to, but not including, 1.31.0. The vulnerability is in the HTTP
OAuth client: credentials can be sent to an authorization server selected by an
untrusted MCP server. The advisory excludes MCP servers.

Sketchi's two deployed consumers are inbound, authless MCP servers:

- Icons constructs an SDK v1 `Server`, registers read-only icon tools, and
  passes it to `createLegacyMcpHandler` from `agents/mcp`.
- Playground constructs an SDK v1 `Server`, registers `docs`, `search`, and
  `execute`, and passes it to the same handler.
- Neither entry point constructs an SDK client, supplies an `authProvider`, or
  calls `withOAuth`, `auth`, or `fetchToken`.

`createLegacyMcpHandler` keeps the sessionful SDK v1 behavior these servers
have always had. Agents 0.32 still accepts a v1 server in `createMcpHandler`,
but deprecates that overload and warns on every request. Moving to the
stateless `agents/mcp/server` handler needs an SDK v2 server factory, which is
a separate protocol migration.

`scripts/lib/mcp-sdk-compatibility.test.mjs` checks that the declared MCP
versions match the Agents peers, that the SDK stays patched, and that neither
entry point gains OAuth-client reachability. The MCP handler tests and the
preview protocol probe cover initialize, tool listing, and read-only tool calls
without an Authorization header.

Reassess this before adding any outbound MCP client or OAuth flow.

Sources:

- <https://github.com/advisories/GHSA-6qxp-vccf-f47h>
- <https://github.com/cloudflare/agents/blob/main/packages/agents/package.json>
