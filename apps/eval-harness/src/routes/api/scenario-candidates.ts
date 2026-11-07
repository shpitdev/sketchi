import { createFileRoute } from "@tanstack/react-router";

import {
	generateScenarioErrorPayload,
	runGenerateScenarioCandidatesForInput,
} from "../../lib/generate-scenario";

export const Route = createFileRoute("/api/scenario-candidates")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const { getEvalHarnessBindings, waitUntil } =
						await import("../../lib/cloudflare-bindings.server");

					return Response.json(
						await runGenerateScenarioCandidatesForInput(
							await request.json(),
							getEvalHarnessBindings(),
							{ request, signal: request.signal, waitUntil },
						),
					);
				} catch (error) {
					return Response.json(generateScenarioErrorPayload(error), {
						status: 400,
					});
				}
			},
		},
	},
});
