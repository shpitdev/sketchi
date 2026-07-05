import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/playground/artifacts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getStudioBindings },
          { handleCreatePlaygroundArtifactRequest },
        ] = await Promise.all([
          import("../../../lib/cloudflare-bindings.server"),
          import("../../../lib/playground-artifacts.server"),
        ]);

        return handleCreatePlaygroundArtifactRequest(
          getStudioBindings(),
          request,
        );
      },
    },
  },
});
