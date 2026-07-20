import { Schema } from "effect";

export const DiagramGenerationRoleSchema = Schema.Literals(["system", "user"]);
export type DiagramGenerationRole = typeof DiagramGenerationRoleSchema.Type;

export class DiagramGenerationMessage extends Schema.Class<DiagramGenerationMessage>(
  "DiagramGenerationMessage",
)({
  content: Schema.String,
  role: DiagramGenerationRoleSchema,
}) {}

export class DiagramGenerationPrompt extends Schema.Class<DiagramGenerationPrompt>(
  "DiagramGenerationPrompt",
)({
  id: Schema.String,
  request: Schema.String,
  requiredBranchLabels: Schema.Array(Schema.String),
  requiredNodeLabels: Schema.Array(Schema.String),
  title: Schema.String,
}) {}

export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
  "DiagramGenerationMessages",
)({
  messages: Schema.Tuple([DiagramGenerationMessage, DiagramGenerationMessage]),
  system: Schema.String,
  user: Schema.String,
}) {}

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

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
  return JSON.stringify(
    {
      id: "short-kebab-case-id",
      title: prompt.title,
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

export function buildDiagramGenerationMessages(
  prompt: DiagramGenerationPrompt,
): DiagramGenerationMessages {
  const system = [
    "You are creating a Sketchi typed intermediate diagram.",
    "",
    "Flowchart IR rules:",
    ...FLOWCHART_IR_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
  ].join("\n");
  const user = [
    "Scenario:",
    prompt.request,
    "",
    ...requiredList("Required node labels:", prompt.requiredNodeLabels),
    ...requiredList(
      "Required decision branch labels:",
      prompt.requiredBranchLabels,
    ),
    "Use these required labels exactly unless the scenario explicitly asks for a clearer synonym.",
    "",
    "Expected JSON shape:",
    expectedJsonShape(prompt),
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
