import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/diagrams/$diagramId/drawing")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleGetStudioDrawingRequest, runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/runtime/runtime.server"),
				]);

				return runPlaygroundEffect(
					handleGetStudioDrawingRequest(request, params.diagramId),
					getPlaygroundRequestBoundary(request),
				);
			},
			PUT: async ({ params, request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleSaveStudioDrawingRequest, runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/bindings/cloudflare-bindings.server"),
					import("@/server/runtime/runtime.server"),
				]);

				return runPlaygroundEffect(
					handleSaveStudioDrawingRequest(request, params.diagramId),
					getPlaygroundRequestBoundary(request),
				);
			},
		},
	},
});
