import {
  buildDiagramGenerationMessages,
  type DiagramGenerationMessage,
  type DiagramGenerationMessages,
  type DiagramGenerationPrompt,
  type DiagramGenerationRole,
} from "@sketchi/diagram-generation";

import type { DiagramScenario } from "./scenarios.js";
import type { GenerationReliabilityScenario } from "./generation-reliability.js";

type GenerationPromptScenario = DiagramScenario | GenerationReliabilityScenario;

export type ScenarioPromptRole = DiagramGenerationRole;
export type ScenarioPromptMessage = DiagramGenerationMessage;
export type ScenarioPromptParts = DiagramGenerationMessages;

export function toDiagramGenerationPrompt(
  scenario: GenerationPromptScenario,
): DiagramGenerationPrompt {
  const requiredBranchLabels =
    scenario.diagramType === "flowchart" &&
    "requiredBranchLabels" in scenario.assertions
      ? scenario.assertions.requiredBranchLabels
      : [];
  const requiredNodeLabels =
    scenario.diagramType === "flowchart" &&
    "requiredNodeLabels" in scenario.assertions
      ? scenario.assertions.requiredNodeLabels
      : [];
  return {
    id: scenario.id,
    request: scenario.prompt,
    requiredBranchLabels,
    requiredNodeLabels,
    title: scenario.title,
    type: scenario.diagramType,
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
