import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request): Promise<Response> {
	const [{ handleIconMcpRequest }, { env }] = await Promise.all([
		import("../lib/mcp.server.js"),
		import("cloudflare:workers"),
	]);
	return handleIconMcpRequest(request, env);
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
