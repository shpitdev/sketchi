import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import type {
  DiagramGenerationCacheMode,
  DiagramGenerationProviderId,
} from "@sketchi/diagram-generation";
import { ScenarioPlayground } from "@sketchi/diagram-studio-ui";
import "@sketchi/diagram-studio-ui/styles.css";

import { generateScenarioCandidates } from "../lib/generate-scenario";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  const generationMutation = useMutation({
    mutationFn: (input: {
      cacheMode: DiagramGenerationCacheMode;
      providers: DiagramGenerationProviderId[];
      scenarioId: string;
    }) => generateScenarioCandidates({ data: input }),
  });

  return (
    <ScenarioPlayground
      onGenerateScenario={(request) =>
        generationMutation.mutateAsync({
          cacheMode: request.cacheMode,
          providers: [...request.providers],
          scenarioId: request.scenarioId,
        })
      }
    />
  );
}
