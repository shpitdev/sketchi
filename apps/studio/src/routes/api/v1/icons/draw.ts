import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/icons/draw")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [{ getStudioRequestBoundary }, { handleDrawIconRequest }, { runStudioEffect }] =
					await Promise.all([
						import("@/server/cloudflare-bindings.server"),
						import("@/features/icons/draw.server"),
						import("@/server/runtime.server"),
					]);

				return runStudioEffect(handleDrawIconRequest(request), getStudioRequestBoundary(request));
			},
		},
	},
});
