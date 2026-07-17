import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects_/$projectId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetStudioProjectRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/studio/projects.server"),
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
