import {
  buildDiagramGenerationMessages,
  type DiagramGenerationMessage,
  type DiagramGenerationMessages,
  type DiagramGenerationPrompt,
  type DiagramGenerationRole,
} from "@sketchi/diagram-generation";

import type { DiagramScenario } from "./scenarios.js";

export type ScenarioPromptRole = DiagramGenerationRole;
export type ScenarioPromptMessage = DiagramGenerationMessage;
export type ScenarioPromptParts = DiagramGenerationMessages;

export function toDiagramGenerationPrompt(
  scenario: DiagramScenario,
): DiagramGenerationPrompt {
  return {
    id: scenario.id,
    request: scenario.prompt,
    requiredBranchLabels: scenario.assertions.requiredBranchLabels,
    requiredNodeLabels: scenario.assertions.requiredNodeLabels,
    title: scenario.title,
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
