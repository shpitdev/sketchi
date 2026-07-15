import { createFileRoute } from "@tanstack/react-router";

import { generateScenarioCandidatesForInput } from "../../lib/generate-scenario";

export const Route = createFileRoute("/api/scenario-candidates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { getPlaygroundBindings } = await import(
            "../../lib/cloudflare-bindings.server"
          );

          return Response.json(
            await generateScenarioCandidatesForInput(
              await request.json(),
              getPlaygroundBindings(),
            ),
          );
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Scenario generation failed.",
            },
            { status: 400 },
          );
        }
      },
    },
  },
});
