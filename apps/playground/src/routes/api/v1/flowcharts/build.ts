import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/flowcharts/build")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ getStudioBindings }, { handleBuildFlowchartRequest }] =
          await Promise.all([
            import("../../../../lib/cloudflare-bindings.server"),
            import("../../../../lib/codemode-api.server"),
          ]);

        return handleBuildFlowchartRequest(getStudioBindings(), request);
      },
    },
  },
});
