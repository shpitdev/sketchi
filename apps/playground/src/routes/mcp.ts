import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request): Promise<Response> {
  const [{ getStudioBindings }, { handleSketchiMcpRequest }] =
    await Promise.all([
      import("@/server/bindings/cloudflare-bindings.server"),
      import("@/server/codemode/codemode-mcp.server"),
    ]);

  return handleSketchiMcpRequest(getStudioBindings(), request);
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      DELETE: ({ request }) => handle(request),
      GET: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
