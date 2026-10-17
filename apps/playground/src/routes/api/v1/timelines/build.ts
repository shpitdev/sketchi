import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/timelines/build")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleBuildTimelineRequest },
					{ runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/codemode/api.server"),
					import("@/server/runtime/runtime.server"),
				]);

				return runPlaygroundEffect(
					handleBuildTimelineRequest(request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
