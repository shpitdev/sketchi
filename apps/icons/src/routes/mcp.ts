import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request): Promise<Response> {
	const [{ handleIconMcpRequest }, { env, waitUntil }] = await Promise.all([
		import("../features/mcp/mcp.server"),
		import("cloudflare:workers"),
	]);
	return handleIconMcpRequest(request, env, waitUntil);
}

export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			DELETE: ({ request }) => handle(request),
			GET: ({ request }) => handle(request),
			OPTIONS: async () => {
				const { corsPreflight } = await import("../shared/cors");
				return corsPreflight();
			},
			POST: ({ request }) => handle(request),
		},
	},
});
