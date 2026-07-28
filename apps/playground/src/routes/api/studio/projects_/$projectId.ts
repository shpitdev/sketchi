import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects_/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleGetStudioProjectRequest, runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleGetStudioProjectRequest(request, params.projectId),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
