import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [{ getStudioRequestBoundary }, { handleStudioAgentRequest }, { runStudioEffect }] =
					await Promise.all([
						import("@/server/cloudflare-bindings.server"),
						import("@/features/chat/agent.server"),
						import("@/server/runtime.server"),
					]);
				const boundary = getStudioRequestBoundary(request);
				return runStudioEffect(handleStudioAgentRequest(request), boundary);
			},
		},
	},
});
