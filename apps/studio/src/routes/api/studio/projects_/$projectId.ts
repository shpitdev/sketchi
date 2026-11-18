import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects_/$projectId")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const [{ getStudioRequestBoundary }, { runStudioEffect }, { handleStudioProjectsRequest }] =
					await Promise.all([
						import("@/server/cloudflare-bindings.server"),
						import("@/server/runtime.server"),
						import("@/features/projects/host.server"),
					]);

				return runStudioEffect(
					handleStudioProjectsRequest(request),
					getStudioRequestBoundary(request),
				);
			},
		},
	},
});
