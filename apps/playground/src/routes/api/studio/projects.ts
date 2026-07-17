import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ getStudioBindings }, { handleListStudioProjectsRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/studio/projects.server"),
          ]);

        return handleListStudioProjectsRequest(getStudioBindings(), request);
      },
    },
  },
});
