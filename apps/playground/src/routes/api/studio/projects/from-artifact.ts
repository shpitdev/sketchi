import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects/from-artifact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getStudioBindings },
          { handleCreateStudioProjectFromArtifactRequest },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/studio/projects.server"),
        ]);

        return handleCreateStudioProjectFromArtifactRequest(
          getStudioBindings(),
          request,
        );
      },
    },
  },
});
