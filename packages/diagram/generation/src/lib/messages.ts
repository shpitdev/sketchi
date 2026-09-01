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
  "When the scenario describes a retry, resubmission, return, or feedback loop, include a real back-edge from the loop path to the intended earlier process or decision; naming a loop or drawing a one-way list is insufficient.",
  "Loop-back edges must target a process or decision node, never the start node; start nodes have no incoming edges.",
  "Self-loop edges are forbidden. Model every retry or re-check as a decision whose retry branch routes back to an earlier distinct process or decision node.",
  'Minimal loop example: decision "Retry?" --"yes"--> process "Try again" --> decision "Retry?"; decision "Retry?" --"no"--> end.',
  "Honor every explicit count or minimum for nodes, steps, decisions, branches, ends, and loops; never return fewer. For a rich scenario without an explicit count, include the major actions and decisions rather than collapsing them into a short summary.",
  "Edges must use existing node ids.",
  'Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the prompt says otherwise.',
];

const MINDMAP_IR_INSTRUCTIONS = [
  "Return only compact, minified JSON on one line. Do not use markdown.",
  'Use type "mindmap".',
  "Return one nested root topic with label and children. Every child topic must also have label and children; use an empty children array for a leaf.",
  "Return the required top-level diagram id. Do not return flat nodes, edges, derived topic/node/edge ids, depth, sibling indexes, or parent references; Sketchi derives those deterministically from the hierarchy.",
  "Honor explicit depth and topic-count requirements. Unless the scenario is intentionally tiny, create 2-4 children per major topic and 2-3 levels of meaningful depth.",
  'Use layout { "direction": "LR", "edgeRouting": "curved" } unless the prompt says right-to-left.',
];

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
  if (prompt.type === "mindmap") {
    return JSON.stringify({
      id: "short-kebab-case-id",
      title: prompt.title,
      type: "mindmap",
      root: {
        label: "Root topic",
        children: [{ label: "Child topic", children: [] }],
      },
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
