import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request): Promise<Response> {
  const [{ handleIconMcpRequest }, { getIconSourceLoader }] = await Promise.all(
    [
      import("../lib/icon-mcp.server.js"),
      import("../lib/icon-assets.server.js"),
    ],
  );
  return handleIconMcpRequest(request, getIconSourceLoader());
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      DELETE: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
      OPTIONS: async () => {
        const { corsPreflight } = await import("../lib/cors-policy.js");
        return corsPreflight();
      },
      POST: ({ request }) => handle(request),
    },
  },
});
