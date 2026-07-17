import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/diagrams/$diagramId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetStudioDiagramRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/studio/projects.server"),
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
