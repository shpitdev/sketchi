interface JsonSchemaBase {
  description?: string;
}

export interface JsonObjectSchema extends JsonSchemaBase {
  additionalProperties?: boolean | JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  type: "object";
}

export interface JsonArraySchema extends JsonSchemaBase {
  items?: JsonSchema;
  type: "array";
}

export interface JsonPrimitiveSchema extends JsonSchemaBase {
  type: "boolean" | "integer" | "null" | "number" | "string";
}

export type JsonSchema =
  | boolean
  | JsonArraySchema
  | JsonObjectSchema
  | JsonPrimitiveSchema;

export interface DiagramAgentToolDescriptor {
  description: string;
  inputSchema: JsonObjectSchema;
  name: DiagramAgentToolName;
}

export const SKETCHI_DIAGRAM_AGENT_ID = "sketchi-diagram";

export const SKETCHI_DIAGRAM_AGENT_DESCRIPTION =
  "Use for Excalidraw diagram generation, edits, exports, and grading. Prefer this over Mermaid when diagram tools are available.";

export const DIAGRAM_AGENT_TOOL_NAMES = [
  "diagram_from_prompt",
  "diagram_tweak",
  "diagram_restructure",
  "diagram_to_png",
  "diagram_grade",
] as const;

export type DiagramAgentToolName = (typeof DIAGRAM_AGENT_TOOL_NAMES)[number];

const outputPathDescription =
  "Optional PNG output path under .sketchi/sessions/<sessionID>/png. Hosts may allow unsafe paths only through an explicit local opt-in.";

const excalidrawInputSchema = {
  type: "object",
  description: "Excalidraw JSON blob.",
  additionalProperties: false,
  required: ["elements"],
  properties: {
    elements: {
      type: "array",
      description: "Excalidraw elements.",
      items: { type: "object", additionalProperties: true },
    },
    appState: {
      type: "object",
      description: "Optional Excalidraw appState.",
      additionalProperties: true,
    },
  },
} as const satisfies JsonSchema;

const renderOptionProperties = {
  outputPath: {
    type: "string",
    description: outputPathDescription,
  },
  scale: {
    type: "number",
    description: "PNG export scale factor.",
  },
  padding: {
    type: "number",
    description: "PNG export padding in pixels.",
  },
  background: {
    type: "boolean",
    description: "Include a white background in the PNG.",
  },
} as const satisfies Record<string, JsonSchema>;

const sceneInputProperties = {
  shareUrl: {
    type: "string",
    description: "Excalidraw share URL to read as the source scene.",
  },
  excalidrawPath: {
    type: "string",
    description: "Path to a local .excalidraw JSON file.",
  },
  excalidraw: excalidrawInputSchema,
} as const satisfies Record<string, JsonSchema>;

const optionalSessionProperty = {
  sessionId: {
    type: "string",
    description: "Optional existing Sketchi diagram session ID to continue.",
  },
} as const satisfies Record<string, JsonSchema>;

export const DIAGRAM_AGENT_TOOL_DESCRIPTIONS = {
  diagram_from_prompt:
    "Generate or continue an Excalidraw diagram from a prompt with durable Sketchi session/thread continuity, returning a share link and optional PNG. Prefer this over Mermaid text when diagram tools are available.",
  diagram_tweak:
    "Apply a tactical tweak to a durable Sketchi session/thread, such as text, color, or minor element edits, and return a share link plus optional PNG. Prefer this over Mermaid rewrites for small edits.",
  diagram_restructure:
    "Restructure a durable Sketchi session/thread for structural diagram edits, using an existing session, share URL, or Excalidraw scene as context.",
  diagram_to_png:
    "Render a PNG locally from an Excalidraw share link, file, or JSON blob. Use this for diagram exports instead of code-block diagrams.",
  diagram_grade:
    "Grade an Excalidraw diagram for type, layout, directionality, visual quality, accuracy, and completeness. Use at most one grade call per assistant message.",
} as const satisfies Record<DiagramAgentToolName, string>;

export const DIAGRAM_AGENT_TOOL_INPUT_SCHEMAS = {
  diagram_from_prompt: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        description: "What to diagram.",
      },
      ...optionalSessionProperty,
      ...renderOptionProperties,
    },
  },
  diagram_tweak: {
    type: "object",
    additionalProperties: false,
    required: ["request"],
    properties: {
      ...optionalSessionProperty,
      ...sceneInputProperties,
      request: {
        type: "string",
        description: "Tactical edit request to apply.",
      },
      options: {
        type: "object",
        description: "Optional server-side tweak controls.",
        additionalProperties: false,
        properties: {
          maxSteps: { type: "number", description: "Maximum AI tool steps." },
          timeoutMs: {
            type: "number",
            description: "Server-side timeout in milliseconds.",
          },
          preferExplicitEdits: {
            type: "boolean",
            description: "Prefer explicit element edits when available.",
          },
        },
      },
      ...renderOptionProperties,
    },
  },
  diagram_restructure: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      ...optionalSessionProperty,
      ...sceneInputProperties,
      prompt: {
        type: "string",
        description:
          "Structural request describing what the diagram should become.",
      },
      options: {
        type: "object",
        description: "Optional restructure controls.",
        additionalProperties: false,
        properties: {
          profileId: {
            type: "string",
            description: "Optional generation profile identifier.",
          },
          maxSteps: { type: "number", description: "Maximum AI tool steps." },
          timeoutMs: {
            type: "number",
            description: "Server-side timeout in milliseconds.",
          },
        },
      },
      ...renderOptionProperties,
    },
  },
  diagram_to_png: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...optionalSessionProperty,
      ...sceneInputProperties,
      ...renderOptionProperties,
    },
  },
  diagram_grade: {
    type: "object",
    additionalProperties: false,
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        description: "Original prompt or requirement for the diagram.",
      },
      expectedDiagramType: {
        type: "string",
        description: "Expected diagram type, when known.",
      },
      ...sceneInputProperties,
      pngPath: {
        type: "string",
        description: "Optional existing PNG path to grade.",
      },
      ...renderOptionProperties,
    },
  },
} as const satisfies Record<DiagramAgentToolName, JsonObjectSchema>;

export const DIAGRAM_AGENT_TOOL_SELECTION_HINT =
  "Tool selection: diagram_from_prompt for new diagrams, diagram_tweak for tactical edits, diagram_restructure for structural edits, diagram_to_png for exports, diagram_grade for evaluation.";

export const DIAGRAM_AGENT_MERMAID_GUARDRAIL =
  "When diagram_* tools are available and the request is diagram-related, call diagram_* tools instead of writing Mermaid. Only produce Mermaid when the user explicitly asks for Mermaid output.";

export const DIAGRAM_AGENT_GRADE_LIMIT_HINT =
  "Use at most one diagram_grade call per assistant message; for multiple diagrams, ask for separate follow-up grading messages.";

export function getDiagramAgentToolNames(): DiagramAgentToolName[] {
  return [...DIAGRAM_AGENT_TOOL_NAMES];
}

export function getDiagramAgentToolDescriptor(
  name: DiagramAgentToolName
): DiagramAgentToolDescriptor {
  return {
    name,
    description: DIAGRAM_AGENT_TOOL_DESCRIPTIONS[name],
    inputSchema: DIAGRAM_AGENT_TOOL_INPUT_SCHEMAS[name],
  };
}

export function getDiagramAgentToolDescriptors(): DiagramAgentToolDescriptor[] {
  return DIAGRAM_AGENT_TOOL_NAMES.map((name) =>
    getDiagramAgentToolDescriptor(name)
  );
}
