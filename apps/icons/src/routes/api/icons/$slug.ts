import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/icons/$slug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const [
          { handleIconDetailRequest, handleRawIconRequest },
          { getIconSourceLoader },
        ] = await Promise.all([
          import("../../../lib/icon-api.server.js"),
          import("../../../lib/icon-assets.server.js"),
        ]);
        const sourceLoader = getIconSourceLoader();
        if (params.slug.endsWith(".svg")) {
          return handleRawIconRequest(
            request,
            params.slug.slice(0, -4),
            sourceLoader,
          );
        }
        return handleIconDetailRequest(request, params.slug, sourceLoader);
      },
      HEAD: async ({ params, request }) => {
        const [
          { handleIconDetailHeadRequest, handleRawIconRequest },
          { getIconSourceLoader },
        ] = await Promise.all([
          import("../../../lib/icon-api.server.js"),
          import("../../../lib/icon-assets.server.js"),
        ]);
        return params.slug.endsWith(".svg")
          ? handleRawIconRequest(
              request,
              params.slug.slice(0, -4),
              getIconSourceLoader(),
              true,
            )
          : handleIconDetailHeadRequest();
      },
      OPTIONS: async () => {
        const { corsPreflight } = await import("../../../lib/cors-policy.js");
        return corsPreflight();
      },
    },
  },
});
