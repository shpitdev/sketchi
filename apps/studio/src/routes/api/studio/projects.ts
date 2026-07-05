import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ getStudioBindings }, { handleListStudioProjectsRequest }] =
          await Promise.all([
            import("../../../lib/cloudflare-bindings.server"),
            import("../../../lib/studio-projects.server"),
          ]);

        return handleListStudioProjectsRequest(getStudioBindings(), request);
      },
    },
  },
});
