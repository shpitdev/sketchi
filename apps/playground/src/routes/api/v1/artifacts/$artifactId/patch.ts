import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId/patch")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handlePatchArtifactRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/codemode/api.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handlePatchArtifactRequest(request, params.artifactId),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
