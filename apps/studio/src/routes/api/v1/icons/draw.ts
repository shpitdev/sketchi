import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/icons/draw")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleDrawIconRequest },
					{ runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/cloudflare-bindings.server"),
					import("@/features/icons/draw.server"),
					import("@/server/runtime.server"),
				]);

				return runPlaygroundEffect(
					handleDrawIconRequest(request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
