import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleListStudioProjectsRequest, runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleListStudioProjectsRequest(request),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
