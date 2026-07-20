import {
  FLOWCHART_MAX_ISSUES,
  FlowchartDiagramSchema,
  getFlowchartValidationIssues,
  parseMindmapDiagram,
  validateFlowchartDiagram,
  type FlowchartDiagram,
  type FlowchartValidationIssueRef,
  type MindmapDiagram,
} from "@sketchi/diagram-core";
import {
  convertSceneToExcalidraw,
  createExcalidrawFile,
  type ExcalidrawScene,
  validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
  type ScenePoint,
} from "@sketchi/diagram-renderer";
import { Context, Effect, Layer, Schema } from "effect";
import { z } from "zod";

import {
  ARTIFACT_MIME_TYPES,
  CodeModeArtifactStorage,
  isInlineArtifactFormat,
  jsonSizeBytes,
  makeMemoryArtifactStorage,
  storageIssue,
  type CodeModeArtifactStorageError,
  type CodeModeArtifactStorageShape,
  type StoredArtifactFormat,
} from "./code-mode-artifacts.js";
import {
  ApplyDiagramPatchRequestSchema,
  BuildFlowchartRequestSchema,
  BuildMindmapRequestSchema,
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
  type CodeModeIssue,
  type CodeModeIssueCode,
  type CodeModeIssueRef,
  type DiagramPatchOperation,
  type DiagramSelector,
  type GetArtifactResult,
  type InlineArtifactFormat,
  type MindmapSpec,
  type NormalizedFlowchartSpec,
  type NormalizedMindmapSpec,
  type PartialArtifactBundle,
  type PatchableScene,
  type QualityReport,
} from "./code-mode-contract.js";
import { cleanToolString } from "./clean-tool-string.js";
import { assessFlowchartQuality } from "./flowchart-quality.js";
import {
  flowchartDiagramInput,
  normalizeFlowchartSpec,
} from "./flowchart-spec.js";

const DEFAULT_BUILD_FORMATS: ArtifactFormat[] = ["excalidraw", "scene"];
const DEFAULT_INLINE_FORMATS: InlineArtifactFormat[] = ["scene"];
const DEFAULT_MIN_QUALITY_SCORE = 8;
const DEFAULT_BACKGROUND = "#ffffff";
const DEFAULT_STROKE = "#000000";
const DEFAULT_TEXT = "#000000";
const SCENE_PADDING = 48;
const MAX_MINDMAP_DEPTH = 8;
const MAX_MINDMAP_TOPICS = 100;
const MAX_INPUT_ISSUES = 20;

export interface CodeModeRuntimeOptions {
  createId?: (prefix: string) => string;
  renderer?: CodeModeArtifactRenderer;
  artifactUrl?: (input: {
    artifactId: string;
    format: ArtifactFormat;
  }) => string;
}

export interface PlaygroundCodeModePromiseRuntimeForIssue243 {
  buildFlowchart(input: unknown): Promise<BuildFlowchartResult>;
  buildMindmap(input: unknown): Promise<BuildMindmapResult>;
  getArtifact(input: unknown): Promise<GetArtifactResult>;
  applyDiagramPatch(input: unknown): Promise<ApplyDiagramPatchResult>;
  readStoredArtifactForRawHttpResponseForIssue243(
    artifactId: string,
    format: ArtifactFormat,
  ): Promise<StoredArtifactFormat | null>;
}

export interface PlaygroundCodeModePromiseRuntimeOptionsForIssue243
  extends CodeModeRuntimeOptions {
  store?: CodeModeArtifactStorageShape;
}

export class CodeModeRuntimeEnvironment extends Context.Service<
  CodeModeRuntimeEnvironment,
  Required<Pick<CodeModeRuntimeOptions, "createId">> &
    Pick<CodeModeRuntimeOptions, "artifactUrl" | "renderer">
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
    ...(options.renderer ? { renderer: options.renderer } : {}),
    ...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
  });
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
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
    style: spec.style,
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
    style: spec.style,
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

export interface CodeModeArtifactRenderer {
  renderPng(input: {
    scene: RenderedDiagramScene;
    excalidraw: unknown;
    signal: AbortSignal;
  }): Promise<ArrayBuffer | Uint8Array>;
}

class CodeModeArtifactExportError extends Schema.TaggedErrorClass<CodeModeArtifactExportError>()(
  "CodeModeArtifactExportError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
    optionPath: Schema.Boolean,
  },
) {}

interface SelectorTargets {
  arrows: PatchableArrow[];
  nodes: PatchableNode[];
  texts: PatchableText[];
}

interface SourceScene {
  scene: PatchableScene;
  sourceArtifactId?: string;
}

type BuildFlowchartFailureStatus = Extract<
  BuildFlowchartResult,
  { ok: false }
>["status"];

interface BuildFlowchartFailureContext {
  readonly buildId?: string;
  readonly requestId?: string;
  readonly normalizedSpec?: NormalizedFlowchartSpec;
  readonly quality?: QualityReport;
  readonly partial?: PartialArtifactBundle;
  readonly issues: CodeModeIssue[];
}

class BuildFlowchartFailure extends Schema.TaggedErrorClass<BuildFlowchartFailure>()(
  "BuildFlowchartFailure",
  {
    message: Schema.String,
    status: Schema.Literals([
      "invalid_input",
      "invalid_flowchart",
      "quality_failed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
  },
) {
  readonly context: BuildFlowchartFailureContext;

  constructor(input: {
    readonly status: BuildFlowchartFailureStatus;
    readonly context: BuildFlowchartFailureContext;
  }) {
    super({
      message: input.context.issues[0]?.message ?? input.status,
      status: input.status,
    });
    this.context = input.context;
  }
}

type BuildMindmapFailureStatus = Extract<
  BuildMindmapResult,
  { ok: false }
>["status"];

interface BuildMindmapFailureContext {
  readonly buildId?: string;
  readonly requestId?: string;
  readonly normalizedSpec?: NormalizedMindmapSpec;
  readonly quality?: QualityReport;
  readonly partial?: PartialArtifactBundle;
  readonly issues: CodeModeIssue[];
}

class BuildMindmapFailure extends Schema.TaggedErrorClass<BuildMindmapFailure>()(
  "BuildMindmapFailure",
  {
    message: Schema.String,
    status: Schema.Literals([
      "invalid_input",
      "invalid_mindmap",
      "quality_failed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
  },
) {
  readonly context: BuildMindmapFailureContext;

  constructor(input: {
    readonly status: BuildMindmapFailureStatus;
    readonly context: BuildMindmapFailureContext;
  }) {
    super({
      message: input.context.issues[0]?.message ?? input.status,
      status: input.status,
    });
    this.context = input.context;
  }
}

type GetArtifactFailureStatus = Extract<
  GetArtifactResult,
  { ok: false }
>["status"];

class GetArtifactFailure extends Schema.TaggedErrorClass<GetArtifactFailure>()(
  "GetArtifactFailure",
  {
    message: Schema.String,
    status: Schema.Literals([
      "invalid_input",
      "not_found",
      "format_unavailable",
      "expired",
      "storage_failed",
    ]),
  },
) {
  readonly issues: CodeModeIssue[];

  constructor(input: {
    readonly status: GetArtifactFailureStatus;
    readonly issues: CodeModeIssue[];
  }) {
    super({
      message: input.issues[0]?.message ?? input.status,
      status: input.status,
    });
    this.issues = input.issues;
  }
}

type ApplyDiagramPatchFailureStatus = Extract<
  ApplyDiagramPatchResult,
  { ok: false }
>["status"];

interface ApplyDiagramPatchFailureContext {
  readonly patchId?: string;
  readonly requestId?: string;
  readonly sourceArtifactId?: string;
  readonly partial?: PartialArtifactBundle;
  readonly issues: CodeModeIssue[];
}

class ApplyDiagramPatchFailure extends Schema.TaggedErrorClass<ApplyDiagramPatchFailure>()(
  "ApplyDiagramPatchFailure",
  {
    message: Schema.String,
    status: Schema.Literals([
      "invalid_input",
      "source_unavailable",
      "target_not_found",
      "unsupported_operation",
      "connectivity_changed",
      "render_failed",
      "export_failed",
      "storage_failed",
    ]),
  },
) {
  readonly context: ApplyDiagramPatchFailureContext;

  constructor(input: {
    readonly status: ApplyDiagramPatchFailureStatus;
    readonly context: ApplyDiagramPatchFailureContext;
  }) {
    super({
      message: input.context.issues[0]?.message ?? input.status,
      status: input.status,
    });
    this.context = input.context;
  }
}

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

function pathForZodIssue(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "input";
  }
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : String(part)))
    .join(".");
}

function codeForZodIssue(zodIssue: z.core.$ZodIssue): CodeModeIssueCode {
  const path = pathForZodIssue(zodIssue.path);
  if (isPatchOperationNamePath(path)) {
    return "unsupported_patch_operation";
  }
  if (zodIssue.code === "invalid_type") {
    return "invalid_type";
  }
  if (zodIssue.code === "invalid_value") {
    return "invalid_enum";
  }
  if (path.toLowerCase().includes("color")) {
    return "invalid_color";
  }
  return path === "input" ? "invalid_type" : "missing_field";
}

function isPatchOperationNamePath(path: string): boolean {
  return /^operations\.\[\d+\]\.op$/.test(path);
}

function hintForZodIssue(path: string): string {
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

function inputIssues(error: z.ZodError): CodeModeIssue[] {
  const issues = error.issues.slice(0, MAX_INPUT_ISSUES).map((zodIssue) => {
    const path = pathForZodIssue(zodIssue.path);
    return issue({
      code: codeForZodIssue(zodIssue),
      stage: "input",
      ref: { kind: "request", path },
      message: zodIssue.message,
      hint: hintForZodIssue(path),
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
  zodIssue: z.core.$ZodIssue,
  spec: NormalizedFlowchartSpec,
): CodeModeIssueRef {
  const path = pathForZodIssue(zodIssue.path);
  const specPath = path === "input" ? "spec" : `spec.${path}`;
  const [collection, index] = zodIssue.path;
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
  error: z.ZodError,
  spec: NormalizedFlowchartSpec,
): CodeModeIssue[] {
  return error.issues.slice(0, FLOWCHART_MAX_ISSUES).map((zodIssue) => {
    const ref = flowchartSchemaRef(zodIssue, spec);
    return issue({
      code: codeForZodIssue(zodIssue),
      stage: "flowchart",
      ref,
      message: zodIssue.message,
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
): Effect.Effect<unknown, CodeModeArtifactExportError> {
  if (format === "scene") {
    return Effect.succeed(input.scene);
  }

  if (format === "excalidraw") {
    return Effect.succeed(createExcalidrawFile(input.excalidraw));
  }

  if (!input.renderer) {
    return Effect.fail(
      CodeModeArtifactExportError.make({
        cause: new Error(
          "PNG artifact rendering is not configured for this runtime.",
        ),
        message: "PNG artifact rendering is not configured for this runtime.",
        optionPath: true,
      }),
    );
  }

  return Effect.tryPromise({
    try: (signal) =>
      input.renderer?.renderPng({
        scene: input.scene,
        excalidraw: input.excalidraw,
        signal,
      }) ?? Promise.reject(new Error("PNG renderer is unavailable.")),
    catch: (cause) =>
      CodeModeArtifactExportError.make({
        cause,
        message:
          cause instanceof Error ? cause.message : "Artifact export failed.",
        optionPath: false,
      }),
  });
}

function sizeBytesForArtifactData(data: unknown): number {
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    return data.byteLength;
  }

  return jsonSizeBytes(data);
}

function artifactExportIssues(
  error: CodeModeArtifactExportError,
): CodeModeIssue[] {
  return [
    issue({
      code: "render_failed",
      stage: "export",
      ...(error.optionPath
        ? { ref: { kind: "artifact", path: "options.artifactFormats" } }
        : {}),
      message: error.message,
      hint: error.optionPath
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

function normalizePatchableScene(
  scene: PatchableScene,
): RenderedDiagramScene | null {
  const elements: RenderedDiagramScene["elements"] = [];

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
        type: "arrow",
        id: element.id,
        edgeId: element.edgeId,
        sourceNodeId: element.sourceNodeId,
        targetNodeId: element.targetNodeId,
        ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
        ...(element.textColor ? { textColor: element.textColor } : {}),
        points,
        ...(element.label ? { label: element.label } : {}),
      });
      continue;
    }

    if (element.type === "node") {
      elements.push({
        type: "node",
        id: element.id,
        nodeId: element.nodeId,
        ...(element.kind ? { kind: element.kind } : {}),
        shape: element.shape,
        ...(element.fillColor ? { fillColor: element.fillColor } : {}),
        ...(element.strokeColor ? { strokeColor: element.strokeColor } : {}),
        ...(element.textColor ? { textColor: element.textColor } : {}),
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        label: element.label,
      });
      continue;
    }

    elements.push({
      type: "text",
      id: element.id,
      ...(element.containerId ? { containerId: element.containerId } : {}),
      ...(element.textColor ? { textColor: element.textColor } : {}),
      x: element.x,
      y: element.y,
      text: element.text,
      fontSize: element.fontSize,
      ...(element.maxWidth ? { maxWidth: element.maxWidth } : {}),
    });
  }

  return {
    diagramId: scene.diagramId,
    title: scene.title,
    width: scene.width,
    height: scene.height,
    accentColor: scene.accentColor,
    backgroundColor: scene.backgroundColor,
    elements,
  };
}

function cloneScene(scene: PatchableScene): PatchableScene {
  return structuredClone(scene);
}

function sourceConnectivity(scene: PatchableScene): string[] {
  return scene.elements
    .filter((element) => element.type === "arrow")
    .map(
      (arrow) => `${arrow.edgeId}:${arrow.sourceNodeId}->${arrow.targetNodeId}`,
    )
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
  sourceSide: boolean,
): PatchablePoint {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    if ((dx >= 0 && sourceSide) || (dx < 0 && !sourceSide)) {
      return { x: source.x + source.width, y: sourceCenter.y };
    }
    return { x: source.x, y: sourceCenter.y };
  }

  if ((dy >= 0 && sourceSide) || (dy < 0 && !sourceSide)) {
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

  const start = edgePoint(source, target, true);
  const end = edgePoint(target, source, false);
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
  const xs = [scene.width];
  const ys = [scene.height];
  for (const node of nodeElements(scene)) {
    xs.push(node.x + node.width);
    ys.push(node.y + node.height);
  }
  for (const text of textElements(scene)) {
    xs.push(text.x + (text.maxWidth ?? 0));
    ys.push(text.y + text.fontSize);
  }
  for (const arrow of arrowElements(scene)) {
    for (const point of arrow.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  scene.width = Math.max(...xs) + SCENE_PADDING;
  scene.height = Math.max(...ys) + SCENE_PADDING;
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

  const parsed = RenderedDiagramSceneSchema.safeParse(artifact.data);
  if (!parsed.success) {
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
    scene: cloneScene(parsed.data),
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

function buildFlowchartFailureResult(
  error: BuildFlowchartFailure,
): Extract<BuildFlowchartResult, { ok: false }> {
  return {
    ok: false,
    status: error.status,
    ...(error.context.buildId ? { buildId: error.context.buildId } : {}),
    ...(error.context.requestId ? { requestId: error.context.requestId } : {}),
    ...(error.context.normalizedSpec
      ? { normalizedSpec: error.context.normalizedSpec }
      : {}),
    ...(error.context.quality ? { quality: error.context.quality } : {}),
    ...(error.context.partial ? { partial: error.context.partial } : {}),
    issues: error.context.issues,
  };
}

function buildMindmapFailureResult(
  error: BuildMindmapFailure,
): Extract<BuildMindmapResult, { ok: false }> {
  return {
    ok: false,
    status: error.status,
    ...(error.context.buildId ? { buildId: error.context.buildId } : {}),
    ...(error.context.requestId ? { requestId: error.context.requestId } : {}),
    ...(error.context.normalizedSpec
      ? { normalizedSpec: error.context.normalizedSpec }
      : {}),
    ...(error.context.quality ? { quality: error.context.quality } : {}),
    ...(error.context.partial ? { partial: error.context.partial } : {}),
    issues: error.context.issues,
  };
}

function getArtifactFailureResult(
  error: GetArtifactFailure,
): Extract<GetArtifactResult, { ok: false }> {
  return { ok: false, status: error.status, issues: error.issues };
}

function applyDiagramPatchFailureResult(
  error: ApplyDiagramPatchFailure,
): Extract<ApplyDiagramPatchResult, { ok: false }> {
  return {
    ok: false,
    status: error.status,
    ...(error.context.patchId ? { patchId: error.context.patchId } : {}),
    ...(error.context.requestId ? { requestId: error.context.requestId } : {}),
    ...(error.context.sourceArtifactId
      ? { sourceArtifactId: error.context.sourceArtifactId }
      : {}),
    ...(error.context.partial ? { partial: error.context.partial } : {}),
    issues: error.context.issues,
  };
}

function storageFailureIssue(
  error: CodeModeArtifactStorageError,
  code: "storage_read_failed" | "storage_write_failed",
) {
  return storageIssue(error.message, code);
}

const buildMindmapWorkflow = Effect.fn("codeMode.buildMindmap.workflow")(
  function* (input: unknown) {
    const preflightIssues = preflightMindmapInput(input);
    if (preflightIssues.length > 0) {
      return yield* new BuildMindmapFailure({
        status: "invalid_mindmap",
        context: { issues: preflightIssues },
      });
    }

    const parsed = BuildMindmapRequestSchema.safeParse(input);
    if (!parsed.success) {
      return yield* new BuildMindmapFailure({
        status: "invalid_input",
        context: { issues: inputIssues(parsed.error) },
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;
    const store = yield* CodeModeArtifactStorage;
    const request = parsed.data;
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
    });
    const excalidraw = convertSceneToExcalidraw(scene);
    const exportValidation = validateExcalidrawScene(excalidraw);
    const exportContext = {
      ...qualityContext,
      partial: scenePartial(scene),
    };
    if (!exportValidation.ok) {
      return yield* new BuildMindmapFailure({
        status: "export_failed",
        context: {
          ...exportContext,
          issues: exportIssues(exportValidation.issues),
        },
      });
    }

    const storedFormats = yield* storedArtifactsForFormats({
      formats: requestedFormats(request.options),
      scene,
      excalidraw,
      renderer: environment.renderer,
    }).pipe(
      Effect.mapError(
        (error) =>
          new BuildMindmapFailure({
            status: "export_failed",
            context: {
              ...exportContext,
              issues: artifactExportIssues(error),
            },
          }),
      ),
    );
    const artifactId = yield* Effect.sync(() =>
      environment.createId("artifact"),
    );
    const artifact = yield* store
      .write({
        artifactId,
        diagramId: scene.diagramId,
        formats: storedFormats,
        inlineFormats: requestedInlineFormats(request.options),
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new BuildMindmapFailure({
              status: "storage_failed",
              context: {
                ...qualityContext,
                partial: { diagramId: scene.diagramId },
                issues: [storageFailureIssue(error, "storage_write_failed")],
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
      artifact: withArtifactUrls(artifact, environment.artifactUrl),
      issues: [],
    } satisfies Extract<BuildMindmapResult, { ok: true }>;
  },
);

const buildFlowchartWorkflow = Effect.fn("codeMode.buildFlowchart.workflow")(
  function* (input: unknown) {
    const parsed = BuildFlowchartRequestSchema.safeParse(input);
    if (!parsed.success) {
      return yield* new BuildFlowchartFailure({
        status: "invalid_input",
        context: { issues: inputIssues(parsed.error) },
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;
    const store = yield* CodeModeArtifactStorage;
    const request = parsed.data;
    const formats = requestedFormats(request.options);
    const buildId = yield* Effect.sync(() => environment.createId("build"));
    const normalizedSpec = normalizeFlowchartSpec(request.spec);
    const baseContext = {
      buildId,
      ...responseRequestId(request.requestId),
      normalizedSpec,
    };
    const parsedDiagram = FlowchartDiagramSchema.safeParse(
      flowchartDiagramInput(normalizedSpec),
    );
    if (!parsedDiagram.success) {
      return yield* new BuildFlowchartFailure({
        status: "invalid_flowchart",
        context: {
          ...baseContext,
          issues: flowchartSchemaIssues(parsedDiagram.error, normalizedSpec),
        },
      });
    }
    const diagram = parsedDiagram.data;
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

    const scene = yield* Effect.try({
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
    });
    const excalidraw = convertSceneToExcalidraw(scene);
    const validation = validateExcalidrawScene(excalidraw);
    const exportContext = {
      ...qualityContext,
      partial: scenePartial(scene),
    };
    if (!validation.ok) {
      return yield* new BuildFlowchartFailure({
        status: "export_failed",
        context: {
          ...exportContext,
          issues: exportIssues(validation.issues),
        },
      });
    }

    const storedFormats = yield* storedArtifactsForFormats({
      formats,
      scene,
      excalidraw,
      renderer: environment.renderer,
    }).pipe(
      Effect.mapError(
        (error) =>
          new BuildFlowchartFailure({
            status: "export_failed",
            context: {
              ...exportContext,
              issues: artifactExportIssues(error),
            },
          }),
      ),
    );
    const artifactId = yield* Effect.sync(() =>
      environment.createId("artifact"),
    );
    const artifact = yield* store
      .write({
        artifactId,
        diagramId: scene.diagramId,
        formats: storedFormats,
        inlineFormats: requestedInlineFormats(request.options),
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new BuildFlowchartFailure({
              status: "storage_failed",
              context: {
                ...qualityContext,
                issues: [storageFailureIssue(error, "storage_write_failed")],
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
      artifact: withArtifactUrls(artifact, environment.artifactUrl),
      issues: [],
    } satisfies Extract<BuildFlowchartResult, { ok: true }>;
  },
);

const getArtifactWorkflow = Effect.fn("codeMode.getArtifact.workflow")(
  function* (input: unknown) {
    const parsed = GetArtifactRequestSchema.safeParse(input);
    if (!parsed.success) {
      return yield* new GetArtifactFailure({
        status: "invalid_input",
        issues: inputIssues(parsed.error),
      });
    }

    const environment = yield* CodeModeRuntimeEnvironment;
    const store = yield* CodeModeArtifactStorage;
    const request = parsed.data;
    const manifest = yield* store.readManifest(request.artifactId).pipe(
      Effect.mapError(
        (error) =>
          new GetArtifactFailure({
            status: "storage_failed",
            issues: [storageFailureIssue(error, "storage_read_failed")],
          }),
      ),
    );
    if (!manifest) {
      return yield* new GetArtifactFailure({
        status: "not_found",
        issues: [
          issue({
            code: "patch_source_unavailable",
            stage: "storage",
            ref: { kind: "artifact", id: request.artifactId },
            message: `Artifact "${request.artifactId}" was not found.`,
            hint: "Use the artifactId returned by buildFlowchart or applyDiagramPatch.",
          }),
        ],
      });
    }

    const format = request.format ?? "scene";
    if (!manifest.formats.some((entry) => entry.format === format)) {
      return yield* new GetArtifactFailure({
        status: "format_unavailable",
        issues: [
          issue({
            code: "unsupported_artifact_format",
            stage: "storage",
            ref: { kind: "artifact", id: request.artifactId },
            message: `Artifact "${request.artifactId}" does not include format "${format}".`,
            hint: "Request a format listed in the artifact bundle.",
          }),
        ],
      });
    }

    const artifact = yield* store.read(request.artifactId, format).pipe(
      Effect.mapError(
        (error) =>
          new GetArtifactFailure({
            status: "storage_failed",
            issues: [storageFailureIssue(error, "storage_read_failed")],
          }),
      ),
    );
    if (!artifact) {
      return yield* new GetArtifactFailure({
        status: "format_unavailable",
        issues: [
          issue({
            code: "patch_source_unavailable",
            stage: "storage",
            ref: { kind: "artifact", id: request.artifactId },
            message: `Artifact "${request.artifactId}" format "${format}" could not be read.`,
            hint: "Retry retrieval or rebuild the artifact.",
          }),
        ],
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
  const parsed = ApplyDiagramPatchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return yield* new ApplyDiagramPatchFailure({
      status: "invalid_input",
      context: { issues: inputIssues(parsed.error) },
    });
  }

  const environment = yield* CodeModeRuntimeEnvironment;
  const store = yield* CodeModeArtifactStorage;
  const request = parsed.data;
  const patchId = yield* Effect.sync(() => environment.createId("patch"));
  const baseContext = {
    patchId,
    ...responseRequestId(request.requestId),
  };
  const formats = requestedFormats(request.options);
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
  const beforeConnectivity = sourceConnectivity(scene);
  for (const operation of request.operations) {
    const operationIssues = applyPatchOperation(scene, operation);
    if (operationIssues.length > 0) {
      return yield* new ApplyDiagramPatchFailure({
        status:
          operationIssues[0]?.code === "unknown_patch_target"
            ? "target_not_found"
            : "unsupported_operation",
        context: { ...sourceContext, issues: operationIssues },
      });
    }
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

  const excalidraw = convertSceneToExcalidraw(renderedScene);
  const validation = validateExcalidrawScene(excalidraw);
  const exportContext = {
    ...sourceContext,
    partial: scenePartial(renderedScene),
  };
  if (!validation.ok) {
    return yield* new ApplyDiagramPatchFailure({
      status: "export_failed",
      context: { ...exportContext, issues: exportIssues(validation.issues) },
    });
  }

  const storedFormats = yield* storedArtifactsForFormats({
    formats,
    scene: renderedScene,
    excalidraw,
    renderer: environment.renderer,
  }).pipe(
    Effect.mapError(
      (error) =>
        new ApplyDiagramPatchFailure({
          status: "export_failed",
          context: { ...exportContext, issues: artifactExportIssues(error) },
        }),
    ),
  );
  const artifactId = yield* Effect.sync(() => environment.createId("artifact"));
  const artifact = yield* store
    .write({
      artifactId,
      diagramId: renderedScene.diagramId,
      formats: storedFormats,
      inlineFormats: requestedInlineFormats(request.options),
      ...(source.sourceArtifactId
        ? { provenance: { sourceArtifactId: source.sourceArtifactId } }
        : {}),
    })
    .pipe(
      Effect.mapError(
        (error) =>
          new ApplyDiagramPatchFailure({
            status: "storage_failed",
            context: {
              ...sourceContext,
              issues: [storageFailureIssue(error, "storage_write_failed")],
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
    artifact: withArtifactUrls(artifact, environment.artifactUrl),
    issues: [],
  } satisfies Extract<ApplyDiagramPatchResult, { ok: true }>;
});

function codeModeResultBoundary<A, E, R, B>(
  program: Effect.Effect<A, E, R>,
  onFailure: (error: E) => B,
): Effect.Effect<A | B, never, R> {
  return program.pipe(
    Effect.match({
      onFailure,
      onSuccess: (result) => result,
    }),
  );
}

type CodeModeWorkflowEffect<A> = Effect.Effect<
  A,
  never,
  CodeModeArtifactStorage | CodeModeRuntimeEnvironment
>;

export const buildFlowchart: (
  input: unknown,
) => CodeModeWorkflowEffect<BuildFlowchartResult> = Effect.fn(
  "codeMode.buildFlowchart",
)((input: unknown) =>
  codeModeResultBoundary(
    buildFlowchartWorkflow(input),
    buildFlowchartFailureResult,
  ),
);

export const buildMindmap: (
  input: unknown,
) => CodeModeWorkflowEffect<BuildMindmapResult> = Effect.fn(
  "codeMode.buildMindmap",
)((input: unknown) =>
  codeModeResultBoundary(
    buildMindmapWorkflow(input),
    buildMindmapFailureResult,
  ),
);

export const getArtifact: (
  input: unknown,
) => CodeModeWorkflowEffect<GetArtifactResult> = Effect.fn(
  "codeMode.getArtifact",
)((input: unknown) =>
  codeModeResultBoundary(getArtifactWorkflow(input), getArtifactFailureResult),
);

export const applyDiagramPatch: (
  input: unknown,
) => CodeModeWorkflowEffect<ApplyDiagramPatchResult> = Effect.fn(
  "codeMode.applyDiagramPatch",
)((input: unknown) =>
  codeModeResultBoundary(
    applyDiagramPatchWorkflow(input),
    applyDiagramPatchFailureResult,
  ),
);

/**
 * @deprecated Temporary Promise boundary for current Playground callers only.
 * Delete this facade when issue #243 composes the Playground Effect runtime.
 */
export function createPlaygroundCodeModePromiseRuntimeForIssue243(
  options: PlaygroundCodeModePromiseRuntimeOptionsForIssue243 = {},
): PlaygroundCodeModePromiseRuntimeForIssue243 {
  const storage = options.store ?? makeMemoryArtifactStorage();
  const environment: Context.Service.Shape<typeof CodeModeRuntimeEnvironment> =
    {
      createId: options.createId ?? defaultCreateId,
      ...(options.renderer ? { renderer: options.renderer } : {}),
      ...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
    };
  const run = <A>(program: CodeModeWorkflowEffect<A>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provideService(CodeModeArtifactStorage, storage),
        Effect.provideService(CodeModeRuntimeEnvironment, environment),
      ),
    );

  return {
    buildFlowchart: (input) => run(buildFlowchart(input)),
    buildMindmap: (input) => run(buildMindmap(input)),
    getArtifact: (input) => run(getArtifact(input)),
    applyDiagramPatch: (input) => run(applyDiagramPatch(input)),
    readStoredArtifactForRawHttpResponseForIssue243: (artifactId, format) =>
      Effect.runPromise(storage.read(artifactId, format)),
  };
}
