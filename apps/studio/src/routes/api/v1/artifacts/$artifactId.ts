import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetArtifactRequest }] =
          await Promise.all([
            import("../../../../lib/cloudflare-bindings.server"),
            import("../../../../lib/codemode-api.server"),
          ]);

        return handleGetArtifactRequest(
          getStudioBindings(),
          request,
          params.artifactId,
        );
      },
    },
  },
});
