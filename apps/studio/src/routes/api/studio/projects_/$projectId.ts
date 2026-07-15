import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects_/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetStudioProjectRequest }] =
          await Promise.all([
            import("../../../../lib/cloudflare-bindings.server"),
            import("../../../../lib/studio-projects.server"),
          ]);

        return handleGetStudioProjectRequest(
          getStudioBindings(),
          request,
          params.projectId,
        );
      },
    },
  },
});
