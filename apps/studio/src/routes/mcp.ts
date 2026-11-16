import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request): Promise<Response> {
	const [{ handleSketchiMcpRequest }, { env, waitUntil }] = await Promise.all([
		import("@/features/mcp/mcp.server"),
		import("cloudflare:workers"),
	]);
	return handleSketchiMcpRequest(request, env, waitUntil);
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
