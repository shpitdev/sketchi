import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/flowcharts/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [
          { getPlaygroundRequestBoundary },
          { handleBuildFlowchartRequest },
          { runPlaygroundEffect },
        ] = await Promise.all([
          import("@/server/bindings/cloudflare-bindings.server"),
          import("@/server/codemode/codemode-api.server"),
          import("@/server/runtime/playground-runtime.server"),
        ]);

        return runPlaygroundEffect(
          handleBuildFlowchartRequest(request),
          getPlaygroundRequestBoundary(request),
        );
      },
    },
  },
});
