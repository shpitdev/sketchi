import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [{ getStudioBindings }, { handleGetArtifactRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/codemode/codemode-api.server"),
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
