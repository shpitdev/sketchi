import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/packs/$id/excalidraw")({
	server: {
		handlers: {
			POST: async ({ params, request }) => {
				const [{ handlePackPublish }, { env }] = await Promise.all([
					import("../../../../lib/excalidraw-publish.server.js"),
					import("cloudflare:workers"),
				]);
				return handlePackPublish(request, env, params.id);
			},
		},
	},
});
