# MCP SDK compatibility

Sketchi pins `agents@0.26.0` with `@modelcontextprotocol/sdk@1.32.1`.
Cloudflare declares an exact `1.30.0` SDK peer for this Agents release, so this
is a repository-owned compatibility exception rather than an upstream-supported
range.

Downgrading is not acceptable. `GHSA-6qxp-vccf-f47h` affects SDK versions from
1.12.0 up to, but not including, 1.31.0 and is patched in 1.31.0. The vulnerability is in the
HTTP OAuth client: credentials can be sent to an authorization server selected
by an untrusted MCP server. The advisory explicitly excludes MCP servers.

Sketchi's two deployed consumers are inbound, authless MCP servers:

- Icons constructs an SDK `Server`, registers read-only icon tools, and passes
  it to `createMcpHandler` from `agents/mcp`.
- Playground constructs an SDK `Server`, registers `docs`, `search`, and
  `execute`, and passes it to the same handler.
- Neither entry point constructs an SDK client, supplies an `authProvider`, or
  calls `withOAuth`, `auth`, or `fetchToken`.

The exception is bounded by `scripts/lib/mcp-sdk-compatibility.test.mjs`. That
test keeps the stale upstream peer visible, requires the patched SDK pin, and
fails if either deployed entry point gains OAuth-client reachability. The MCP
handler tests and preview protocol probe cover initialize, tool listing, and
read-only tool calls without an Authorization header.

Remove this exception when an eligible Agents release declares a patched SDK
range. Reassess it before adding any outbound MCP client or OAuth flow.

Sources:

- <https://github.com/advisories/GHSA-6qxp-vccf-f47h>
- <https://github.com/cloudflare/agents/blob/main/packages/agents/package.json>
