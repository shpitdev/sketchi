import { Schema } from "effect";

export const DiagramGenerationRoleSchema = Schema.Literals(["system", "user"]);
export type DiagramGenerationRole = typeof DiagramGenerationRoleSchema.Type;

export const DiagramGenerationTypeSchema = Schema.Literals([
  "flowchart",
  "mindmap",
]);
export type DiagramGenerationType = typeof DiagramGenerationTypeSchema.Type;

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
  type: DiagramGenerationTypeSchema,
}) {}

export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
  "DiagramGenerationMessages",
)({
  messages: Schema.Tuple([DiagramGenerationMessage, DiagramGenerationMessage]),
  system: Schema.String,
  user: Schema.String,
}) {}

const FLOWCHART_IR_INSTRUCTIONS = [
  "Return only compact, minified JSON on one line. Do not use markdown.",
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

const MINDMAP_IR_INSTRUCTIONS = [
  "Return only compact, minified JSON on one line. Do not use markdown.",
  'Use type "mindmap".',
  'Every node must have id, label, kind ("root" or "topic"), and metadata with depth and siblingIndex.',
  "Use exactly one root node at depth 0 with siblingIndex 0.",
  "Every non-root node must have exactly one incoming edge from its immediate parent.",
  "Every edge must have id, source, target, and metadata matching the child depth and siblingIndex.",
  "Sibling indexes under each parent must be contiguous from 0.",
  "Edges must use existing node ids and the graph must be connected.",
  'Use layout { "direction": "LR", "edgeRouting": "curved" } unless the prompt says right-to-left.',
];

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
  if (prompt.type === "mindmap") {
    return JSON.stringify({
      id: "short-kebab-case-id",
      title: prompt.title,
      type: "mindmap",
      nodes: [
        {
          id: "topic-0",
          label: "Root topic",
          kind: "root",
          metadata: { depth: 0, siblingIndex: 0 },
        },
        {
          id: "topic-0-0",
          label: "Child topic",
          kind: "topic",
          metadata: { depth: 1, siblingIndex: 0 },
        },
      ],
      edges: [
        {
          id: "branch-0-0",
          source: "topic-0",
          target: "topic-0-0",
          metadata: { depth: 1, siblingIndex: 0 },
        },
      ],
      layout: { direction: "LR", edgeRouting: "curved" },
    });
  }

  return JSON.stringify({
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
  });
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
  const diagramName = prompt.type === "flowchart" ? "Flowchart" : "Mindmap";
  const instructions =
    prompt.type === "flowchart"
      ? FLOWCHART_IR_INSTRUCTIONS
      : MINDMAP_IR_INSTRUCTIONS;
  const system = [
    "You are creating a Sketchi typed intermediate diagram.",
    "",
    `${diagramName} IR rules:`,
    ...instructions.map((instruction) => `- ${instruction}`),
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
