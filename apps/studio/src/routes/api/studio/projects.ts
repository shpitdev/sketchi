import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ runPlaygroundEffect },
					{ handleStudioProjectsRequest },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/runtime/runtime.server"),
					import("@/server/studio/projects.server"),
				]);

				return runPlaygroundEffect(
					handleStudioProjectsRequest(request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
