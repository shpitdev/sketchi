import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects/from-artifact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          {
            handleCreateStudioProjectFromArtifactRequest,
            runPlaygroundEffect,
          },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleCreateStudioProjectFromArtifactRequest(request),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
