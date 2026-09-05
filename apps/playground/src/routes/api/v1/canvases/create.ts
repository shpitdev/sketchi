import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/canvases/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleCreateCanvasRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/codemode/api.server"),
          import("@/server/runtime/runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleCreateCanvasRequest(request),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
