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
					import("@/server/cloudflare-bindings.server"),
					import("@/server/runtime.server"),
					import("@/features/projects/host.server"),
				]);

				return runPlaygroundEffect(
					handleStudioProjectsRequest(request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
