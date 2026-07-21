import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleGenerateDiagramRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/generation/generation-api.server"),
          import("@/server/runtime/playground-runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleGenerateDiagramRequest(request),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
