import {
  buildScenarioPromptParts,
  type DiagramScenario,
  type ScenarioPromptMessage,
} from "@sketchi/diagram-scenarios";

export type DiagramGenerationRole = ScenarioPromptMessage["role"];

export interface DiagramGenerationMessages {
  messages: readonly [ScenarioPromptMessage, ScenarioPromptMessage];
  system: string;
  user: string;
}

export function buildDiagramGenerationMessages(
  scenario: DiagramScenario,
): DiagramGenerationMessages {
  return buildScenarioPromptParts(scenario);
}
