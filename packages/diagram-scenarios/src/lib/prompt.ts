import type { DiagramScenario } from "./scenarios.js";

export type ScenarioPromptRole = "system" | "user";

export interface ScenarioPromptMessage {
  content: string;
  role: ScenarioPromptRole;
}

export interface ScenarioPromptParts {
  messages: readonly [ScenarioPromptMessage, ScenarioPromptMessage];
  system: string;
  user: string;
}

const FLOWCHART_IR_INSTRUCTIONS = [
  "Return only JSON. Do not wrap the JSON in markdown.",
  'Use type "flowchart".',
  'Every node must have id, label, and kind: "start", "process", "decision", or "end".',
  "Use exactly one start node and at least one end node.",
  "Every non-end node must have at least one outgoing edge.",
  "Every end node must have zero outgoing edges.",
  "Every decision node must have at least two outgoing edges.",
  "Every outgoing edge from a decision node must have a non-empty unique label.",
  "Edges must use existing node ids.",
  'Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the prompt says otherwise.',
];

function expectedJsonShape(scenario: DiagramScenario): string {
  return JSON.stringify(
    {
      id: "short-kebab-case-id",
      title: scenario.title,
      type: "flowchart",
      nodes: [
        { id: "start-id", label: "Human label", kind: "start" },
        { id: "decision-id", label: "Question?", kind: "decision" },
      ],
      edges: [
        {
          id: "edge-id",
          source: "decision-id",
          target: "target-id",
          label: "yes",
        },
      ],
      layout: { direction: "TB", edgeRouting: "orthogonal" },
      style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
    },
    null,
    2,
  );
}

function requiredList(title: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [];
  }

  return [title, ...values.map((value) => `- ${value}`), ""];
}

export function buildScenarioPromptParts(
  scenario: DiagramScenario,
): ScenarioPromptParts {
  const system = [
    "You are creating a Sketchi typed intermediate diagram.",
    "",
    "Flowchart IR rules:",
    ...FLOWCHART_IR_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
  ].join("\n");
  const user = [
    "Scenario:",
    scenario.prompt,
    "",
    ...requiredList(
      "Required node labels:",
      scenario.assertions.requiredNodeLabels,
    ),
    ...requiredList(
      "Required decision branch labels:",
      scenario.assertions.requiredBranchLabels,
    ),
    "Use these required labels exactly unless the scenario explicitly asks for a clearer synonym.",
    "",
    "Expected JSON shape:",
    expectedJsonShape(scenario),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    system,
    user,
  };
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
