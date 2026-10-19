import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/gantts/build")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleBuildGanttRequest },
					{ runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/codemode/api.server"),
					import("@/server/runtime/runtime.server"),
				]);

				return runPlaygroundEffect(
					handleBuildGanttRequest(request),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
