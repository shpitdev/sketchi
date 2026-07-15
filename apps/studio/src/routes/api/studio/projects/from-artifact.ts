import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/studio/projects/from-artifact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getStudioBindings },
          { handleCreateStudioProjectFromArtifactRequest },
        ] = await Promise.all([
          import("../../../../lib/cloudflare-bindings.server"),
          import("../../../../lib/studio-projects.server"),
        ]);

        return handleCreateStudioProjectFromArtifactRequest(
          getStudioBindings(),
          request,
        );
      },
    },
  },
});
