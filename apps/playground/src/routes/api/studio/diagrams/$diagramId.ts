import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/diagrams/$diagramId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleGetStudioDiagramRequest, runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/runtime/playground-runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleGetStudioDiagramRequest(request, params.diagramId),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
