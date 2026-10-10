import {
  buildDiagramGenerationMessages,
  type DiagramGenerationMessages,
  type DiagramGenerationPrompt,
} from "@sketchi/diagram-generation";

import type { DiagramScenario } from "./scenarios.js";
import type { GenerationReliabilityScenario } from "./generation-reliability.js";

type GenerationPromptScenario = DiagramScenario | GenerationReliabilityScenario;

export type ScenarioPromptParts = DiagramGenerationMessages;

export function toDiagramGenerationPrompt(
  scenario: GenerationPromptScenario,
): DiagramGenerationPrompt {
  const logos = "logos" in scenario ? scenario.logos : [];
  return {
    id: scenario.id,
    ...(logos.length > 0 ? { logos } : {}),
    request: scenario.prompt,
    requestedType: scenario.diagramType,
  };
}

export function buildScenarioPromptParts(
  scenario: DiagramScenario,
): ScenarioPromptParts {
  return buildDiagramGenerationMessages(toDiagramGenerationPrompt(scenario));
}

export function buildScenarioPrompt(scenario: DiagramScenario): string {
  const parts = buildScenarioPromptParts(scenario);

  return [
    "System message:",
    parts.system,
    "",
    "User message:",
    parts.user,
  ].join("\n");
}
