import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import type { DiagramGenerationProviderId } from "@sketchi/diagram-generation";
import { ScenarioPlayground } from "@sketchi/diagram-ui";
import "@sketchi/diagram-ui/styles.css";

import { generateScenarioCandidates } from "../lib/generate-scenario";

export const Route = createFileRoute("/")({
	component: HomeRoute,
});

function HomeRoute() {
	const generationMutation = useMutation({
		mutationFn: (input: { providers: DiagramGenerationProviderId[]; scenarioId: string }) =>
			generateScenarioCandidates({ data: input }),
	});

	return (
		<ScenarioPlayground
			onGenerateScenario={(request) =>
				generationMutation.mutateAsync({
					providers: [...request.providers],
					scenarioId: request.scenarioId,
				})
			}
		/>
	);
}
