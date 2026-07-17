import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/mindmaps/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ getStudioBindings }, { handleBuildMindmapRequest }] =
          await Promise.all([
            import("@/server/bindings/cloudflare-bindings.server"),
            import("@/server/codemode/codemode-api.server"),
          ]);
        return handleBuildMindmapRequest(getStudioBindings(), request);
      },
    },
  },
});
