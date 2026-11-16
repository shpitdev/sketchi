import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/packs/$id/excalidraw")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [{ handlePackPublish }, { env }] = await Promise.all([
					import("../../../../features/packs/publication.server"),
					import("cloudflare:workers"),
				]);
				return handlePackPublish(request, env);
			},
		},
	},
});
