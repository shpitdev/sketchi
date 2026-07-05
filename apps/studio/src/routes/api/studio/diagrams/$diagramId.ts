import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/diagrams/$diagramId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetStudioDiagramRequest }] =
          await Promise.all([
            import("../../../../lib/cloudflare-bindings.server"),
            import("../../../../lib/studio-projects.server"),
          ]);

        return handleGetStudioDiagramRequest(
          getStudioBindings(),
          request,
          params.diagramId,
        );
      },
    },
  },
});
