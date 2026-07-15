import type {
  DiagramGenerationClient,
  DiagramGenerationRequest,
} from "./candidates.js";
import { candidateFromText, timeGenerationCandidate } from "./candidates.js";

export function createFixtureGenerationClient(): DiagramGenerationClient {
  return {
    provider: "fixture",
    generate: (request: DiagramGenerationRequest) =>
      timeGenerationCandidate(async () =>
        candidateFromText({
          cacheMode: request.cacheMode ?? "default",
          model: "fixture",
          provider: "fixture",
          text: JSON.stringify(request.scenario.expectedDiagram, null, 2),
        }),
      ),
  };
}
