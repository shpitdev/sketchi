import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/icons/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleIconSearchRequest } = await import(
          "../../../lib/icon-api.server.js"
        );
        return handleIconSearchRequest(request);
      },
      OPTIONS: async () => {
        const { corsPreflight } = await import("../../../lib/cors-policy.js");
        return corsPreflight();
      },
    },
  },
});
