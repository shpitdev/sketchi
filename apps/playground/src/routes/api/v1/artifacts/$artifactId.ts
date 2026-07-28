import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleGetArtifactRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/codemode/api.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleGetArtifactRequest(request, params.artifactId),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
