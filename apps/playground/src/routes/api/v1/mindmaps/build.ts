import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/mindmaps/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ getStudioBindings }, { handleBuildMindmapRequest }] =
          await Promise.all([
            import("../../../../lib/cloudflare-bindings.server"),
            import("../../../../lib/codemode-api.server"),
          ]);
        return handleBuildMindmapRequest(getStudioBindings(), request);
      },
    },
  },
});
