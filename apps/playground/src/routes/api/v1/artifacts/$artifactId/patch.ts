import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId/patch")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const [{ getStudioBindings }, { handlePatchArtifactRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/codemode/codemode-api.server"),
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
