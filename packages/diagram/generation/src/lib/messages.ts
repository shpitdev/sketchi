import { Schema } from "effect";

export const DiagramGenerationRoleSchema = Schema.Literals(["system", "user"]);
export type DiagramGenerationRole = typeof DiagramGenerationRoleSchema.Type;

export const DiagramGenerationTypeSchema = Schema.Literals([
  "flowchart",
  "mindmap",
  "sequence",
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
  requestedType: Schema.optionalKey(DiagramGenerationTypeSchema),
}) {}

export class DiagramGenerationMessages extends Schema.Class<DiagramGenerationMessages>(
  "DiagramGenerationMessages",
)({
  messages: Schema.Tuple([DiagramGenerationMessage, DiagramGenerationMessage]),
  system: Schema.String,
  user: Schema.String,
}) {}

const COMMON_INSTRUCTIONS = [
  "Return only compact, minified JSON on one line. Do not use markdown.",
  "Author one concise title of at most 60 characters. Do not copy the whole scenario into the title.",
  'Set intent.requestedKind to the diagram kind the scenario actually requests: "flowchart", "mindmap", "sequence", "er", "architecture", "swimlane", or "state-machine".',
  'Sketchi supports only nativeKind "flowchart", "mindmap", or "sequence". If the requested kind is er, architecture, swimlane, or state-machine, set nativeKind to null, omit diagram, and never coerce it into a supported kind.',
  "When nativeKind is null, return an empty requirements array because there is no native artifact to validate.",
  "List every measurable scenario requirement once in intent.requirements. Convert counts and minimums into count requirements, hierarchy depth into topic_levels, and required names or branch/message text into label requirements.",
  'Count requirement target must be exactly one of "nodes", "decision_nodes", "terminal_nodes", "topics", "participants", "messages", or "cycles". Use "cycles" for loops and retry cycles; never invent another target name.',
  'Depth requirement target must be exactly "topic_levels". Label requirement target must be exactly one of "node", "branch", "topic", "participant", or "message".',
  'Use comparator "minimum" for phrases such as "at least" and "exact" for exact counts. Do not invent measurable requirements that the scenario did not request.',
  "The diagram must satisfy every requirement in the plan. Sketchi deterministically checks the plan against the artifact.",
];

const FLOWCHART_IR_INSTRUCTIONS = [
  'Use diagram type "flowchart".',
  'Every node must have id, label, and kind: "start", "process", "decision", or "end".',
  "Use exactly one start node and at least one end node.",
  "Every non-end node must have at least one outgoing edge; every end node must have zero outgoing edges.",
  "Every decision node must have at least two outgoing edges with non-empty unique labels.",
  "For each retry, return, or feedback loop, include a real back-edge to an earlier distinct process or decision. Never target start and never use a self-loop.",
  "Edges must use existing node ids.",
  'Use layout { "direction": "TB", "edgeRouting": "orthogonal" } unless the scenario says otherwise.',
];

const MINDMAP_IR_INSTRUCTIONS = [
  'Use diagram type "mindmap".',
  "Return one nested root topic with label and children. Every child also has label and children; use an empty children array for a leaf.",
  "Return the diagram id. Do not return flat nodes, edges, derived ids, depth, sibling indexes, or parent references; Sketchi derives them deterministically.",
  "Unless the scenario is intentionally tiny, create 2-4 children per major topic and 2-3 meaningful levels.",
  'Use layout { "direction": "LR", "edgeRouting": "curved" } unless the scenario says right-to-left.',
];

const SEQUENCE_IR_INSTRUCTIONS = [
  'Use diagram type "sequence".',
  "Return ordered participants with stable ids and human labels.",
  "Return chronological messages with stable ids, participant source and target ids, and concise labels.",
  'Use message type "message" for calls and "return" for responses; dashed style is appropriate for responses.',
  "Every message source and target must reference a participant, and self-messages are not supported.",
];

function expectedJsonShape(prompt: DiagramGenerationPrompt): string {
  const selectedType = prompt.requestedType;
  if (!selectedType) {
    const supportedExample = {
      title: "Release approval",
      intent: {
        requestedKind: "flowchart",
        nativeKind: "flowchart",
        requirements: [
          {
            kind: "count",
            target: "nodes",
            comparator: "minimum",
            value: 4,
          },
          { kind: "label", target: "branch", value: "revise" },
        ],
      },
      diagram: {
        id: "release-approval",
        type: "flowchart",
        nodes: [
          { id: "start", label: "Start", kind: "start" },
          { id: "draft", label: "Prepare release", kind: "process" },
          { id: "review", label: "Approved?", kind: "decision" },
          { id: "end", label: "Release approved", kind: "end" },
        ],
        edges: [
          { id: "begin", source: "start", target: "draft" },
          { id: "submit", source: "draft", target: "review" },
          {
            id: "approve",
            source: "review",
            target: "end",
            label: "approve",
          },
          {
            id: "revise",
            source: "review",
            target: "draft",
            label: "revise",
          },
        ],
        layout: { direction: "TB", edgeRouting: "orthogonal" },
      },
    };
    const unsupportedExample = {
      title: "Customer order relationships",
      intent: {
        requestedKind: "er",
        nativeKind: null,
        requirements: [],
      },
    };
    return [
      `Supported response example: ${JSON.stringify(supportedExample)}`,
      `Unsupported response example: ${JSON.stringify(unsupportedExample)}`,
    ].join("\n");
  }
  const diagram =
    selectedType === "mindmap"
      ? {
          id: "short-kebab-case-id",
          type: "mindmap",
          root: {
            label: "Root topic",
            children: [{ label: "Child topic", children: [] }],
          },
          layout: { direction: "LR", edgeRouting: "curved" },
        }
      : selectedType === "sequence"
        ? {
            id: "short-kebab-case-id",
            type: "sequence",
            participants: [
              { id: "client", label: "Client" },
              { id: "service", label: "Service" },
            ],
            messages: [
              {
                id: "request",
                source: "client",
                target: "service",
                label: "Request",
                type: "message",
              },
            ],
          }
        : {
            id: "short-kebab-case-id",
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
          };
  const requirements =
    selectedType === "mindmap"
      ? [
          {
            kind: "count",
            target: "topics",
            comparator: "minimum",
            value: 8,
          },
          { kind: "label", target: "topic", value: "Operations" },
        ]
      : selectedType === "sequence"
        ? [
            {
              kind: "count",
              target: "messages",
              comparator: "minimum",
              value: 4,
            },
            { kind: "label", target: "participant", value: "Service" },
          ]
        : [
            {
              kind: "count",
              target: "nodes",
              comparator: "minimum",
              value: 8,
            },
            { kind: "label", target: "branch", value: "retry" },
          ];

  return JSON.stringify({
    title: "Concise model-authored title",
    intent: {
      requestedKind: selectedType,
      nativeKind: selectedType,
      requirements,
    },
    diagram,
  });
}

export function buildDiagramGenerationMessages(
  prompt: DiagramGenerationPrompt,
): DiagramGenerationMessages {
  const explicitType = prompt.requestedType;
  const system = [
    "You are creating one typed Sketchi generation response.",
    "",
    "Response contract:",
    ...COMMON_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
    "",
    "Flowchart IR rules:",
    ...FLOWCHART_IR_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
    "",
    "Mindmap IR rules:",
    ...MINDMAP_IR_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
    "",
    "Sequence IR rules:",
    ...SEQUENCE_IR_INSTRUCTIONS.map((instruction) => `- ${instruction}`),
  ].join("\n");
  const typeAuthority = explicitType
    ? `The caller explicitly requires ${explicitType}. Set both intent.requestedKind and intent.nativeKind to ${explicitType}, and return that diagram type.`
    : "The caller omitted type. Select the scenario's requested kind; generate it only when it is natively supported.";
  const user = [
    "Scenario:",
    prompt.request,
    "",
    "Type authority:",
    typeAuthority,
    "",
    "Expected JSON shape (adapt the intent plan and diagram to the scenario):",
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
