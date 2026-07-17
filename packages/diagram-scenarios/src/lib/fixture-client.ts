import {
  candidateFromText,
  timeGenerationCandidate,
  type DiagramGenerationClient,
  type DiagramGenerationRequest,
} from "@sketchi/diagram-generation";

import { getScenario } from "./scenarios.js";

export function createFixtureGenerationClient(): DiagramGenerationClient {
  return {
    provider: "fixture",
    generate: (request: DiagramGenerationRequest) =>
      timeGenerationCandidate(async () => {
        const scenario = getScenario(request.prompt.id);

        return candidateFromText({
          cacheMode: request.cacheMode ?? "default",
          model: "fixture",
          provider: "fixture",
          text: JSON.stringify(scenario.expectedDiagram, null, 2),
        });
      }),
  };
}
