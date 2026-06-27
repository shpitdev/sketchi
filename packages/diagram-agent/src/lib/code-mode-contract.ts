import { z } from "zod";

export const ArtifactFormatSchema = z.enum(["excalidraw", "scene", "png"]);
export const InlineArtifactFormatSchema = z.enum(["excalidraw", "scene"]);

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const CodeModeIssueCodeSchema = z.enum([
  "missing_field",
  "invalid_type",
  "invalid_enum",
  "invalid_color",
  "duplicate_node_id",
  "duplicate_edge_id",
  "missing_edge_source",
  "missing_edge_target",
  "self_loop",
  "missing_start",
  "multiple_starts",
  "missing_end",
  "start_has_incoming",
  "end_has_outgoing",
  "unreachable_node",
  "missing_outgoing_edge",
  "underbranched_decision",
  "unlabeled_decision_branch",
  "duplicate_decision_branch_label",
  "disconnected_graph",
  "generic_label",
  "label_too_long",
  "quality_below_threshold",
  "render_failed",
  "text_overflow",
  "arrow_binding_invalid",
  "arrow_overlap",
  "export_invalid_scene",
  "storage_read_failed",
  "storage_write_failed",
  "unsupported_artifact_format",
  "patch_source_unavailable",
  "unknown_patch_target",
  "unsupported_patch_operation",
  "patch_preserve_connectivity_failed",
  "patch_output_invalid",
]);

export const CodeModeIssueRefSchema = z.object({
  kind: z.enum(["request", "diagram", "node", "edge", "artifact"]),
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});

export const CodeModeIssueSchema = z.object({
  code: CodeModeIssueCodeSchema,
  severity: z.enum(["error", "warning"]),
  stage: z.enum([
    "input",
    "flowchart",
    "quality",
    "render",
    "export",
    "storage",
  ]),
  ref: CodeModeIssueRefSchema.optional(),
  message: z.string().min(1),
  hint: z.string().min(1),
});

export const FlowchartNodeKindSchema = z.enum([
  "start",
  "process",
  "decision",
  "end",
]);

export const DIAGRAM_PATCH_OPERATION_NAMES = [
  "setDefaultStyle",
  "setStyle",
  "setShape",
  "translate",
  "replaceText",
  "rerouteEdges",
] as const;

export const DiagramPatchOperationNameSchema = z.enum(
  DIAGRAM_PATCH_OPERATION_NAMES,
);

export const FlowchartSpecNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: FlowchartNodeKindSchema,
  description: z.string().min(1).optional(),
});

export const FlowchartSpecEdgeSchema = z.object({
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const FlowchartSpecLayoutSchema = z.object({
  direction: z.enum(["TB", "LR"]).default("TB"),
});

export const FlowchartSpecStyleSchema = z.object({
  accentColor: HexColorSchema.default("#000000"),
  backgroundColor: HexColorSchema.default("#ffffff"),
});

export const FlowchartSpecSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  nodes: z.array(FlowchartSpecNodeSchema).min(1),
  edges: z.array(FlowchartSpecEdgeSchema).default([]),
  layout: FlowchartSpecLayoutSchema.default({ direction: "TB" }),
  style: FlowchartSpecStyleSchema.default({
    accentColor: "#000000",
    backgroundColor: "#ffffff",
  }),
});

export const BuildFlowchartOptionsSchema = z
  .object({
    artifactFormats: z.array(ArtifactFormatSchema).min(1).optional(),
    inlineArtifacts: z.array(InlineArtifactFormatSchema).optional(),
    minQualityScore: z.number().min(0).max(10).optional(),
  })
  .optional();

export const BuildFlowchartRequestSchema = z.object({
  requestId: z.string().min(1).optional(),
  spec: FlowchartSpecSchema,
  options: BuildFlowchartOptionsSchema,
});

export const ScenePointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const NodeSceneElementSchema = z.object({
  type: z.literal("node"),
  id: z.string().min(1),
  nodeId: z.string().min(1),
  kind: z.string().min(1).optional(),
  shape: z.enum(["rectangle", "ellipse", "diamond", "circle"]),
  fillColor: HexColorSchema.optional(),
  strokeColor: HexColorSchema.optional(),
  textColor: HexColorSchema.optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().min(1),
});

export const TextSceneElementSchema = z.object({
  type: z.literal("text"),
  id: z.string().min(1),
  containerId: z.string().min(1).optional(),
  textColor: HexColorSchema.optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string().min(1),
  fontSize: z.number().positive(),
  maxWidth: z.number().positive().optional(),
});

export const ArrowSceneElementSchema = z.object({
  type: z.literal("arrow"),
  id: z.string().min(1),
  edgeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  strokeColor: HexColorSchema.optional(),
  textColor: HexColorSchema.optional(),
  points: z.array(ScenePointSchema).min(2),
  label: z.string().min(1).optional(),
});

export const SceneElementSchema = z.discriminatedUnion("type", [
  NodeSceneElementSchema,
  TextSceneElementSchema,
  ArrowSceneElementSchema,
]);

export const RenderedDiagramSceneSchema = z.object({
  diagramId: z.string().min(1),
  title: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  elements: z.array(SceneElementSchema),
});

export const ExcalidrawElementSchema = z.record(z.string(), z.unknown()).and(
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
  }),
);

export const ExcalidrawSceneSchema = z.object({
  appState: z.record(z.string(), z.unknown()),
  elements: z.array(ExcalidrawElementSchema),
});

export const ExcalidrawFileSchema = ExcalidrawSceneSchema.extend({
  files: z.record(z.string(), z.unknown()),
  source: z.string().min(1),
  type: z.literal("excalidraw"),
  version: z.literal(2),
});

export const GetArtifactRequestSchema = z.object({
  artifactId: z.string().min(1),
  format: ArtifactFormatSchema.optional(),
  inline: z.boolean().optional(),
});

export const DiagramSelectorSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  nodeIds: z.array(z.string().min(1)).optional(),
  edgeIds: z.array(z.string().min(1)).optional(),
  kinds: z.array(FlowchartNodeKindSchema).optional(),
  labels: z.array(z.string().min(1)).optional(),
  scope: z.enum(["all", "nodes", "edges"]).optional(),
});

export const DiagramStylePatchSchema = z.object({
  strokeColor: HexColorSchema.optional(),
  fillColor: HexColorSchema.optional(),
  textColor: HexColorSchema.optional(),
  backgroundColor: HexColorSchema.optional(),
});

export const DiagramShapeSchema = z.enum([
  "rectangle",
  "diamond",
  "ellipse",
  "circle",
]);

export const DiagramPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("setDefaultStyle"),
    style: DiagramStylePatchSchema,
  }),
  z.object({
    op: z.literal("setStyle"),
    selector: DiagramSelectorSchema,
    style: DiagramStylePatchSchema,
  }),
  z.object({
    op: z.literal("setShape"),
    selector: DiagramSelectorSchema,
    shape: DiagramShapeSchema,
  }),
  z.object({
    op: z.literal("translate"),
    selector: DiagramSelectorSchema,
    dx: z.number().finite(),
    dy: z.number().finite(),
  }),
  z.object({
    op: z.literal("replaceText"),
    selector: DiagramSelectorSchema,
    text: z.string().min(1),
  }),
  z.object({
    op: z.literal("rerouteEdges"),
    selector: DiagramSelectorSchema.optional(),
  }),
]);

export const DiagramPatchSourceSchema = z.union([
  z.object({
    artifactId: z.string().min(1),
    format: z.literal("scene").optional(),
  }),
  z.object({
    scene: RenderedDiagramSceneSchema,
  }),
]);

export const ApplyDiagramPatchOptionsSchema = z
  .object({
    artifactFormats: z.array(ArtifactFormatSchema).min(1).optional(),
    inlineArtifacts: z.array(InlineArtifactFormatSchema).optional(),
    preserveConnectivity: z.boolean().optional(),
  })
  .optional();

export const ApplyDiagramPatchRequestSchema = z.object({
  requestId: z.string().min(1).optional(),
  source: DiagramPatchSourceSchema,
  operations: z.array(DiagramPatchOperationSchema).min(1),
  options: ApplyDiagramPatchOptionsSchema,
  intent: z.string().min(1).optional(),
});

export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;
export type InlineArtifactFormat = z.infer<typeof InlineArtifactFormatSchema>;
export type CodeModeIssueCode = z.infer<typeof CodeModeIssueCodeSchema>;
export type CodeModeIssueRef = z.infer<typeof CodeModeIssueRefSchema>;
export type CodeModeIssue = z.infer<typeof CodeModeIssueSchema>;
export type FlowchartSpec = z.infer<typeof FlowchartSpecSchema>;
export type FlowchartSpecNode = z.infer<typeof FlowchartSpecNodeSchema>;
export type FlowchartSpecEdge = z.infer<typeof FlowchartSpecEdgeSchema>;
export type FlowchartSpecLayout = z.infer<typeof FlowchartSpecLayoutSchema>;
export type FlowchartSpecStyle = z.infer<typeof FlowchartSpecStyleSchema>;
export type BuildFlowchartOptions = z.infer<typeof BuildFlowchartOptionsSchema>;
export type BuildFlowchartRequest = z.infer<typeof BuildFlowchartRequestSchema>;
export type ExcalidrawFile = z.infer<typeof ExcalidrawFileSchema>;
export type GetArtifactRequest = z.infer<typeof GetArtifactRequestSchema>;
export type DiagramSelector = z.infer<typeof DiagramSelectorSchema>;
export type DiagramStylePatch = z.infer<typeof DiagramStylePatchSchema>;
export type DiagramShape = z.infer<typeof DiagramShapeSchema>;
export type DiagramPatchOperation = z.infer<typeof DiagramPatchOperationSchema>;
export type DiagramPatchSource = z.infer<typeof DiagramPatchSourceSchema>;
export type ApplyDiagramPatchOptions = z.infer<
  typeof ApplyDiagramPatchOptionsSchema
>;
export type ApplyDiagramPatchRequest = z.infer<
  typeof ApplyDiagramPatchRequestSchema
>;
export type PatchableScene = z.infer<typeof RenderedDiagramSceneSchema>;

export interface NormalizedFlowchartSpec {
  id: string;
  title: string;
  nodes: FlowchartSpecNode[];
  edges: Array<FlowchartSpecEdge & { id: string }>;
  layout: Required<FlowchartSpecLayout>;
  style: Required<FlowchartSpecStyle>;
}

export interface QualityCheck {
  code: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
  refs: CodeModeIssueRef[];
}

export interface QualityReport {
  accepted: boolean;
  score: number;
  threshold: number;
  summary: {
    nodeCount: number;
    edgeCount: number;
  };
  checks: QualityCheck[];
}

export interface ArtifactFormatRef {
  format: ArtifactFormat;
  mimeType: string;
  url?: string;
  expiresAt?: string;
  inline?: unknown;
  sizeBytes?: number;
}

export interface ArtifactBundle {
  artifactId: string;
  diagramId: string;
  formats: ArtifactFormatRef[];
  preview?: ArtifactFormatRef;
}

export interface PartialArtifactBundle {
  artifactId?: string;
  diagramId?: string;
  formats?: ArtifactFormatRef[];
}

export type BuildFlowchartResult =
  | {
      ok: true;
      status: "accepted";
      buildId: string;
      requestId?: string;
      normalizedSpec: NormalizedFlowchartSpec;
      quality: QualityReport;
      artifact: ArtifactBundle;
      issues: CodeModeIssue[];
    }
  | {
      ok: false;
      status:
        | "invalid_input"
        | "invalid_flowchart"
        | "quality_failed"
        | "render_failed"
        | "export_failed"
        | "storage_failed";
      buildId?: string;
      requestId?: string;
      normalizedSpec?: NormalizedFlowchartSpec;
      quality?: QualityReport;
      partial?: PartialArtifactBundle;
      issues: CodeModeIssue[];
    };

export type GetArtifactResult =
  | {
      ok: true;
      artifactId: string;
      diagramId: string;
      format: ArtifactFormat;
      mimeType: string;
      url?: string;
      expiresAt?: string;
      inline?: unknown;
      sizeBytes?: number;
    }
  | {
      ok: false;
      status:
        | "invalid_input"
        | "not_found"
        | "format_unavailable"
        | "expired"
        | "storage_failed";
      issues: CodeModeIssue[];
    };

export type ApplyDiagramPatchResult =
  | {
      ok: true;
      status: "accepted";
      patchId: string;
      requestId?: string;
      sourceArtifactId?: string;
      artifact: ArtifactBundle;
      issues: CodeModeIssue[];
    }
  | {
      ok: false;
      status:
        | "invalid_input"
        | "source_unavailable"
        | "target_not_found"
        | "unsupported_operation"
        | "connectivity_changed"
        | "render_failed"
        | "export_failed"
        | "storage_failed";
      patchId?: string;
      requestId?: string;
      sourceArtifactId?: string;
      partial?: PartialArtifactBundle;
      issues: CodeModeIssue[];
    };
