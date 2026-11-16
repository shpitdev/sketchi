import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const [
					{ getPlaygroundRequestBoundary },
					{ handleStudioAgentRequest },
					{ runPlaygroundEffect },
				] = await Promise.all([
					import("@/server/cloudflare-bindings.server"),
					import("@/features/chat/agent.server"),
					import("@/server/runtime.server"),
				]);
				const boundary = getPlaygroundRequestBoundary(request);
				return runPlaygroundEffect(handleStudioAgentRequest(request), boundary);
			},
		},
	},
});
