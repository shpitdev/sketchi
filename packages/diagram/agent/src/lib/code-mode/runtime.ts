import {
  CANVAS_LIMITS,
  FLOWCHART_MAX_ISSUES,
  FlowchartDiagramSchema,
  SKETCHI_DIAGRAM_STYLE,
  compileCanvasSpec,
  getCanvasValidationIssues,
  getFlowchartValidationIssues,
  parseMindmapDiagram,
  validateFlowchartDiagram,
  type FlowchartDiagram,
  type FlowchartValidationIssueRef,
  type MindmapDiagram,
  type CanvasValidationIssue,
} from "@sketchi/diagram-core";
import {
  convertSceneToExcalidraw,
  createExcalidrawFile,
  type ExcalidrawScene,
  validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import {
  renderIntermediateDiagram,
  renderSequenceDiagram,
  isStructurallyValidSequenceLifeline,
  sequenceLifelineId,
  type RenderedDiagramScene,
  type ScenePoint,
} from "@sketchi/diagram-renderer";
import {
  recordMetric,
  withTelemetryCorrelation,
  type TelemetryCorrelationInput,
} from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Metric, Result, Schema } from "effect";

import {
  ARTIFACT_MIME_TYPES,
  CodeModeArtifactStorage,
  isInlineArtifactFormat,
  jsonSizeBytes,
  storageIssue,
  type CodeModeArtifactStorageError,
  type StoredArtifactFormat,
} from "./artifacts.js";
import {
  formatContractSchemaError,
  BuildFlowchartRejected,
  BuildMindmapRejected,
  BuildSequenceDiagramRejected,
  CreateCanvasRejected,
  GetArtifactRejected,
  ApplyDiagramPatchRejected,
  ApplyDiagramPatchRequestSchema,
  BuildFlowchartRequestSchema,
  BuildMindmapRequestSchema,
  BuildSequenceDiagramRequestSchema,
  CreateCanvasRequestSchema,
  DEFAULT_ICON_SEARCH_LIMIT,
  SearchIconsRejected,
  SearchIconsRequestSchema,
  type SearchIconsResult,
  DIAGRAM_PATCH_OPERATION_NAMES,
  GetArtifactRequestSchema,
  RenderedDiagramSceneSchema,
  type ApplyDiagramPatchRequest,
  type ApplyDiagramPatchResult,
  type ArtifactBundle,
  type ArtifactFormat,
  type BuildFlowchartRequest,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type BuildSequenceDiagramRequest,
  type BuildSequenceDiagramResult,
  type CreateCanvasResult,
  CodeModeIssueSchema,
  type ContractSchemaIssue,
  type CodeModeIssue,
  type CodeModeIssueCode,
  type CodeModeIssueRef,
  type ContractSchemaError,
  type DiagramPatchOperation,
  type DiagramSelector,
  type GetArtifactResult,
  type InlineArtifactFormat,
  type MindmapSpec,
  type NormalizedFlowchartSpec,
  type NormalizedMindmapSpec,
  type NormalizedSequenceDiagramSpec,
  type PartialArtifactBundle,
  type PatchableScene,
  type QualityReport,
} from "./contract.js";
import {
  embedSceneIcons,
  resolveNodeIcons,
  type CodeModeIconCatalog,
} from "./icons.js";
import { cleanToolString } from "../clean-tool-string.js";
import { assessFlowchartQuality } from "../flowchart/quality.js";
import {
  flowchartDiagramInput,
  normalizeFlowchartSpec,
} from "../flowchart/spec.js";

const DEFAULT_BUILD_FORMATS: ArtifactFormat[] = ["excalidraw", "scene"];
const DEFAULT_INLINE_FORMATS: InlineArtifactFormat[] = ["scene"];
const DEFAULT_MIN_QUALITY_SCORE = 8;
const SCENE_PADDING = 48;
const MAX_MINDMAP_DEPTH = 8;
const MAX_MINDMAP_TOPICS = 100;
const MAX_INPUT_ISSUES = 20;

const codeModeRequests = Metric.counter("sketchi_codemode_requests", {
  description: "Code Mode boundary requests by terminal outcome",
  incremental: true,
});
const codeModeFailures = Metric.counter("sketchi_codemode_failures", {
  description: "Code Mode boundary failures by typed status",
  incremental: true,
});
const codeModeArtifacts = Metric.counter("sketchi_codemode_artifacts", {
  description: "Code Mode artifacts accepted at workflow boundaries",
  incremental: true,
});
const codeModeDuration = Metric.histogram("sketchi_codemode_duration_ms", {
  description: "Code Mode boundary duration in milliseconds",
  boundaries: Metric.boundariesFromIterable([
    1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
  ]),
});

export interface CodeModeRuntimeOptions {
  createId?: (prefix: string) => string;
  /** Node-logo catalog; without one, every node icon is dropped with a warning. */
  icons?: CodeModeIconCatalog;
  renderer?: CodeModeArtifactRenderer;
  artifactUrl?: (input: {
    artifactId: string;
    format: ArtifactFormat;
  }) => string;
}

export class CodeModeRuntimeEnvironment extends Context.Service<
  CodeModeRuntimeEnvironment,
  Required<Pick<CodeModeRuntimeOptions, "createId">> &
    Pick<CodeModeRuntimeOptions, "artifactUrl" | "icons" | "renderer">
>()("@sketchi/diagram-agent/CodeModeRuntimeEnvironment") {}

export const CodeModeRuntimeEnvironmentLive = Layer.succeed(
  CodeModeRuntimeEnvironment,
  { createId: defaultCreateId },
);

export function makeCodeModeRuntimeEnvironmentLayer(
  options: CodeModeRuntimeOptions = {},
) {
  return Layer.succeed(CodeModeRuntimeEnvironment, {
    createId: options.createId ?? defaultCreateId,
    ...(options.icons ? { icons: options.icons } : {}),
    ...(options.renderer ? { renderer: options.renderer } : {}),
    ...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
  });
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

type CodeModeBoundaryOperation =
  | "applyDiagramPatch"
  | "buildFlowchart"
  | "buildMindmap"
  | "buildSequenceDiagram"
  | "createCanvas"
  | "getArtifact"
  | "searchIcons";

interface ObservableCodeModeResult {
  readonly ok: boolean;
  readonly status?: string;
}

function codeModeCorrelation(input: unknown): TelemetryCorrelationInput {
  const record = unknownRecord(input);
  const source = unknownRecord(record?.["source"]);
  const artifactId =
    typeof record?.["artifactId"] === "string"
      ? record["artifactId"]
      : typeof source?.["artifactId"] === "string"
        ? source["artifactId"]
        : undefined;
  const requestId =
    typeof record?.["requestId"] === "string" ? record["requestId"] : undefined;
  return {
    ...(artifactId ? { artifactId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function artifactKindForOperation(
  operation: CodeModeBoundaryOperation,
): string | undefined {
  if (operation === "buildFlowchart") return "flowchart";
  if (operation === "buildMindmap") return "mindmap";
  if (operation === "buildSequenceDiagram") return "sequence";
  if (operation === "createCanvas") return "canvas";
  if (operation === "applyDiagramPatch") return "patch";
  return undefined;
}

function observeCodeModeBoundary<A extends ObservableCodeModeResult, R>(
  operation: CodeModeBoundaryOperation,
  input: unknown,
  effect: Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R> {
  const observed = Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const result = yield* effect;
    const finishedAt = yield* Clock.currentTimeMillis;
    const outcome = result.ok ? "success" : "failure";
    const failureCategory = result.ok
      ? undefined
      : (result.status ?? "unknown_failure");
    yield* recordMetric(codeModeRequests, 1, {
      ...(failureCategory ? { failureCategory } : {}),
      operation,
      outcome,
      surface: "code_mode",
    });
    yield* recordMetric(codeModeDuration, finishedAt - startedAt, {
      ...(failureCategory ? { failureCategory } : {}),
      operation,
      outcome,
      surface: "code_mode",
    });
    if (failureCategory) {
      yield* recordMetric(codeModeFailures, 1, {
        failureCategory,
        operation,
        surface: "code_mode",
      });
    }
    const artifactKind = artifactKindForOperation(operation);
    if (result.ok && artifactKind) {
      yield* recordMetric(codeModeArtifacts, 1, {
        artifactKind,
        operation,
        surface: "code_mode",
      });
    }
    return result;
  });
  return withTelemetryCorrelation(observed, codeModeCorrelation(input));
}

function preflightMindmapInput(input: unknown): CodeModeIssue[] {
  const root = unknownRecord(
    unknownRecord(unknownRecord(input)?.["spec"])?.["root"],
  );
  if (!root) return [];

  const stack: Array<{ depth: number; topic: Record<string, unknown> }> = [
    { depth: 0, topic: root },
  ];
  let discoveredSlots = 1;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.depth > MAX_MINDMAP_DEPTH) {
      return [
        issue({
          code: "mindmap_too_deep",
          stage: "mindmap",
          ref: { kind: "request", path: "spec.root.children" },
          message: `Mindmap depth exceeds the supported maximum of ${MAX_MINDMAP_DEPTH}.`,
          hint: "Combine overly deep topics into a shallower hierarchy.",
        }),
      ];
    }
    const children = current.topic["children"];
    if (!Array.isArray(children)) continue;
    discoveredSlots += children.length;
    if (discoveredSlots > MAX_MINDMAP_TOPICS) {
      return [
        issue({
          code: "mindmap_too_large",
          stage: "mindmap",
          ref: { kind: "request", path: "spec.root" },
          message: `Mindmap exceeds the supported maximum of ${MAX_MINDMAP_TOPICS} topic slots.`,
          hint: "Split this hierarchy into smaller focused mindmaps.",
        }),
      ];
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = unknownRecord(children[index]);
      if (child) stack.push({ depth: current.depth + 1, topic: child });
    }
  }
  return [];
}

function normalizeMindmapSpec(spec: MindmapSpec): NormalizedMindmapSpec {
  const normalizeTopic = (
    topic: MindmapSpec["root"],
    path: readonly number[],
  ): NormalizedMindmapSpec["root"] => ({
    id: `topic-${path.join("-")}`,
    label: cleanToolString(topic.label),
    children: (topic.children ?? []).map((child, index) =>
      normalizeTopic(child, [...path, index]),
    ),
  });
  const title = cleanToolString(spec.title);
  return {
    id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-mindmap"),
    title,
    root: normalizeTopic(spec.root, [0]),
    layout: { direction: spec.layout.direction },
    style: { ...SKETCHI_DIAGRAM_STYLE },
  };
}

function mindmapStats(spec: NormalizedMindmapSpec): {
  count: number;
  depth: number;
} {
  let count = 0;
  let depth = 0;
  const visit = (
    topic: NormalizedMindmapSpec["root"],
    currentDepth: number,
  ) => {
    count += 1;
    depth = Math.max(depth, currentDepth);
    topic.children.forEach((child) => visit(child, currentDepth + 1));
  };
  visit(spec.root, 0);
  return { count, depth };
}

function validateNormalizedMindmap(
  spec: NormalizedMindmapSpec,
): CodeModeIssue[] {
  const stats = mindmapStats(spec);
  const issues: CodeModeIssue[] = [];
  if (stats.count < 2) {
    issues.push(
      issue({
        code: "disconnected_graph",
        stage: "mindmap",
        ref: { kind: "diagram", id: spec.id },
        message: "Mindmap root must contain at least one child topic.",
        hint: "Add one or more nested topics under spec.root.children.",
      }),
    );
  }
  if (stats.depth > MAX_MINDMAP_DEPTH) {
    issues.push(
      issue({
        code: "mindmap_too_deep",
        stage: "mindmap",
        ref: { kind: "diagram", id: spec.id },
        message: `Mindmap depth ${stats.depth} exceeds the supported maximum of ${MAX_MINDMAP_DEPTH}.`,
        hint: "Combine overly deep topics into a shallower hierarchy.",
      }),
    );
  }
  if (stats.count > MAX_MINDMAP_TOPICS) {
    issues.push(
      issue({
        code: "mindmap_too_large",
        stage: "mindmap",
        ref: { kind: "diagram", id: spec.id },
        message: `Mindmap has ${stats.count} topics; the supported maximum is ${MAX_MINDMAP_TOPICS}.`,
        hint: "Split this hierarchy into smaller focused mindmaps.",
      }),
    );
  }
  return issues;
}

function toMindmapDiagram(spec: NormalizedMindmapSpec): MindmapDiagram {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  const visit = (
    topic: NormalizedMindmapSpec["root"],
    depth: number,
    siblingIndex: number,
    parentId?: string,
  ) => {
    nodes.push({
      id: topic.id,
      label: topic.label,
      kind: depth === 0 ? "root" : "topic",
      metadata: { depth, siblingIndex },
    });
    if (parentId) {
      edges.push({
        id: `branch-${topic.id.slice("topic-".length)}`,
        source: parentId,
        target: topic.id,
        metadata: { depth, siblingIndex },
      });
    }
    topic.children.forEach((child, index) =>
      visit(child, depth + 1, index, topic.id),
    );
  };
  visit(spec.root, 0, 0);
  return parseMindmapDiagram({
    id: spec.id,
    title: spec.title,
    type: "mindmap",
    nodes,
    edges,
    layout: { direction: spec.layout.direction, edgeRouting: "curved" },
    style: { ...SKETCHI_DIAGRAM_STYLE },
  });
}

function mindmapQuality(
  diagram: MindmapDiagram,
  threshold: number,
): QualityReport {
  const generic = diagram.nodes.filter((node) =>
    /^(topic|branch|item|mindmap)$/i.test(node.label.trim()),
  );
  const score = Math.max(0, 10 - generic.length * 2);
  return {
    accepted: score >= threshold,
    score,
    threshold,
    summary: {
      nodeCount: diagram.nodes.length,
      edgeCount: diagram.edges.length,
    },
    checks: generic.map((node) => ({
      code: "generic_label",
      passed: false,
      severity: "warning",
      message: `Topic "${node.label}" is too generic.`,
      refs: [{ kind: "node", id: node.id }],
    })),
  };
}

function normalizeSequenceDiagramSpec(
  spec: BuildSequenceDiagramRequest["spec"],
): NormalizedSequenceDiagramSpec {
  const title = cleanToolString(spec.title);
  return {
    id: cleanOptional(spec.id) ?? (slugify(title) || "sketchi-sequence"),
    title,
    participants: spec.participants.map((participant) => ({
      id: cleanToolString(participant.id),
      label: cleanToolString(participant.label),
      ...(participant.kind ? { kind: cleanToolString(participant.kind) } : {}),
    })),
    messages: spec.messages.map((message, index) => ({
      id:
        cleanOptional(message.id) ??
        `message-${index + 1}-${slugify(message.source)}-${slugify(message.target)}`,
      source: cleanToolString(message.source),
      target: cleanToolString(message.target),
      label: cleanToolString(message.label),
      ...(message.type ? { type: message.type } : {}),
      ...(message.style ? { style: message.style } : {}),
    })),
    style: { ...SKETCHI_DIAGRAM_STYLE },
  };
}

function validateNormalizedSequenceDiagram(
  spec: NormalizedSequenceDiagramSpec,
): CodeModeIssue[] {
  const issues: CodeModeIssue[] = [];
  const participantIds = new Set<string>();
  spec.participants.forEach((participant, index) => {
    if (participantIds.has(participant.id)) {
      issues.push(
        issue({
          code: "duplicate_node_id",
          stage: "input",
          ref: { kind: "request", path: `spec.participants.[${index}].id` },
          message: `Participant id "${participant.id}" is duplicated.`,
          hint: "Give every participant a unique stable id and update message references.",
        }),
      );
    }
    participantIds.add(participant.id);
  });

  const participantIndexById = new Map(
    spec.participants.map((participant, index) => [participant.id, index]),
  );
  spec.participants.forEach((participant) => {
    const generatedLifelineId = sequenceLifelineId(participant.id);
    const collisionIndex = participantIndexById.get(generatedLifelineId);
    if (collisionIndex === undefined) {
      return;
    }
    issues.push(
      issue({
        code: "duplicate_node_id",
        stage: "input",
        ref: {
          kind: "request",
          path: `spec.participants.[${collisionIndex}].id`,
        },
        message: `Participant id "${generatedLifelineId}" collides with the generated lifeline for "${participant.id}".`,
        hint: "Rename the participant so its id does not equal another participant id followed by :lifeline.",
      }),
    );
  });

  const messageIds = new Set<string>();
  spec.messages.forEach((message, index) => {
    if (messageIds.has(message.id)) {
      issues.push(
        issue({
          code: "duplicate_edge_id",
          stage: "input",
          ref: { kind: "request", path: `spec.messages.[${index}].id` },
          message: `Message id "${message.id}" is duplicated.`,
          hint: "Give every message a unique id or omit message ids to generate them deterministically.",
        }),
      );
    }
    messageIds.add(message.id);
    if (!participantIds.has(message.source)) {
      issues.push(
        issue({
          code: "missing_edge_source",
          stage: "input",
          ref: { kind: "request", path: `spec.messages.[${index}].source` },
          message: `Message source "${message.source}" is not a participant.`,
          hint: "Use the id of a participant declared in spec.participants.",
        }),
      );
    }
    if (!participantIds.has(message.target)) {
      issues.push(
        issue({
          code: "missing_edge_target",
          stage: "input",
          ref: { kind: "request", path: `spec.messages.[${index}].target` },
          message: `Message target "${message.target}" is not a participant.`,
          hint: "Use the id of a participant declared in spec.participants.",
        }),
      );
    }
    if (message.source === message.target) {
      issues.push(
        issue({
          code: "self_loop",
          stage: "input",
          ref: { kind: "request", path: `spec.messages.[${index}]` },
          message: `Message "${message.id}" is self-referential.`,
          hint: "Choose a different target participant; self messages are not supported.",
        }),
      );
    }
  });
  return issues;
}

function sequenceQuality(
  spec: NormalizedSequenceDiagramSpec,
  threshold: number,
): QualityReport {
  const score = 10;
  return {
    accepted: score >= threshold,
    score,
    threshold,
    summary: {
      nodeCount: spec.participants.length,
      edgeCount: spec.messages.length,
    },
    checks: [],
  };
}

export class CodeModeArtifactRenderFailed extends Schema.TaggedError<CodeModeArtifactRenderFailed>()(
  "CodeModeArtifactRenderFailed",
  { cause: Schema.Defect(), message: Schema.String },
) {}

/** Implementations may retain their own tagged renderer failures. */
type TaggedArtifactRenderFailure = Pick<
  CodeModeArtifactRenderFailed,
  "message"
> & {
  readonly _tag: string;
};

export interface CodeModeArtifactRenderer<
  E extends TaggedArtifactRenderFailure = TaggedArtifactRenderFailure,
> {
  renderPng(input: {
    scene: RenderedDiagramScene;
    excalidraw: unknown;
  }): Effect.Effect<ArrayBuffer | Uint8Array, E>;
}

class CodeModeArtifactRendererNotConfigured extends Schema.TaggedError<CodeModeArtifactRendererNotConfigured>()(
  "CodeModeArtifactRendererNotConfigured",
  { message: Schema.String },
) {}

type ArtifactExportError =
  CodeModeArtifactRendererNotConfigured | CodeModeArtifactRenderFailed;

interface SelectorTargets {
  arrows: PatchableArrow[];
  nodes: PatchableNode[];
  texts: PatchableText[];
}

const FailureContextSchema = Schema.Struct({
  issues: Schema.Array(Schema.toEncoded(CodeModeIssueSchema)).pipe(
    Schema.mutable,
  ),
});

class ArtifactExportFailure extends Schema.TaggedError<ArtifactExportFailure>()(
  "ArtifactExportFailure",
  {
    status: Schema.Literal("export_failed"),
    issues: FailureContextSchema.fields.issues,
  },
) {}

class ArtifactStorageFailure extends Schema.TaggedError<ArtifactStorageFailure>()(
  "ArtifactStorageFailure",
  {
    status: Schema.Literal("storage_failed"),
    cause: Schema.Defect(),
    issues: FailureContextSchema.fields.issues,
  },
) {}

function workflowFailure<
  const Tag extends string,
  const Statuses extends readonly string[],
  C extends { readonly issues: CodeModeIssue[] },
>(
  tag: Tag,
  status: Schema.Literals<Statuses>,
  context: Schema.Codec<C, unknown>,
) {
  class WorkflowFailure extends Schema.TaggedError<WorkflowFailure>()(tag, {
    message: Schema.String,
    status,
    context,
  }) {
    constructor(input: {
      readonly status: Statuses[number];
      readonly context: C;
    }) {
      // Failure context can contain the normalized input that failed validation.
      super(
        {
          ...input,
          message: input.context.issues[0]?.message ?? input.status,
        },
        { disableChecks: true },
      );
    }
  }
  return WorkflowFailure;
}

const BuildFlowchartFailure = workflowFailure(
  "BuildFlowchartFailure",
  BuildFlowchartRejected.fields.status,
  BuildFlowchartRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const BuildMindmapFailure = workflowFailure(
  "BuildMindmapFailure",
  BuildMindmapRejected.fields.status,
  BuildMindmapRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const BuildSequenceDiagramFailure = workflowFailure(
  "BuildSequenceDiagramFailure",
  BuildSequenceDiagramRejected.fields.status,
  BuildSequenceDiagramRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const CreateCanvasFailure = workflowFailure(
  "CreateCanvasFailure",
  CreateCanvasRejected.fields.status,
  CreateCanvasRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const GetArtifactFailure = workflowFailure(
  "GetArtifactFailure",
  GetArtifactRejected.fields.status,
  GetArtifactRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const SearchIconsFailure = workflowFailure(
  "SearchIconsFailure",
  SearchIconsRejected.fields.status,
  SearchIconsRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

const ApplyDiagramPatchFailure = workflowFailure(
  "ApplyDiagramPatchFailure",
  ApplyDiagramPatchRejected.fields.status,
  ApplyDiagramPatchRejected.mapFields(({ ok, status, ...context }) => ({
    ...context,
    ...FailureContextSchema.fields,
  })),
);

type PatchableElement = PatchableScene["elements"][number];
type PatchableNode = Extract<PatchableElement, { type: "node" }>;
type PatchableText = Extract<PatchableElement, { type: "text" }>;
type PatchableArrow = Extract<PatchableElement, { type: "arrow" }>;
type PatchablePoint = PatchableArrow["points"][number];

function defaultCreateId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function issue(input: {
  code: CodeModeIssueCode;
  severity?: "error" | "warning";
  stage: CodeModeIssue["stage"];
  ref?: CodeModeIssueRef;
  message: string;
  hint: string;
}): CodeModeIssue {
  return {
    code: input.code,
    severity: input.severity ?? "error",
    stage: input.stage,
    ...(input.ref ? { ref: input.ref } : {}),
    message: input.message,
    hint: input.hint,
  };
}

function pathForContractIssue(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "input";
  }
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : String(part)))
    .join(".");
}

type ContractIssueLike = typeof ContractSchemaIssue.Encoded;
type ContractErrorLike = ContractSchemaError;

function codeForContractIssue(
  contractIssue: ContractIssueLike,
): CodeModeIssueCode {
  const path = pathForContractIssue(contractIssue.path);
  if (isPatchOperationNamePath(path)) return "unsupported_patch_operation";
  if (
    contractIssue.issueTag === "InvalidType" ||
    (contractIssue.issueTag === "MissingKey" &&
      contractIssue.missingKeyCode === "invalid_type")
  )
    return "invalid_type";
  if (
    contractIssue.astKind === "LiteralUnion" &&
    contractIssue.issueTag === "AnyOf"
  )
    return "invalid_enum";
  if (path.toLowerCase().includes("color")) return "invalid_color";
  return path === "input" ? "invalid_type" : "missing_field";
}

function isPatchOperationNamePath(path: string): boolean {
  return /^operations\.\[\d+\]\.op$/.test(path);
}

function hintForContractIssue(path: string): string {
  if (isPatchOperationNamePath(path)) {
    return [
      `Use one of: ${DIAGRAM_PATCH_OPERATION_NAMES.join(", ")}.`,
      "For label edits, use replaceText with selector plus text.",
    ].join(" ");
  }

  if (path === "source") {
    return "Pass source: { artifactId } from an accepted build or patch, or source: { scene } for inline Sketchi scene patching.";
  }

  return `Fix ${path} so it matches the Code Mode API contract.`;
}

function inputIssues(error: ContractSchemaError): CodeModeIssue[] {
  const issues = error.issues
    .slice(0, MAX_INPUT_ISSUES)
    .map((contractIssue) => {
      const path = pathForContractIssue(contractIssue.path);
      return issue({
        code: codeForContractIssue(contractIssue),
        stage: "input",
        ref: { kind: "request", path },
        message: contractIssue.message,
        hint: hintForContractIssue(path),
      });
    });
  if (error.issues.length > MAX_INPUT_ISSUES) {
    issues.push(
      issue({
        code: "invalid_type",
        stage: "input",
        ref: { kind: "request", path: "input" },
        message: `${error.issues.length - MAX_INPUT_ISSUES} additional input issues were omitted.`,
        hint: "Fix the summarized request shape before retrying.",
      }),
    );
  }
  return issues;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function cleanOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = cleanToolString(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function codeModeRefForFlowchart(
  ref: FlowchartValidationIssueRef | undefined,
): CodeModeIssueRef | undefined {
  if (!ref) {
    return undefined;
  }
  return {
    kind: ref.kind,
    ...(ref.id ? { id: ref.id } : {}),
    ...(ref.path ? { path: `spec.${ref.path}` } : {}),
  };
}

function canonicalFlowchartIssues(diagram: FlowchartDiagram): CodeModeIssue[] {
  return getFlowchartValidationIssues(diagram).map((validationIssue) => {
    const ref = codeModeRefForFlowchart(validationIssue.ref);
    return issue({
      code: validationIssue.code,
      stage: "flowchart",
      ...(ref ? { ref } : {}),
      message: validationIssue.message,
      hint: validationIssue.hint,
    });
  });
}

function flowchartSchemaRef(
  contractIssue: ContractIssueLike,
  spec: NormalizedFlowchartSpec,
): CodeModeIssueRef {
  const path = pathForContractIssue(contractIssue.path);
  const specPath = path === "input" ? "spec" : `spec.${path}`;
  const [collection, index] = contractIssue.path;
  if (collection === "nodes" && typeof index === "number") {
    const nodeId = spec.nodes[index]?.id;
    return {
      kind: "node",
      ...(nodeId ? { id: nodeId } : {}),
      path: specPath,
    };
  }
  if (collection === "edges" && typeof index === "number") {
    const edgeId = spec.edges[index]?.id;
    return {
      kind: "edge",
      ...(edgeId ? { id: edgeId } : {}),
      path: specPath,
    };
  }
  return { kind: "diagram", id: spec.id, path: specPath };
}

function flowchartSchemaIssues(
  error: ContractErrorLike,
  spec: NormalizedFlowchartSpec,
): CodeModeIssue[] {
  return error.issues.slice(0, FLOWCHART_MAX_ISSUES).map((contractIssue) => {
    const ref = flowchartSchemaRef(contractIssue, spec);
    return issue({
      code: codeForContractIssue(contractIssue),
      stage: "flowchart",
      ref,
      message: contractIssue.message,
      hint: `Fix ${ref.path ?? "spec"} so normalization produces a valid canonical flowchart value.`,
    });
  });
}

function qualityIssues(quality: QualityReport): CodeModeIssue[] {
  return quality.checks.map((check) =>
    issue({
      code: CodeModeIssueCodeFromString(check.code),
      severity: check.severity,
      stage: "quality",
      message: check.message,
      hint:
        check.severity === "error"
          ? "Repair the structural issue and call buildFlowchart again."
          : "Improve the labels or scope before styling the artifact.",
    }),
  );
}

function CodeModeIssueCodeFromString(value: string): CodeModeIssueCode {
  if (
    value === "generic_label" ||
    value === "label_too_long" ||
    value === "disconnected_graph"
  ) {
    return value;
  }
  return "quality_below_threshold";
}

function requestedFormats(
  input: BuildFlowchartRequest["options"] | ApplyDiagramPatchRequest["options"],
): ArtifactFormat[] {
  return input?.artifactFormats ?? DEFAULT_BUILD_FORMATS;
}

function requestedInlineFormats(
  input: BuildFlowchartRequest["options"] | ApplyDiagramPatchRequest["options"],
): InlineArtifactFormat[] {
  return input?.inlineArtifacts ?? DEFAULT_INLINE_FORMATS;
}

const storedArtifactsForFormats = Effect.fn("codeMode.artifacts.exportFormats")(
  function* (input: {
    formats: readonly ArtifactFormat[];
    scene: RenderedDiagramScene;
    excalidraw: ExcalidrawScene;
    renderer?: CodeModeArtifactRenderer | undefined;
  }) {
    const artifacts: StoredArtifactFormat[] = [];

    for (const format of input.formats) {
      const data = yield* dataForArtifactFormat(input, format);
      artifacts.push({
        format,
        mimeType: ARTIFACT_MIME_TYPES[format],
        data,
        sizeBytes: sizeBytesForArtifactData(data),
      });
    }

    return artifacts;
  },
);

function dataForArtifactFormat(
  input: {
    scene: RenderedDiagramScene;
    excalidraw: ExcalidrawScene;
    renderer?: CodeModeArtifactRenderer | undefined;
  },
  format: ArtifactFormat,
): Effect.Effect<unknown, ArtifactExportError> {
  if (format === "scene") {
    return Effect.succeed(input.scene);
  }

  if (format === "excalidraw") {
    return Effect.succeed(createExcalidrawFile(input.excalidraw));
  }

  if (!input.renderer) {
    return Effect.fail(
      CodeModeArtifactRendererNotConfigured.make({
        message: "PNG artifact rendering is not configured for this runtime.",
      }),
    );
  }

  return input.renderer
    .renderPng({
      scene: input.scene,
      excalidraw: input.excalidraw,
    })
    .pipe(
      Effect.mapError((cause) =>
        CodeModeArtifactRenderFailed.make({ cause, message: cause.message }),
      ),
    );
}

function sizeBytesForArtifactData(data: unknown): number {
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    return data.byteLength;
  }

  return jsonSizeBytes(data);
}

function artifactExportIssues(error: ArtifactExportError): CodeModeIssue[] {
  return [
    issue({
      code: "render_failed",
      stage: "export",
      ...(error._tag === "CodeModeArtifactRendererNotConfigured"
        ? { ref: { kind: "artifact", path: "options.artifactFormats" } }
        : {}),
      message: error.message,
      hint:
        error._tag === "CodeModeArtifactRendererNotConfigured"
          ? "Use the hosted Studio Code Mode runtime with its Cloudflare Browser Run binding, or omit png from artifactFormats."
          : "Retry the request; if it keeps failing, inspect the configured renderer.",
    }),
  ];
}

function exportIssues(
  validationIssues: ReturnType<typeof validateExcalidrawScene>["issues"],
): CodeModeIssue[] {
  return validationIssues.map((validationIssue) => {
    const code =
      validationIssue.code === "overlapping-arrow-segment"
        ? "arrow_overlap"
        : validationIssue.code === "text-overflow"
          ? "text_overflow"
          : validationIssue.code.includes("binding") ||
              validationIssue.code.includes("bound") ||
              validationIssue.code.includes("endpoint")
            ? "arrow_binding_invalid"
            : "export_invalid_scene";

    return issue({
      code,
      stage: "export",
      ref: validationIssue.elementId
        ? { kind: "artifact", id: validationIssue.elementId }
        : { kind: "artifact" },
      message: validationIssue.message,
      hint: "Inspect the rendered scene and retry with a simpler layout or patch.",
    });
  });
}

function canvasIssueCode(
  validationIssue: CanvasValidationIssue,
): CodeModeIssueCode {
  switch (validationIssue.code) {
    case "duplicate_element_id":
      return "duplicate_element_id";
    case "duplicate_layer_id":
      return "duplicate_layer_id";
    case "empty_canvas":
      return "invalid_canvas_geometry";
    case "invalid_binding":
      return "invalid_canvas_binding";
    case "invalid_composition":
      return "invalid_canvas_composition";
    case "invalid_geometry":
      return "invalid_canvas_geometry";
    case "invalid_icon":
      return "invalid_canvas_icon";
    case "invalid_polygon":
      return "invalid_polygon";
    case "label_overflow":
      return "invalid_canvas_geometry";
    case "limit_exceeded":
      return "canvas_limit_exceeded";
    case "missing_z_order_element":
    case "duplicate_z_order_element":
    case "unknown_z_order_element":
      return "invalid_z_order";
    case "unknown_layout_target":
      return "unknown_layout_target";
  }
}

function canvasValidationIssues(
  validationIssues: readonly CanvasValidationIssue[],
): CodeModeIssue[] {
  return validationIssues.slice(0, MAX_INPUT_ISSUES).map((validationIssue) =>
    issue({
      code: canvasIssueCode(validationIssue),
      stage: "canvas",
      ref: validationIssue.elementId
        ? {
            kind: "element",
            id: validationIssue.elementId,
            path: validationIssue.path,
          }
        : { kind: "diagram", path: validationIssue.path },
      message: validationIssue.message,
      hint: "Repair the referenced CanvasSpec field and call createCanvas again.",
    }),
  );
}

function canvasExportIssues(
  validationIssues: ReturnType<typeof validateExcalidrawScene>["issues"],
): CodeModeIssue[] {
  return exportIssues(
    // Canvas authoring permits intentional overlaps and connector crossings;
    // these quality diagnostics are not hard structural export failures.
    validationIssues.filter(
      (validationIssue) =>
        validationIssue.code !== "overlapping-arrow-segment" &&
        validationIssue.code !== "arrow-segment-through-node",
    ),
  );
}

function normalizePatchableScene(
  scene: PatchableScene,
): RenderedDiagramScene | null {
  const elements: Array<RenderedDiagramScene["elements"][number]> = [];

  for (const element of scene.elements) {
    if (element.type === "arrow") {
      const first = element.points[0];
      const second = element.points[1];
      const rest = element.points.slice(2);
      if (!first || !second) {
        return null;
      }
      const points: [ScenePoint, ScenePoint, ...ScenePoint[]] = [
        first,
        second,
        ...rest,
      ];
      elements.push({
        ...element,
        type: "arrow",
        id: element.id,
        edgeId: element.edgeId,
        sourceNodeId: element.sourceNodeId,
        targetNodeId: element.targetNodeId,
        ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
        ...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
        ...(element.textColor ? { textColor: element.textColor } : {}),
        points,
        ...(element.label ? { label: element.label } : {}),
      });
      continue;
    }

    if (element.type === "node") {
      const polygonPoints = element.points;
      if (
        element.shape === "polygon" &&
        (!polygonPoints ||
          !polygonPoints[0] ||
          !polygonPoints[1] ||
          !polygonPoints[2])
      ) {
        return null;
      }
      elements.push({
        type: "node",
        id: element.id,
        nodeId: element.nodeId,
        ...(element.kind ? { kind: element.kind } : {}),
        ...(element.icon
          ? { icon: { slug: element.icon.slug, size: element.icon.size } }
          : {}),
        shape: element.shape,
        ...(element.fillColor ? { fillColor: element.fillColor } : {}),
        ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        label: element.label,
        ...(element.frameId ? { frameId: element.frameId } : {}),
        ...(element.groupIds ? { groupIds: [...element.groupIds] } : {}),
        ...(element.layerId ? { layerId: element.layerId } : {}),
        ...(element.locked !== undefined ? { locked: element.locked } : {}),
        ...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
        ...(element.zIndex !== undefined ? { zIndex: element.zIndex } : {}),
        ...(element.fillStyle ? { fillStyle: element.fillStyle } : {}),
        ...(element.roughness !== undefined
          ? { roughness: element.roughness }
          : {}),
        ...(element.strokeStyle ? { strokeStyle: element.strokeStyle } : {}),
        ...(element.strokeWidth !== undefined
          ? { strokeWidth: element.strokeWidth }
          : {}),
        ...(element.rendererRole === "sequence-lifeline" &&
        isStructurallyValidSequenceLifeline(scene, element)
          ? { rendererRole: element.rendererRole }
          : {}),
        ...(element.textColor ? { textColor: element.textColor } : {}),
        ...(element.shape === "polygon" &&
        polygonPoints?.[0] &&
        polygonPoints[1] &&
        polygonPoints[2]
          ? {
              points: [
                polygonPoints[0],
                polygonPoints[1],
                polygonPoints[2],
                ...polygonPoints.slice(3),
              ],
            }
          : {}),
      });
      continue;
    }

    if (element.type === "line") {
      const first = element.points[0];
      const second = element.points[1];
      if (!first || !second) return null;
      elements.push({
        ...element,
        points: [first, second, ...element.points.slice(2)],
      });
      continue;
    }

    elements.push(structuredClone(element));
  }

  return {
    kind: scene.kind,
    version: scene.version,
    diagramId: scene.diagramId,
    title: scene.title,
    width: scene.width,
    height: scene.height,
    accentColor: scene.accentColor,
    backgroundColor: scene.backgroundColor,
    elements,
    layers: structuredClone(scene.layers),
    layouts: structuredClone(scene.layouts),
    zOrder: [...scene.zOrder],
  };
}

/** The authored view of a scene: node icon references without derived SVG bytes. */
function withoutIconAssets(scene: RenderedDiagramScene): RenderedDiagramScene {
  const { icons: _icons, ...rest } = scene;
  return rest;
}

function cloneScene(scene: PatchableScene): PatchableScene {
  return structuredClone(scene);
}

function sourceConnectivity(scene: PatchableScene): string[] {
  return scene.elements
    .flatMap((element) => {
      if (element.type === "arrow") {
        return [
          `arrow:${element.id}:${element.sourceNodeId}->${element.targetNodeId}`,
        ];
      }
      if (element.type === "line") {
        return [
          `line:${element.id}:${element.startBinding?.elementId ?? ""}->${element.endBinding?.elementId ?? ""}`,
        ];
      }
      return [];
    })
    .sort();
}

function sameConnectivity(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function nodeElements(scene: PatchableScene): PatchableNode[] {
  return scene.elements.filter(
    (element): element is PatchableNode => element.type === "node",
  );
}

function textElements(scene: PatchableScene): PatchableText[] {
  return scene.elements.filter(
    (element): element is PatchableText => element.type === "text",
  );
}

function arrowElements(scene: PatchableScene): PatchableArrow[] {
  return scene.elements.filter(
    (element): element is PatchableArrow => element.type === "arrow",
  );
}

function labelsMatch(
  labels: readonly string[] | undefined,
  value: string | undefined,
): boolean {
  if (!labels || labels.length === 0 || !value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return labels.some((label) => label.trim().toLowerCase() === normalized);
}

function selectorHasFilters(selector: DiagramSelector | undefined): boolean {
  return Boolean(
    selector &&
    ((selector.ids?.length ?? 0) > 0 ||
      (selector.nodeIds?.length ?? 0) > 0 ||
      (selector.edgeIds?.length ?? 0) > 0 ||
      (selector.kinds?.length ?? 0) > 0 ||
      (selector.labels?.length ?? 0) > 0),
  );
}

function resolveTargets(
  scene: PatchableScene,
  selector: DiagramSelector | undefined,
): SelectorTargets {
  const scope = selector?.scope ?? "all";
  const hasFilters = selectorHasFilters(selector);
  const ids = new Set(selector?.ids ?? []);
  const nodeIds = new Set(selector?.nodeIds ?? []);
  const edgeIds = new Set(selector?.edgeIds ?? []);
  const kinds = new Set(selector?.kinds ?? []);
  const nodes = nodeElements(scene).filter((node) => {
    if (scope === "edges") {
      return false;
    }
    if (!selector || !hasFilters) {
      return true;
    }
    return (
      ids.has(node.id) ||
      nodeIds.has(node.nodeId) ||
      (node.kind ? [...kinds].some((kind) => kind === node.kind) : false) ||
      labelsMatch(selector.labels, node.label)
    );
  });
  const arrows = arrowElements(scene).filter((arrow) => {
    if (scope === "nodes") {
      return false;
    }
    if (!selector || !hasFilters) {
      return true;
    }
    return (
      ids.has(arrow.id) ||
      edgeIds.has(arrow.edgeId) ||
      labelsMatch(selector.labels, arrow.label)
    );
  });
  const nodeElementIds = new Set(nodes.map((node) => node.id));
  const arrowElementIds = new Set(arrows.map((arrow) => arrow.id));
  const texts = textElements(scene).filter((text) => {
    if (!selector || !hasFilters) {
      if (scope === "nodes") {
        return text.containerId ? nodeElementIds.has(text.containerId) : false;
      }
      if (scope === "edges") {
        return text.containerId ? arrowElementIds.has(text.containerId) : false;
      }
      return true;
    }
    return (
      ids.has(text.id) ||
      (text.containerId ? nodeElementIds.has(text.containerId) : false) ||
      (text.containerId ? arrowElementIds.has(text.containerId) : false) ||
      labelsMatch(selector.labels, text.text)
    );
  });

  return { arrows, nodes, texts };
}

function targetIssue(operation: DiagramPatchOperation): CodeModeIssue {
  return issue({
    code: "unknown_patch_target",
    stage: "flowchart",
    ref: { kind: "request", path: "operations.selector" },
    message: `Patch operation "${operation.op}" did not match any scene element.`,
    hint: "Use nodeIds, edgeIds, ids, kinds, labels, or scope values that exist in the accepted artifact.",
  });
}

function textForContainer(
  scene: PatchableScene,
  containerId: string,
): PatchableText | undefined {
  return textElements(scene).find((text) => text.containerId === containerId);
}

function centerTextOnNode(scene: PatchableScene, node: PatchableNode): void {
  const text = textForContainer(scene, node.id);
  if (!text) {
    return;
  }
  text.x = node.x + node.width / 2;
  text.y = node.y + node.height / 2;
}

function midpoint(
  points: readonly PatchablePoint[],
): PatchablePoint | undefined {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return undefined;
  }
  return {
    x: (first.x + last.x) / 2,
    y: (first.y + last.y) / 2 - 10,
  };
}

function syncArrowLabel(scene: PatchableScene, arrow: PatchableArrow): void {
  const label = textForContainer(scene, arrow.id);
  const point = midpoint(arrow.points);
  if (!label || !point) {
    return;
  }
  label.x = point.x;
  label.y = point.y;
}

function translatePoint(
  point: PatchablePoint,
  dx: number,
  dy: number,
): PatchablePoint {
  return { x: point.x + dx, y: point.y + dy };
}

function applyStyle(
  scene: PatchableScene,
  operation: Extract<
    DiagramPatchOperation,
    { op: "setDefaultStyle" | "setStyle" }
  >,
): CodeModeIssue[] {
  if (operation.style.backgroundColor) {
    scene.backgroundColor = operation.style.backgroundColor;
  }

  if (operation.op === "setDefaultStyle") {
    if (operation.style.strokeColor) {
      scene.accentColor = operation.style.strokeColor;
    }
    for (const node of nodeElements(scene)) {
      if (operation.style.fillColor) {
        node.fillColor = operation.style.fillColor;
      }
      if (operation.style.strokeColor) {
        node.strokeColor = operation.style.strokeColor;
      }
      if (operation.style.textColor) {
        node.textColor = operation.style.textColor;
      }
    }
    for (const arrow of arrowElements(scene)) {
      if (operation.style.strokeColor) {
        arrow.strokeColor = operation.style.strokeColor;
      }
      if (operation.style.textColor) {
        arrow.textColor = operation.style.textColor;
      }
    }
    for (const text of textElements(scene)) {
      if (operation.style.textColor) {
        text.textColor = operation.style.textColor;
      }
    }
    return [];
  }

  const targets = resolveTargets(scene, operation.selector);
  if (
    targets.nodes.length === 0 &&
    targets.arrows.length === 0 &&
    targets.texts.length === 0
  ) {
    return [targetIssue(operation)];
  }

  for (const node of targets.nodes) {
    if (operation.style.fillColor) {
      node.fillColor = operation.style.fillColor;
    }
    if (operation.style.strokeColor) {
      node.strokeColor = operation.style.strokeColor;
    }
    if (operation.style.textColor) {
      node.textColor = operation.style.textColor;
      const text = textForContainer(scene, node.id);
      if (text) {
        text.textColor = operation.style.textColor;
      }
    }
  }
  for (const arrow of targets.arrows) {
    if (operation.style.strokeColor) {
      arrow.strokeColor = operation.style.strokeColor;
    }
    if (operation.style.textColor) {
      arrow.textColor = operation.style.textColor;
      const text = textForContainer(scene, arrow.id);
      if (text) {
        text.textColor = operation.style.textColor;
      }
    }
  }
  for (const text of targets.texts) {
    if (operation.style.textColor) {
      text.textColor = operation.style.textColor;
    }
  }

  return [];
}

function rerouteConnectedArrows(
  scene: PatchableScene,
  nodeIds: readonly string[],
): void {
  const movedNodeIds = new Set(nodeIds);
  for (const arrow of arrowElements(scene)) {
    if (
      movedNodeIds.has(arrow.sourceNodeId) ||
      movedNodeIds.has(arrow.targetNodeId)
    ) {
      rerouteArrow(scene, arrow);
    }
  }
}

function applyShape(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "setShape" }>,
): CodeModeIssue[] {
  const targets = resolveTargets(scene, operation.selector);
  if (targets.nodes.length === 0) {
    return [targetIssue(operation)];
  }

  const resizedNodeIds: string[] = [];
  for (const node of targets.nodes) {
    node.shape = operation.shape;
    if (operation.shape === "polygon") {
      node.points = [
        { x: node.width / 2, y: 0 },
        { x: node.width, y: node.height / 2 },
        { x: node.width / 2, y: node.height },
        { x: 0, y: node.height / 2 },
      ];
    } else {
      delete node.points;
    }
    if (operation.shape === "circle") {
      const size = Math.max(node.width, node.height);
      node.x -= (size - node.width) / 2;
      node.y -= (size - node.height) / 2;
      node.width = size;
      node.height = size;
      resizedNodeIds.push(node.nodeId);
    }
    centerTextOnNode(scene, node);
  }
  rerouteConnectedArrows(scene, resizedNodeIds);
  return [];
}

function applyTranslate(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "translate" }>,
): CodeModeIssue[] {
  const targets = resolveTargets(scene, operation.selector);
  if (
    targets.nodes.length === 0 &&
    targets.arrows.length === 0 &&
    targets.texts.length === 0
  ) {
    return [targetIssue(operation)];
  }

  const movedNodeIds = new Set<string>();
  const movedTextIds = new Set<string>();

  for (const node of targets.nodes) {
    node.x += operation.dx;
    node.y += operation.dy;
    movedNodeIds.add(node.nodeId);
    const text = textForContainer(scene, node.id);
    if (text) {
      text.x += operation.dx;
      text.y += operation.dy;
      movedTextIds.add(text.id);
    }
  }

  for (const arrow of targets.arrows) {
    arrow.points = arrow.points.map((point) =>
      translatePoint(point, operation.dx, operation.dy),
    );
    const label = textForContainer(scene, arrow.id);
    if (label) {
      label.x += operation.dx;
      label.y += operation.dy;
      movedTextIds.add(label.id);
    }
  }

  for (const text of targets.texts) {
    if (!movedTextIds.has(text.id)) {
      text.x += operation.dx;
      text.y += operation.dy;
    }
  }

  rerouteConnectedArrows(scene, [...movedNodeIds]);
  recomputeSceneBounds(scene);
  return [];
}

function applyReplaceText(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "replaceText" }>,
): CodeModeIssue[] {
  const targets = resolveTargets(scene, operation.selector);
  if (
    targets.nodes.length === 0 &&
    targets.arrows.length === 0 &&
    targets.texts.length === 0
  ) {
    return [targetIssue(operation)];
  }

  for (const node of targets.nodes) {
    node.label = operation.text;
    const text = textForContainer(scene, node.id);
    if (text) {
      text.text = operation.text;
    }
  }
  for (const arrow of targets.arrows) {
    arrow.label = operation.text;
    const text = textForContainer(scene, arrow.id);
    if (text) {
      text.text = operation.text;
    }
  }
  for (const text of targets.texts) {
    text.text = operation.text;
  }

  return [];
}

function nodeCenter(node: PatchableNode): PatchablePoint {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function edgePoint(
  source: PatchableNode,
  target: PatchableNode,
  coincidentRole: "source" | "target",
): PatchablePoint {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  // Opposite faces prevent a route between coincident centers from collapsing.
  if (dx === 0 && dy === 0) {
    return {
      x: sourceCenter.x,
      y: coincidentRole === "source" ? source.y + source.height : source.y,
    };
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx >= 0) {
      return { x: source.x + source.width, y: sourceCenter.y };
    }
    return { x: source.x, y: sourceCenter.y };
  }

  if (dy >= 0) {
    return { x: sourceCenter.x, y: source.y + source.height };
  }
  return { x: sourceCenter.x, y: source.y };
}

function rerouteArrow(
  scene: PatchableScene,
  arrow: PatchableArrow,
): CodeModeIssue[] {
  const nodesById = new Map(
    nodeElements(scene).map((node) => [node.nodeId, node]),
  );
  const source = nodesById.get(arrow.sourceNodeId);
  const target = nodesById.get(arrow.targetNodeId);
  if (!source || !target) {
    return [
      issue({
        code: "patch_output_invalid",
        stage: "render",
        ref: { kind: "edge", id: arrow.edgeId },
        message: `Arrow "${arrow.id}" references a node that is not in the scene.`,
        hint: "Rebuild the diagram with buildFlowchart or buildMindmap before applying visual patches.",
      }),
    ];
  }

  const start = edgePoint(source, target, "source");
  const end = edgePoint(target, source, "target");
  const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x);
  if (vertical) {
    const midY = (start.y + end.y) / 2;
    arrow.points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  } else {
    const midX = (start.x + end.x) / 2;
    arrow.points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  syncArrowLabel(scene, arrow);
  return [];
}

function applyRerouteEdges(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "rerouteEdges" }>,
): CodeModeIssue[] {
  const targets = resolveTargets(scene, operation.selector);
  if (targets.arrows.length === 0) {
    return [targetIssue(operation)];
  }
  return targets.arrows.flatMap((arrow) => rerouteArrow(scene, arrow));
}

function recomputeSceneBounds(scene: PatchableScene): void {
  let maxX = scene.width;
  let maxY = scene.height;
  for (const element of scene.elements) {
    if (element.type === "arrow" || element.type === "line") {
      for (const point of element.points) {
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    } else if (element.type === "text") {
      maxX = Math.max(maxX, element.x + (element.maxWidth ?? 0));
      maxY = Math.max(maxY, element.y + element.fontSize);
    } else {
      maxX = Math.max(maxX, element.x + element.width);
      maxY = Math.max(maxY, element.y + element.height);
    }
  }
  scene.width = maxX + SCENE_PADDING;
  scene.height = maxY + SCENE_PADDING;
}

function patchTargetIds(
  scene: PatchableScene,
  selector: DiagramSelector,
): Set<string> {
  const targets = resolveTargets(scene, selector);
  const ids = new Set([
    ...targets.nodes.map((element) => element.id),
    ...targets.arrows.map((element) => element.id),
    ...targets.texts.map((element) => element.id),
  ]);
  const explicitIds = new Set(selector.ids ?? []);
  for (const element of scene.elements) {
    if (explicitIds.has(element.id)) ids.add(element.id);
  }
  return ids;
}

function anchoredIndex(
  order: readonly string[],
  beforeId: string | undefined,
  afterId: string | undefined,
): number | undefined {
  if (beforeId && afterId) return undefined;
  if (beforeId) {
    const index = order.indexOf(beforeId);
    return index >= 0 ? index : undefined;
  }
  if (afterId) {
    const index = order.indexOf(afterId);
    return index >= 0 ? index + 1 : undefined;
  }
  return order.length;
}

function structuralOperationIssue(
  operation: DiagramPatchOperation,
  message: string,
): CodeModeIssue[] {
  return [
    issue({
      code: "patch_output_invalid",
      stage: "canvas",
      ref: { kind: "request", path: "operations" },
      message,
      hint: `Repair the ${operation.op} operation and preserve unique, stable element ids.`,
    }),
  ];
}

function applyInsert(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "insert" }>,
): CodeModeIssue[] {
  const existingIds = new Set(scene.elements.map((element) => element.id));
  const insertedIds = operation.elements.map((element) => element.id);
  if (
    new Set(insertedIds).size !== insertedIds.length ||
    insertedIds.some((id) => existingIds.has(id))
  ) {
    return structuralOperationIssue(
      operation,
      "Inserted elements must use ids that are unique within the canvas.",
    );
  }
  const index = anchoredIndex(
    scene.zOrder,
    operation.beforeId,
    operation.afterId,
  );
  if (index === undefined) {
    return structuralOperationIssue(
      operation,
      "Insert specifies an unknown anchor or both beforeId and afterId.",
    );
  }
  scene.elements.push(
    ...operation.elements.map((element) => structuredClone(element)),
  );
  scene.zOrder.splice(index, 0, ...insertedIds);
  return [];
}

function applyRemove(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "remove" }>,
): CodeModeIssue[] {
  const removedIds = patchTargetIds(scene, operation.selector);
  if (removedIds.size === 0) return [targetIssue(operation)];
  const removedNodeIds = new Set(
    scene.elements.flatMap((element) =>
      element.type === "node" && removedIds.has(element.id)
        ? [element.nodeId]
        : [],
    ),
  );
  let previousSize: number;
  do {
    previousSize = removedIds.size;
    for (const element of scene.elements) {
      if (
        (element.type === "text" &&
          element.containerId &&
          removedIds.has(element.containerId)) ||
        (element.type === "arrow" &&
          (removedNodeIds.has(element.sourceNodeId) ||
            removedNodeIds.has(element.targetNodeId))) ||
        (element.type === "line" &&
          ((element.startBinding &&
            removedIds.has(element.startBinding.elementId)) ||
            (element.endBinding &&
              removedIds.has(element.endBinding.elementId))))
      ) {
        removedIds.add(element.id);
      }
    }
  } while (removedIds.size !== previousSize);
  const retained = scene.elements
    .filter((element) => !removedIds.has(element.id))
    .map((element) => {
      if (element.frameId && removedIds.has(element.frameId)) {
        const { frameId: _removedFrameId, ...retainedElement } = element;
        return retainedElement;
      }
      return element;
    });
  scene.elements.splice(0, scene.elements.length, ...retained);
  const retainedOrder = scene.zOrder.filter((id) => !removedIds.has(id));
  scene.zOrder.splice(0, scene.zOrder.length, ...retainedOrder);
  const layouts = scene.layouts
    .map((layout) => ({
      ...layout,
      ids: layout.ids.filter((id) => !removedIds.has(id)),
    }))
    .filter((layout) => layout.ids.length > 0);
  scene.layouts.splice(0, scene.layouts.length, ...layouts);
  recomputeSceneBounds(scene);
  return [];
}

function applyReplace(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "replace" }>,
): CodeModeIssue[] {
  const index = scene.elements.findIndex(
    (element) => element.id === operation.id,
  );
  if (index < 0) return [targetIssue(operation)];
  if (operation.element.id !== operation.id) {
    return structuralOperationIssue(
      operation,
      "Replacement element id must match the stable id being replaced.",
    );
  }
  scene.elements.splice(index, 1, structuredClone(operation.element));
  recomputeSceneBounds(scene);
  return [];
}

function applyReorder(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "reorder" }>,
): CodeModeIssue[] {
  const selected = new Set(operation.ids);
  if (
    selected.size !== operation.ids.length ||
    operation.ids.some((id) => !scene.zOrder.includes(id))
  ) {
    return structuralOperationIssue(
      operation,
      "Reorder ids must be unique ids already present in zOrder.",
    );
  }
  const remaining = scene.zOrder.filter((id) => !selected.has(id));
  const index = anchoredIndex(remaining, operation.beforeId, operation.afterId);
  if (index === undefined) {
    return structuralOperationIssue(
      operation,
      "Reorder specifies an unknown anchor or both beforeId and afterId.",
    );
  }
  remaining.splice(index, 0, ...operation.ids);
  scene.zOrder.splice(0, scene.zOrder.length, ...remaining);
  return [];
}

function applyGroup(
  scene: PatchableScene,
  operation: Extract<DiagramPatchOperation, { op: "group" | "ungroup" }>,
): CodeModeIssue[] {
  const ids = new Set(operation.ids);
  if (
    operation.ids.some(
      (id) => !scene.elements.some((element) => element.id === id),
    )
  ) {
    return [targetIssue(operation)];
  }
  const grouped = scene.elements.map((element) => {
    if (!ids.has(element.id)) return element;
    if (operation.op === "group") {
      return {
        ...element,
        groupIds: [
          ...new Set([...(element.groupIds ?? []), operation.groupId]),
        ],
      };
    }
    return {
      ...element,
      groupIds: operation.groupId
        ? (element.groupIds ?? []).filter((id) => id !== operation.groupId)
        : [],
    };
  });
  scene.elements.splice(0, scene.elements.length, ...grouped);
  return [];
}

function applyPatchOperation(
  scene: PatchableScene,
  operation: DiagramPatchOperation,
): CodeModeIssue[] {
  switch (operation.op) {
    case "setDefaultStyle":
    case "setStyle":
      return applyStyle(scene, operation);
    case "setShape":
      return applyShape(scene, operation);
    case "translate":
      return applyTranslate(scene, operation);
    case "replaceText":
      return applyReplaceText(scene, operation);
    case "rerouteEdges":
      return applyRerouteEdges(scene, operation);
    case "insert":
      return applyInsert(scene, operation);
    case "remove":
      return applyRemove(scene, operation);
    case "replace":
      return applyReplace(scene, operation);
    case "reorder":
      return applyReorder(scene, operation);
    case "group":
    case "ungroup":
      return applyGroup(scene, operation);
  }
}

const resolvePatchSource = Effect.fn("codeMode.patch.resolveSource")(function* (
  input: ApplyDiagramPatchRequest,
) {
  if ("scene" in input.source) {
    return { scene: cloneScene(input.source.scene) };
  }

  const store = yield* CodeModeArtifactStorage;
  const manifest = yield* store.readManifest(input.source.artifactId).pipe(
    Effect.mapError(
      (error) =>
        new ApplyDiagramPatchFailure({
          status: "storage_failed",
          context: {
            issues: [storageIssue(error.message, "storage_read_failed")],
          },
        }),
    ),
  );
  if (
    !manifest ||
    manifest.artifactId !== input.source.artifactId ||
    !manifest.formats.some((format) => format.format === "scene")
  ) {
    return yield* new ApplyDiagramPatchFailure({
      status: "source_unavailable",
      context: {
        issues: [
          issue({
            code: "patch_source_unavailable",
            stage: "storage",
            ref: { kind: "artifact", id: input.source.artifactId },
            message: `Artifact "${input.source.artifactId}" does not have a valid source manifest.`,
            hint: "Rebuild with the appropriate build operation and patch the accepted artifact id.",
          }),
        ],
      },
    });
  }

  const artifact = yield* store.read(input.source.artifactId, "scene").pipe(
    Effect.mapError(
      (error) =>
        new ApplyDiagramPatchFailure({
          status: "storage_failed",
          context: {
            issues: [storageIssue(error.message, "storage_read_failed")],
          },
        }),
    ),
  );
  if (!artifact) {
    return yield* new ApplyDiagramPatchFailure({
      status: "source_unavailable",
      context: {
        issues: [
          issue({
            code: "patch_source_unavailable",
            stage: "storage",
            ref: { kind: "artifact", id: input.source.artifactId },
            message: `Scene artifact "${input.source.artifactId}" is not available.`,
            hint: "Call buildFlowchart or buildMindmap first, then patch the accepted artifact id.",
          }),
        ],
      },
    });
  }

  const parsed = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
    errors: "all",
    reportInput: true,
  })(artifact.data);
  if (!Result.isSuccess(parsed)) {
    return yield* new ApplyDiagramPatchFailure({
      status: "source_unavailable",
      context: {
        issues: [
          issue({
            code: "patch_source_unavailable",
            stage: "storage",
            ref: { kind: "artifact", id: input.source.artifactId },
            message: `Scene artifact "${input.source.artifactId}" could not be decoded.`,
            hint: "Rebuild with the appropriate build operation and patch the new artifact.",
          }),
        ],
      },
    });
  }

  return {
    scene: cloneScene(parsed.success),
    sourceArtifactId: input.source.artifactId,
  };
});

function responseRequestId(requestId: string | undefined) {
  return requestId ? { requestId } : {};
}

function withArtifactUrls(
  artifact: ArtifactBundle,
  artifactUrl: CodeModeRuntimeOptions["artifactUrl"],
) {
  if (!artifactUrl) {
    return artifact;
  }

  const formats = artifact.formats.map((formatRef) => ({
    ...formatRef,
    url: artifactUrl({
      artifactId: artifact.artifactId,
      format: formatRef.format,
    }),
  }));
  const preview = artifact.preview
    ? formats.find((formatRef) => formatRef.format === artifact.preview?.format)
    : undefined;

  return {
    ...artifact,
    formats,
    ...(preview ? { preview } : {}),
  };
}

function scenePartial(scene: RenderedDiagramScene): PartialArtifactBundle {
  return {
    diagramId: scene.diagramId,
    formats: [
      {
        format: "scene",
        mimeType: ARTIFACT_MIME_TYPES.scene,
        inline: scene,
        sizeBytes: jsonSizeBytes(scene),
      },
    ],
  };
}

function failureResult<Status extends string, Context>(error: {
  readonly status: Status;
  readonly context: Context;
}) {
  return { ok: false as const, status: error.status, ...error.context };
}

function storageFailureIssue(
  error: CodeModeArtifactStorageError,
  code: "storage_read_failed" | "storage_write_failed",
) {
  return storageIssue(error.message, code);
}

const exportAndStoreScene = Effect.fn("codeMode.artifacts.exportAndStore")(
  function* (input: {
    scene: RenderedDiagramScene;
    formats: readonly ArtifactFormat[];
    inlineFormats: InlineArtifactFormat[];
    requestId?: string;
    provenance?: ArtifactBundle["provenance"];
    validationIssues: typeof exportIssues;
  }) {
    const environment = yield* CodeModeRuntimeEnvironment;
    const store = yield* CodeModeArtifactStorage;
    const { excalidraw, validation } = yield* Effect.sync(() => {
      const excalidraw = convertSceneToExcalidraw(input.scene);
      return { excalidraw, validation: validateExcalidrawScene(excalidraw) };
    }).pipe(Effect.withSpan("codeMode.artifacts.exportValidate"));
    const issues = input.validationIssues(validation.issues);
    if (issues.length > 0) {
      return yield* new ArtifactExportFailure({
        status: "export_failed",
        issues,
      });
    }
    const formats = yield* storedArtifactsForFormats({
      formats: input.formats,
      scene: input.scene,
      excalidraw,
      renderer: environment.renderer,
    }).pipe(
      Effect.mapError(
        (error) =>
          new ArtifactExportFailure({
            status: "export_failed",
            issues: artifactExportIssues(error),
          }),
      ),
    );
    const artifactId = yield* Effect.sync(() =>
      environment.createId("artifact"),
    );
    const artifact = yield* withTelemetryCorrelation(
      store
        .write({
          artifactId,
          diagramId: input.scene.diagramId,
          formats,
          inlineFormats: input.inlineFormats,
          ...(input.provenance ? { provenance: input.provenance } : {}),
        })
        .pipe(Effect.withSpan("codeMode.artifacts.store")),
      {
        artifactId,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ArtifactStorageFailure({
            status: "storage_failed",
            cause,
            issues: [storageFailureIssue(cause, "storage_write_failed")],
          }),
      ),
    );
    return withArtifactUrls(artifact, environment.artifactUrl);
  },
);

const buildMindmapWorkflow = Effect.fn("codeMode.buildMindmap.workflow")(
  function* (input: unknown) {
    const preflightIssues = preflightMindmapInput(input);
    if (preflightIssues.length > 0) {
      return yield* new BuildMindmapFailure({
        status: "invalid_mindmap",
        context: { issues: preflightIssues },
      });
    }

    const parsed = Schema.decodeUnknownResult(BuildMindmapRequestSchema, {
      errors: "all",
      reportInput: true,
    })(input);
    if (!Result.isSuccess(parsed)) {
      return yield* new BuildMindmapFailure({
        status: "invalid_input",
        context: {
          issues: inputIssues(formatContractSchemaError(parsed.failure)),
        },
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;

    const request = parsed.success;
    const buildId = yield* Effect.sync(() => environment.createId("build"));
    const normalizedSpec = normalizeMindmapSpec(request.spec);
    const baseContext = {
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
    };
    const validationIssues = validateNormalizedMindmap(normalizedSpec);
    if (validationIssues.length > 0) {
      return yield* new BuildMindmapFailure({
        status: "invalid_mindmap",
        context: { ...baseContext, issues: validationIssues },
      });
    }

    const diagram = yield* Effect.try({
      try: () => toMindmapDiagram(normalizedSpec),
      catch: (cause) =>
        new BuildMindmapFailure({
          status: "invalid_mindmap",
          context: {
            ...baseContext,
            issues: [
              issue({
                code: "disconnected_graph",
                stage: "mindmap",
                ref: { kind: "diagram", id: normalizedSpec.id },
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Mindmap failed core validation.",
                hint: "Repair the nested topic hierarchy and call buildMindmap again.",
              }),
            ],
          },
        }),
    });
    const quality = mindmapQuality(
      diagram,
      request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
    );
    const qualityContext = { ...baseContext, quality };
    if (!quality.accepted) {
      return yield* new BuildMindmapFailure({
        status: "quality_failed",
        context: { ...qualityContext, issues: qualityIssues(quality) },
      });
    }

    const scene = yield* Effect.try({
      try: () => renderIntermediateDiagram(diagram),
      catch: (cause) =>
        new BuildMindmapFailure({
          status: "render_failed",
          context: {
            ...qualityContext,
            issues: [
              issue({
                code: "render_failed",
                stage: "render",
                ref: { kind: "diagram", id: normalizedSpec.id },
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Unable to render mindmap scene.",
                hint: "Simplify the hierarchy or retry with a smaller mindmap.",
              }),
            ],
          },
        }),
    }).pipe(Effect.withSpan("codeMode.buildMindmap.render"));
    const exportContext = { ...qualityContext, partial: scenePartial(scene) };
    const artifact = yield* exportAndStoreScene({
      scene,
      formats: requestedFormats(request.options),
      inlineFormats: requestedInlineFormats(request.options),
      ...(request.requestId ? { requestId: request.requestId } : {}),
      validationIssues: exportIssues,
    }).pipe(
      Effect.mapError(
        (error) =>
          new BuildMindmapFailure({
            status: error.status,
            context: {
              ...(error.status === "export_failed"
                ? exportContext
                : {
                    ...qualityContext,
                    partial: { diagramId: scene.diagramId },
                  }),
              issues: error.issues,
            },
          }),
      ),
    );

    return {
      ok: true,
      status: "accepted",
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
      quality,
      artifact,
      issues: [],
    } satisfies Extract<BuildMindmapResult, { ok: true }>;
  },
);

const buildSequenceDiagramWorkflow = Effect.fn(
  "codeMode.buildSequenceDiagram.workflow",
)(function* (input: unknown) {
  const parsed = Schema.decodeUnknownResult(BuildSequenceDiagramRequestSchema, {
    errors: "all",
    reportInput: true,
  })(input);
  if (!Result.isSuccess(parsed)) {
    return yield* new BuildSequenceDiagramFailure({
      status: "invalid_input",
      context: {
        issues: inputIssues(formatContractSchemaError(parsed.failure)),
      },
    });
  }

  const environment = yield* CodeModeRuntimeEnvironment;

  const request = parsed.success;
  const buildId = yield* Effect.sync(() => environment.createId("build"));
  const normalizedSpec = normalizeSequenceDiagramSpec(request.spec);
  const baseContext = {
    buildId,
    ...responseRequestId(request.requestId),
    normalizedSpec,
  };
  const validationIssues = validateNormalizedSequenceDiagram(normalizedSpec);
  if (validationIssues.length > 0) {
    return yield* new BuildSequenceDiagramFailure({
      status: "invalid_sequence",
      context: { ...baseContext, issues: validationIssues },
    });
  }

  const quality = sequenceQuality(
    normalizedSpec,
    request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
  );
  const qualityContext = { ...baseContext, quality };
  if (!quality.accepted) {
    return yield* new BuildSequenceDiagramFailure({
      status: "quality_failed",
      context: { ...qualityContext, issues: qualityIssues(quality) },
    });
  }

  const scene = yield* Effect.try({
    try: () => renderSequenceDiagram(normalizedSpec),
    catch: (cause) =>
      new BuildSequenceDiagramFailure({
        status: "render_failed",
        context: {
          ...qualityContext,
          issues: [
            issue({
              code: "render_failed",
              stage: "render",
              ref: { kind: "diagram", id: normalizedSpec.id },
              message:
                cause instanceof Error
                  ? cause.message
                  : "Unable to render sequence diagram scene.",
              hint: "Repair the participant/message structure and retry.",
            }),
          ],
        },
      }),
  }).pipe(Effect.withSpan("codeMode.buildSequenceDiagram.render"));
  const canvasIssues = getCanvasValidationIssues(scene);
  if (canvasIssues.length > 0) {
    return yield* new BuildSequenceDiagramFailure({
      status: "render_failed",
      context: {
        ...qualityContext,
        issues: canvasValidationIssues(canvasIssues).map((entry) => ({
          ...entry,
          hint: "Reduce participant label lines, participants, or messages and retry buildSequenceDiagram.",
        })),
      },
    });
  }
  const exportContext = { ...qualityContext, partial: scenePartial(scene) };
  const artifact = yield* exportAndStoreScene({
    scene,
    formats: requestedFormats(request.options),
    inlineFormats: requestedInlineFormats(request.options),
    ...(request.requestId ? { requestId: request.requestId } : {}),
    validationIssues: exportIssues,
  }).pipe(
    Effect.mapError(
      (error) =>
        new BuildSequenceDiagramFailure({
          status: error.status,
          context: {
            ...(error.status === "export_failed"
              ? exportContext
              : qualityContext),
            issues: error.issues,
          },
        }),
    ),
  );

  return {
    ok: true,
    status: "accepted",
    buildId,
    ...responseRequestId(request.requestId),
    normalizedSpec,
    quality,
    artifact,
    issues: [],
  } satisfies Extract<BuildSequenceDiagramResult, { ok: true }>;
});

const RawCreateCanvasInput = Schema.Struct({
  spec: Schema.Unknown,
  requestId: Schema.optionalKey(Schema.Unknown),
});
const RawInlinePatchInput = Schema.Struct({
  source: Schema.Struct({ scene: Schema.Unknown }),
});

const serializedCanvasLimitIssue = Effect.fn("codeMode.canvas.serializedLimit")(
  (canvas: unknown, path: "spec" | "source.scene") =>
    Effect.try(() => jsonSizeBytes(canvas)).pipe(
      Effect.match({
        onFailure: () =>
          issue({
            code: "invalid_type",
            stage: "input",
            ref: { kind: "request", path },
            message: "CanvasSpec could not be serialized as JSON.",
            hint: "Remove non-JSON values or reduce deeply nested fields and retry.",
          }),
        onSuccess: (sizeBytes) =>
          sizeBytes <= CANVAS_LIMITS.maxSerializedBytes
            ? undefined
            : issue({
                code: "canvas_limit_exceeded",
                stage: "canvas",
                ref: { kind: "request", path },
                message: `CanvasSpec exceeds ${CANVAS_LIMITS.maxSerializedBytes} serialized bytes.`,
                hint: "Split the visualization into a smaller canvas or reduce repeated text and points.",
              }),
      }),
    ),
);

const createCanvasWorkflow = Effect.fn("codeMode.createCanvas.workflow")(
  function* (input: unknown) {
    const environment = yield* CodeModeRuntimeEnvironment;
    const buildId = yield* Effect.sync(() => environment.createId("build"));
    const raw = Schema.decodeUnknownResult(RawCreateCanvasInput)(input);
    const rawInput = Result.isSuccess(raw)
      ? {
          spec: raw.success.spec,
          requestId: Schema.is(Schema.String)(raw.success.requestId)
            ? raw.success.requestId
            : undefined,
        }
      : undefined;
    if (rawInput) {
      const rawIssue = yield* serializedCanvasLimitIssue(rawInput.spec, "spec");
      if (rawIssue) {
        return yield* new CreateCanvasFailure({
          status:
            rawIssue.code === "canvas_limit_exceeded"
              ? "limit_exceeded"
              : "invalid_input",
          context: {
            buildId,
            ...responseRequestId(rawInput.requestId),
            issues: [rawIssue],
          },
        });
      }
    }
    const parsed = Schema.decodeUnknownResult(CreateCanvasRequestSchema, {
      errors: "all",
      reportInput: true,
    })(input);
    if (!Result.isSuccess(parsed)) {
      return yield* new CreateCanvasFailure({
        status: "invalid_input",
        context: {
          issues: inputIssues(formatContractSchemaError(parsed.failure)),
        },
      });
    }

    const request = parsed.success;
    const baseContext = {
      buildId,
      ...responseRequestId(request.requestId),
    };
    const normalized = normalizePatchableScene(request.spec);
    if (!normalized) {
      return yield* new CreateCanvasFailure({
        status: "invalid_canvas",
        context: {
          ...baseContext,
          issues: [
            issue({
              code: "invalid_canvas_geometry",
              stage: "canvas",
              ref: { kind: "request", path: "spec.elements" },
              message: "CanvasSpec contains an invalid point list.",
              hint: "Provide at least two points for lines/connectors and three points for polygons.",
            }),
          ],
        },
      });
    }

    const inputLimits = getCanvasValidationIssues(normalized).filter(
      (entry) => entry.code === "limit_exceeded",
    );
    if (inputLimits.length > 0) {
      return yield* new CreateCanvasFailure({
        status: "limit_exceeded",
        context: {
          ...baseContext,
          issues: canvasValidationIssues(inputLimits),
        },
      });
    }
    const embedded = yield* embedSceneIcons(
      compileCanvasSpec(normalized),
      environment.icons,
    );
    const scene = embedded.scene;
    const normalizedSpec = withoutIconAssets(scene);
    const validationIssues = getCanvasValidationIssues(scene);
    if (validationIssues.length > 0) {
      const issues = canvasValidationIssues(validationIssues);
      return yield* new CreateCanvasFailure({
        status: issues.some((entry) => entry.code === "canvas_limit_exceeded")
          ? "limit_exceeded"
          : "invalid_canvas",
        context: {
          ...baseContext,
          normalizedSpec,
          issues: [...embedded.issues, ...issues],
        },
      });
    }

    const exportContext = {
      ...baseContext,
      normalizedSpec,
      partial: scenePartial(scene),
    };
    const artifact = yield* exportAndStoreScene({
      scene,
      formats: requestedFormats(request.options),
      inlineFormats: requestedInlineFormats(request.options),
      ...(request.requestId ? { requestId: request.requestId } : {}),
      validationIssues: canvasExportIssues,
    }).pipe(
      Effect.mapError(
        (error) =>
          new CreateCanvasFailure({
            status: error.status,
            context: {
              ...exportContext,
              issues: error.issues,
            },
          }),
      ),
    );

    return {
      ok: true,
      status: "accepted",
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
      artifact,
      issues: embedded.issues,
    } satisfies Extract<CreateCanvasResult, { ok: true }>;
  },
);

const buildFlowchartWorkflow = Effect.fn("codeMode.buildFlowchart.workflow")(
  function* (input: unknown) {
    const parsed = Schema.decodeUnknownResult(BuildFlowchartRequestSchema, {
      errors: "all",
      reportInput: true,
    })(input);
    if (!Result.isSuccess(parsed)) {
      return yield* new BuildFlowchartFailure({
        status: "invalid_input",
        context: {
          issues: inputIssues(formatContractSchemaError(parsed.failure)),
        },
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;

    const request = parsed.success;

    const buildId = yield* Effect.sync(() => environment.createId("build"));
    const authoredSpec = normalizeFlowchartSpec(request.spec);
    const resolvedIcons = resolveNodeIcons(
      authoredSpec.nodes,
      environment.icons,
    );
    const normalizedSpec = { ...authoredSpec, nodes: resolvedIcons.nodes };
    const baseContext = {
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
    };
    const parsedDiagram = Schema.decodeUnknownResult(FlowchartDiagramSchema, {
      errors: "all",
      reportInput: true,
    })(flowchartDiagramInput(normalizedSpec));
    if (!Result.isSuccess(parsedDiagram)) {
      return yield* new BuildFlowchartFailure({
        status: "invalid_flowchart",
        context: {
          ...baseContext,
          issues: flowchartSchemaIssues(
            formatContractSchemaError(parsedDiagram.failure),
            normalizedSpec,
          ),
        },
      });
    }
    const diagram = parsedDiagram.success;
    const validationIssues = canonicalFlowchartIssues(diagram);
    if (validationIssues.length > 0) {
      return yield* new BuildFlowchartFailure({
        status: "invalid_flowchart",
        context: { ...baseContext, issues: validationIssues },
      });
    }
    validateFlowchartDiagram(diagram);

    const quality = assessFlowchartQuality(
      diagram,
      request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
    );
    const qualityContext = { ...baseContext, quality };
    if (!quality.accepted) {
      return yield* new BuildFlowchartFailure({
        status: "quality_failed",
        context: { ...qualityContext, issues: qualityIssues(quality) },
      });
    }

    const renderedScene = yield* Effect.try({
      try: () => renderIntermediateDiagram(diagram),
      catch: (cause) =>
        new BuildFlowchartFailure({
          status: "render_failed",
          context: {
            ...qualityContext,
            issues: [
              issue({
                code: "render_failed",
                stage: "render",
                ref: { kind: "diagram", id: normalizedSpec.id },
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Unable to render flowchart scene.",
                hint: "Simplify the graph or retry with a smaller flowchart.",
              }),
            ],
          },
        }),
    }).pipe(Effect.withSpan("codeMode.buildFlowchart.render"));
    const embedded = yield* embedSceneIcons(renderedScene, environment.icons);
    const scene = embedded.scene;
    const exportContext = { ...qualityContext, partial: scenePartial(scene) };
    const artifact = yield* exportAndStoreScene({
      scene,
      formats: requestedFormats(request.options),
      inlineFormats: requestedInlineFormats(request.options),
      ...(request.requestId ? { requestId: request.requestId } : {}),
      validationIssues: exportIssues,
    }).pipe(
      Effect.mapError(
        (error) =>
          new BuildFlowchartFailure({
            status: error.status,
            context: {
              ...(error.status === "export_failed"
                ? exportContext
                : qualityContext),
              issues: error.issues,
            },
          }),
      ),
    );

    return {
      ok: true,
      status: "accepted",
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
      quality,
      artifact,
      issues: [...resolvedIcons.issues, ...embedded.issues],
    } satisfies Extract<BuildFlowchartResult, { ok: true }>;
  },
);

const getArtifactWorkflow = Effect.fn("codeMode.getArtifact.workflow")(
  function* (input: unknown) {
    const parsed = Schema.decodeUnknownResult(GetArtifactRequestSchema, {
      errors: "all",
      reportInput: true,
    })(input);
    if (!Result.isSuccess(parsed)) {
      return yield* new GetArtifactFailure({
        status: "invalid_input",
        context: {
          issues: inputIssues(formatContractSchemaError(parsed.failure)),
        },
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;
    const store = yield* CodeModeArtifactStorage;
    const request = parsed.success;
    const manifest = yield* store.readManifest(request.artifactId).pipe(
      Effect.mapError(
        (error) =>
          new GetArtifactFailure({
            status: "storage_failed",
            context: {
              issues: [storageFailureIssue(error, "storage_read_failed")],
            },
          }),
      ),
    );
    if (!manifest) {
      return yield* new GetArtifactFailure({
        status: "not_found",
        context: {
          issues: [
            issue({
              code: "patch_source_unavailable",
              stage: "storage",
              ref: { kind: "artifact", id: request.artifactId },
              message: `Artifact "${request.artifactId}" was not found.`,
              hint: "Use the artifactId returned by buildFlowchart or applyDiagramPatch.",
            }),
          ],
        },
      });
    }

    const format = request.format ?? "scene";
    if (!manifest.formats.some((entry) => entry.format === format)) {
      return yield* new GetArtifactFailure({
        status: "format_unavailable",
        context: {
          issues: [
            issue({
              code: "unsupported_artifact_format",
              stage: "storage",
              ref: { kind: "artifact", id: request.artifactId },
              message: `Artifact "${request.artifactId}" does not include format "${format}".`,
              hint: "Request a format listed in the artifact bundle.",
            }),
          ],
        },
      });
    }

    const artifact = yield* store.read(request.artifactId, format).pipe(
      Effect.mapError(
        (error) =>
          new GetArtifactFailure({
            status: "storage_failed",
            context: {
              issues: [storageFailureIssue(error, "storage_read_failed")],
            },
          }),
      ),
    );
    if (!artifact) {
      return yield* new GetArtifactFailure({
        status: "format_unavailable",
        context: {
          issues: [
            issue({
              code: "patch_source_unavailable",
              stage: "storage",
              ref: { kind: "artifact", id: request.artifactId },
              message: `Artifact "${request.artifactId}" format "${format}" could not be read.`,
              hint: "Retry retrieval or rebuild the artifact.",
            }),
          ],
        },
      });
    }

    return {
      ok: true,
      artifactId: request.artifactId,
      diagramId: manifest.diagramId,
      format,
      mimeType: artifact.mimeType,
      ...(environment.artifactUrl
        ? {
            url: environment.artifactUrl({
              artifactId: request.artifactId,
              format,
            }),
          }
        : {}),
      ...(request.inline !== true || !isInlineArtifactFormat(format)
        ? {}
        : { inline: artifact.data }),
      sizeBytes: artifact.sizeBytes,
      ...(manifest.provenance ? { provenance: manifest.provenance } : {}),
    } satisfies Extract<GetArtifactResult, { ok: true }>;
  },
);

const applyDiagramPatchWorkflow = Effect.fn(
  "codeMode.applyDiagramPatch.workflow",
)(function* (input: unknown) {
  const raw = Schema.decodeUnknownResult(RawInlinePatchInput)(input);
  const rawIssue = Result.isSuccess(raw)
    ? yield* serializedCanvasLimitIssue(
        raw.success.source.scene,
        "source.scene",
      )
    : undefined;
  if (rawIssue) {
    return yield* new ApplyDiagramPatchFailure({
      status: "invalid_input",
      context: { issues: [rawIssue] },
    });
  }
  const parsed = Schema.decodeUnknownResult(ApplyDiagramPatchRequestSchema, {
    errors: "all",
    reportInput: true,
  })(input);
  if (!Result.isSuccess(parsed)) {
    return yield* new ApplyDiagramPatchFailure({
      status: "invalid_input",
      context: {
        issues: inputIssues(formatContractSchemaError(parsed.failure)),
      },
    });
  }

  const environment = yield* CodeModeRuntimeEnvironment;

  const request = parsed.success;
  const patchId = yield* Effect.sync(() => environment.createId("patch"));
  const baseContext = {
    patchId,
    ...responseRequestId(request.requestId),
  };

  const source = yield* resolvePatchSource(request).pipe(
    Effect.mapError(
      (error) =>
        new ApplyDiagramPatchFailure({
          status: error.status,
          context: { ...baseContext, ...error.context },
        }),
    ),
  );
  const sourceContext = {
    ...baseContext,
    ...(source.sourceArtifactId
      ? { sourceArtifactId: source.sourceArtifactId }
      : {}),
  };
  const scene = source.scene;
  let sourceLimits: CanvasValidationIssue[];
  // Count limits must hold even when malformed geometry cannot normalize.
  if (scene.elements.length > CANVAS_LIMITS.maxElements) {
    sourceLimits = [
      {
        code: "limit_exceeded",
        message: `Canvas exceeds ${CANVAS_LIMITS.maxElements} elements.`,
        path: "elements",
      },
    ];
  } else {
    const normalizedSource = normalizePatchableScene(scene);
    sourceLimits = normalizedSource
      ? getCanvasValidationIssues(normalizedSource).filter(
          (entry) => entry.code === "limit_exceeded",
        )
      : [];
  }
  if (sourceLimits.length > 0) {
    return yield* new ApplyDiagramPatchFailure({
      status: "invalid_input",
      context: {
        ...sourceContext,
        issues: canvasValidationIssues(sourceLimits),
      },
    });
  }
  const beforeConnectivity = sourceConnectivity(scene);
  let patchIssues: CodeModeIssue[] = [];
  for (const operation of request.operations) {
    patchIssues = applyPatchOperation(scene, operation);
    if (patchIssues.length > 0) break;
  }
  if (patchIssues.length > 0) {
    return yield* new ApplyDiagramPatchFailure({
      status:
        patchIssues[0]?.code === "unknown_patch_target"
          ? "target_not_found"
          : "unsupported_operation",
      context: { ...sourceContext, issues: patchIssues },
    });
  }

  if (request.options?.preserveConnectivity !== false) {
    const afterConnectivity = sourceConnectivity(scene);
    if (!sameConnectivity(beforeConnectivity, afterConnectivity)) {
      return yield* new ApplyDiagramPatchFailure({
        status: "connectivity_changed",
        context: {
          ...sourceContext,
          issues: [
            issue({
              code: "patch_preserve_connectivity_failed",
              stage: "flowchart",
              ref: { kind: "diagram", id: scene.diagramId },
              message: "Patch changed the diagram edge connectivity.",
              hint: "Use buildFlowchart for process-graph structure or buildMindmap for hierarchy structure.",
            }),
          ],
        },
      });
    }
  }

  const renderedScene = normalizePatchableScene(scene);
  if (!renderedScene) {
    return yield* new ApplyDiagramPatchFailure({
      status: "render_failed",
      context: {
        ...sourceContext,
        issues: [
          issue({
            code: "patch_output_invalid",
            stage: "render",
            ref: { kind: "diagram", id: scene.diagramId },
            message: "Patched scene has an invalid arrow point list.",
            hint: "Reroute edges or rebuild the flowchart artifact.",
          }),
        ],
      },
    });
  }

  const embedded = yield* embedSceneIcons(renderedScene, environment.icons);
  const patchedScene = embedded.scene;
  const structuralIssues = getCanvasValidationIssues(patchedScene);
  if (structuralIssues.length > 0) {
    return yield* new ApplyDiagramPatchFailure({
      status: "render_failed",
      context: {
        ...sourceContext,
        partial: scenePartial(patchedScene),
        issues: [
          ...embedded.issues,
          ...canvasValidationIssues(structuralIssues),
        ],
      },
    });
  }

  const exportContext = {
    ...sourceContext,
    partial: scenePartial(patchedScene),
  };
  const artifact = yield* exportAndStoreScene({
    scene: patchedScene,
    formats: requestedFormats(request.options),
    inlineFormats: requestedInlineFormats(request.options),
    ...(request.requestId ? { requestId: request.requestId } : {}),
    validationIssues: canvasExportIssues,
    ...(source.sourceArtifactId
      ? { provenance: { sourceArtifactId: source.sourceArtifactId } }
      : {}),
  }).pipe(
    Effect.mapError(
      (error) =>
        new ApplyDiagramPatchFailure({
          status: error.status,
          context: {
            ...(error.status === "export_failed"
              ? exportContext
              : sourceContext),
            issues: error.issues,
          },
        }),
    ),
  );

  return {
    ok: true,
    status: "accepted",
    patchId,
    ...responseRequestId(request.requestId),
    ...(source.sourceArtifactId
      ? { sourceArtifactId: source.sourceArtifactId }
      : {}),
    artifact,
    issues: embedded.issues,
  } satisfies Extract<ApplyDiagramPatchResult, { ok: true }>;
});

const searchIconsWorkflow = Effect.fn("codeMode.searchIcons.workflow")(
  function* (input: unknown) {
    const parsed = Schema.decodeUnknownResult(SearchIconsRequestSchema, {
      errors: "all",
      reportInput: true,
    })(input);
    if (!Result.isSuccess(parsed)) {
      return yield* new SearchIconsFailure({
        status: "invalid_input",
        context: {
          issues: inputIssues(formatContractSchemaError(parsed.failure)),
        },
      });
    }
    const environment = yield* CodeModeRuntimeEnvironment;
    const query = cleanToolString(parsed.success.q);
    const icons =
      environment.icons?.search(
        query,
        parsed.success.limit ?? DEFAULT_ICON_SEARCH_LIMIT,
      ) ?? [];
    return {
      ok: true,
      status: "accepted",
      query,
      icons: icons.map(({ collection, name, slug }) => ({
        collection,
        name,
        slug,
      })),
      issues: environment.icons
        ? []
        : [
            issue({
              code: "unknown_icon",
              severity: "warning",
              stage: "input",
              ref: { kind: "request", path: "q" },
              message: "This Sketchi runtime has no icon catalog.",
              hint: "Omit node icons on this host.",
            }),
          ],
    } satisfies Extract<SearchIconsResult, { ok: true }>;
  },
);

type CodeModeWorkflowEffect<A> = Effect.Effect<
  A,
  never,
  CodeModeArtifactStorage | CodeModeRuntimeEnvironment
>;

function boundary<
  A extends ObservableCodeModeResult,
  E,
  B extends ObservableCodeModeResult,
>(
  operation: CodeModeBoundaryOperation,
  workflow: (
    input: unknown,
  ) => Effect.Effect<
    A,
    E,
    CodeModeArtifactStorage | CodeModeRuntimeEnvironment
  >,
  onFailure: (error: E) => B,
): (input: unknown) => CodeModeWorkflowEffect<A | B> {
  return Effect.fn(`codeMode.${operation}`)((input: unknown) =>
    observeCodeModeBoundary(
      operation,
      input,
      workflow(input).pipe(
        Effect.match({ onFailure, onSuccess: (result) => result }),
      ),
    ),
  );
}

export const buildFlowchart: (
  input: unknown,
) => CodeModeWorkflowEffect<BuildFlowchartResult> = boundary(
  "buildFlowchart",
  buildFlowchartWorkflow,
  failureResult,
);

export const buildMindmap: (
  input: unknown,
) => CodeModeWorkflowEffect<BuildMindmapResult> = boundary(
  "buildMindmap",
  buildMindmapWorkflow,
  failureResult,
);

export const buildSequenceDiagram: (
  input: unknown,
) => CodeModeWorkflowEffect<BuildSequenceDiagramResult> = boundary(
  "buildSequenceDiagram",
  buildSequenceDiagramWorkflow,
  failureResult,
);

export const createCanvas: (
  input: unknown,
) => CodeModeWorkflowEffect<CreateCanvasResult> = boundary(
  "createCanvas",
  createCanvasWorkflow,
  failureResult,
);

export const getArtifact: (
  input: unknown,
) => CodeModeWorkflowEffect<GetArtifactResult> = boundary(
  "getArtifact",
  getArtifactWorkflow,
  failureResult,
);

/** Ranked node-logo search; use a returned slug as a node `icon.slug`. */
export const searchIcons: (
  input: unknown,
) => CodeModeWorkflowEffect<SearchIconsResult> = boundary(
  "searchIcons",
  searchIconsWorkflow,
  failureResult,
);

export const applyDiagramPatch: (
  input: unknown,
) => CodeModeWorkflowEffect<ApplyDiagramPatchResult> = boundary(
  "applyDiagramPatch",
  applyDiagramPatchWorkflow,
  failureResult,
);
