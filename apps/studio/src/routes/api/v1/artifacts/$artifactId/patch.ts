import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId/patch")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const [{ getStudioBindings }, { handlePatchArtifactRequest }] =
          await Promise.all([
            import("../../../../../lib/cloudflare-bindings.server"),
            import("../../../../../lib/codemode-api.server"),
          ]);

        return handlePatchArtifactRequest(
          getStudioBindings(),
          request,
          params.artifactId,
        );
      },
    },
  },
});
