import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleStudioAgentRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/chat/agent.server"),
          import("@/server/runtime/runtime.server"),
        ]);
        const boundary = getPlaygroundRequestBoundary(request);
        return runPlaygroundEffect(handleStudioAgentRequest(request), boundary);
      },
    },
  },
});
