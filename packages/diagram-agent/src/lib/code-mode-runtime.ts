import {
  parseFlowchartDiagram,
  type FlowchartDiagram,
} from "@sketchi/diagram-core";
import {
  convertSceneToExcalidraw,
  validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
  type ScenePoint,
} from "@sketchi/diagram-renderer";
import { z } from "zod";

import {
  ARTIFACT_MIME_TYPES,
  createMemoryArtifactStore,
  isInlineArtifactFormat,
  jsonSizeBytes,
  storageIssue,
  type CodeModeArtifactStore,
  type StoredArtifactFormat,
} from "./code-mode-artifacts.js";
import {
  ApplyDiagramPatchRequestSchema,
  BuildFlowchartRequestSchema,
  DIAGRAM_PATCH_OPERATION_NAMES,
  GetArtifactRequestSchema,
  RenderedDiagramSceneSchema,
  type ApplyDiagramPatchRequest,
  type ApplyDiagramPatchResult,
  type ArtifactFormat,
  type BuildFlowchartRequest,
  type BuildFlowchartResult,
  type CodeModeIssue,
  type CodeModeIssueCode,
  type CodeModeIssueRef,
  type DiagramPatchOperation,
  type DiagramSelector,
  type FlowchartSpec,
  type GetArtifactResult,
  type InlineArtifactFormat,
  type NormalizedFlowchartSpec,
  type PatchableScene,
  type QualityReport,
} from "./code-mode-contract.js";
import { cleanToolString } from "./clean-tool-string.js";
import { gradeDiagram } from "./grade.js";

const DEFAULT_BUILD_FORMATS: ArtifactFormat[] = ["excalidraw", "scene"];
const DEFAULT_INLINE_FORMATS: InlineArtifactFormat[] = ["scene"];
const DEFAULT_MIN_QUALITY_SCORE = 8;
const DEFAULT_BACKGROUND = "#ffffff";
const DEFAULT_STROKE = "#000000";
const DEFAULT_TEXT = "#000000";
const SCENE_PADDING = 48;

export interface CodeModeRuntimeOptions {
  store?: CodeModeArtifactStore;
  createId?: (prefix: string) => string;
  renderer?: CodeModeArtifactRenderer;
}

export interface CodeModeRuntime {
  buildFlowchart(input: unknown): Promise<BuildFlowchartResult>;
  getArtifact(input: unknown): Promise<GetArtifactResult>;
  applyDiagramPatch(input: unknown): Promise<ApplyDiagramPatchResult>;
}

export interface CodeModeArtifactRenderer {
  renderPng(input: {
    scene: RenderedDiagramScene;
    excalidraw: unknown;
  }): Promise<ArrayBuffer | Uint8Array>;
}

class ArtifactExportError extends Error {
  constructor(readonly issue: CodeModeIssue) {
    super(issue.message);
  }
}

interface ValidationBuckets {
  incoming: Map<string, Array<NormalizedFlowchartSpec["edges"][number]>>;
  outgoing: Map<string, Array<NormalizedFlowchartSpec["edges"][number]>>;
}

interface SelectorTargets {
  arrows: PatchableArrow[];
  nodes: PatchableNode[];
  texts: PatchableText[];
}

interface SourceScene {
  scene: PatchableScene;
  sourceArtifactId?: string;
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
  return error.issues.map((zodIssue) => {
    const path = pathForZodIssue(zodIssue.path);
    return issue({
      code: codeForZodIssue(zodIssue),
      stage: "input",
      ref: { kind: "request", path },
      message: zodIssue.message,
      hint: hintForZodIssue(path),
    });
  });
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

function normalizeFlowchartSpec(spec: FlowchartSpec): NormalizedFlowchartSpec {
  const title = cleanToolString(spec.title);
  const id = cleanOptional(spec.id) ?? (slugify(title) || "sketchi-flowchart");

  return {
    id,
    title,
    nodes: spec.nodes.map((node) => ({
      id: cleanToolString(node.id),
      label: cleanToolString(node.label),
      kind: node.kind,
      ...(node.description
        ? { description: cleanToolString(node.description) }
        : {}),
    })),
    edges: spec.edges.map((edge, index) => ({
      id: cleanOptional(edge.id) ?? `edge-${index + 1}`,
      source: cleanToolString(edge.source),
      target: cleanToolString(edge.target),
      ...(edge.label ? { label: cleanToolString(edge.label) } : {}),
    })),
    layout: {
      direction: spec.layout.direction,
    },
    style: {
      accentColor: spec.style.accentColor,
      backgroundColor: spec.style.backgroundColor,
    },
  };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicates];
}

function buildBuckets(spec: NormalizedFlowchartSpec): ValidationBuckets {
  const incoming = new Map<
    string,
    Array<NormalizedFlowchartSpec["edges"][number]>
  >();
  const outgoing = new Map<
    string,
    Array<NormalizedFlowchartSpec["edges"][number]>
  >();

  for (const edge of spec.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  return { incoming, outgoing };
}

function validateNormalizedFlowchart(
  spec: NormalizedFlowchartSpec,
): CodeModeIssue[] {
  const issues: CodeModeIssue[] = [];
  const nodeIds = new Set(spec.nodes.map((node) => node.id));
  const duplicateNodeIds = duplicateValues(spec.nodes.map((node) => node.id));
  const duplicateEdgeIds = duplicateValues(spec.edges.map((edge) => edge.id));

  for (const nodeId of duplicateNodeIds) {
    issues.push(
      issue({
        code: "duplicate_node_id",
        stage: "flowchart",
        ref: { kind: "node", id: nodeId },
        message: `Node id "${nodeId}" is used more than once.`,
        hint: "Give every node a stable unique id.",
      }),
    );
  }

  for (const edgeId of duplicateEdgeIds) {
    issues.push(
      issue({
        code: "duplicate_edge_id",
        stage: "flowchart",
        ref: { kind: "edge", id: edgeId },
        message: `Edge id "${edgeId}" is used more than once.`,
        hint: "Give every supplied edge id a stable unique value, or omit ids and let Sketchi assign them.",
      }),
    );
  }

  for (const edge of spec.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push(
        issue({
          code: "missing_edge_source",
          stage: "flowchart",
          ref: { kind: "edge", id: edge.id, path: "spec.edges.source" },
          message: `Edge "${edge.id}" references missing source node "${edge.source}".`,
          hint: "Set edge.source to one of the node ids in spec.nodes.",
        }),
      );
    }
    if (!nodeIds.has(edge.target)) {
      issues.push(
        issue({
          code: "missing_edge_target",
          stage: "flowchart",
          ref: { kind: "edge", id: edge.id, path: "spec.edges.target" },
          message: `Edge "${edge.id}" references missing target node "${edge.target}".`,
          hint: "Set edge.target to one of the node ids in spec.nodes.",
        }),
      );
    }
    if (edge.source === edge.target) {
      issues.push(
        issue({
          code: "self_loop",
          stage: "flowchart",
          ref: { kind: "edge", id: edge.id },
          message: `Edge "${edge.id}" connects node "${edge.source}" to itself.`,
          hint: "Connect the edge to a different target node.",
        }),
      );
    }
  }

  const starts = spec.nodes.filter((node) => node.kind === "start");
  const ends = spec.nodes.filter((node) => node.kind === "end");
  if (starts.length === 0) {
    issues.push(
      issue({
        code: "missing_start",
        stage: "flowchart",
        ref: { kind: "diagram", id: spec.id },
        message: "Flowchart must contain exactly one start node.",
        hint: 'Mark the first node in the flow with kind: "start".',
      }),
    );
  }
  if (starts.length > 1) {
    issues.push(
      issue({
        code: "multiple_starts",
        stage: "flowchart",
        ref: { kind: "diagram", id: spec.id },
        message: `Flowchart has ${starts.length} start nodes.`,
        hint: "Keep one start node and change the others to process, decision, or end.",
      }),
    );
  }
  if (ends.length === 0) {
    issues.push(
      issue({
        code: "missing_end",
        stage: "flowchart",
        ref: { kind: "diagram", id: spec.id },
        message: "Flowchart must contain at least one end node.",
        hint: 'Add an end node or mark terminal outcomes with kind: "end".',
      }),
    );
  }

  const { incoming, outgoing } = buildBuckets(spec);
  for (const node of spec.nodes) {
    const incomingEdges = incoming.get(node.id) ?? [];
    const outgoingEdges = outgoing.get(node.id) ?? [];

    if (node.kind === "start" && incomingEdges.length > 0) {
      issues.push(
        issue({
          code: "start_has_incoming",
          stage: "flowchart",
          ref: { kind: "node", id: node.id },
          message: `Start node "${node.id}" has incoming edges.`,
          hint: "Route the start node only to later nodes.",
        }),
      );
    }
    if (node.kind !== "start" && incomingEdges.length === 0) {
      issues.push(
        issue({
          code: "unreachable_node",
          stage: "flowchart",
          ref: { kind: "node", id: node.id },
          message: `Node "${node.id}" has no incoming edge.`,
          hint: "Connect it from an earlier node, or make it the single start node.",
        }),
      );
    }
    if (node.kind === "end" && outgoingEdges.length > 0) {
      issues.push(
        issue({
          code: "end_has_outgoing",
          stage: "flowchart",
          ref: { kind: "node", id: node.id },
          message: `End node "${node.id}" has outgoing edges.`,
          hint: "End nodes should be terminal outcomes with zero outgoing edges.",
        }),
      );
    }
    if (node.kind !== "end" && outgoingEdges.length === 0) {
      issues.push(
        issue({
          code: "missing_outgoing_edge",
          stage: "flowchart",
          ref: { kind: "node", id: node.id },
          message: `Node "${node.id}" has no outgoing edge.`,
          hint: 'Connect it to the next step, or mark it as kind: "end".',
        }),
      );
    }
    if (node.kind === "decision") {
      if (outgoingEdges.length < 2) {
        issues.push(
          issue({
            code: "underbranched_decision",
            stage: "flowchart",
            ref: { kind: "node", id: node.id },
            message: `Decision node "${node.id}" has fewer than two outgoing branches.`,
            hint: "Add at least two outgoing edges for the decision outcomes.",
          }),
        );
      }
      const labels = outgoingEdges.map((edge) => edge.label?.trim() ?? "");
      for (const edge of outgoingEdges.filter(
        (outgoingEdge) => !outgoingEdge.label?.trim(),
      )) {
        issues.push(
          issue({
            code: "unlabeled_decision_branch",
            stage: "flowchart",
            ref: { kind: "edge", id: edge.id },
            message: `Decision node "${node.id}" has an outgoing branch without a label.`,
            hint: 'Add a short branch label such as "yes", "no", "approved", or "rejected".',
          }),
        );
      }
      for (const label of duplicateValues(
        labels
          .filter((labelValue) => labelValue.length > 0)
          .map((labelValue) => labelValue.toLowerCase()),
      )) {
        issues.push(
          issue({
            code: "duplicate_decision_branch_label",
            stage: "flowchart",
            ref: { kind: "node", id: node.id },
            message: `Decision node "${node.id}" repeats branch label "${label}".`,
            hint: "Make every outgoing branch label from the same decision unique.",
          }),
        );
      }
    }
  }

  const start = starts[0];
  if (start) {
    const reached = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || reached.has(current)) {
        continue;
      }
      reached.add(current);
      for (const edge of outgoing.get(current) ?? []) {
        queue.push(edge.target);
      }
    }
    for (const node of spec.nodes) {
      if (!reached.has(node.id)) {
        issues.push(
          issue({
            code: "unreachable_node",
            stage: "flowchart",
            ref: { kind: "node", id: node.id },
            message: `Node "${node.id}" is not reachable from the start node.`,
            hint: "Connect the graph so every node can be reached from the single start node.",
          }),
        );
      }
    }
  }

  return issues;
}

function toFlowchartDiagram(spec: NormalizedFlowchartSpec): FlowchartDiagram {
  return parseFlowchartDiagram({
    id: spec.id,
    title: spec.title,
    type: "flowchart",
    nodes: spec.nodes,
    edges: spec.edges,
    layout: {
      direction: spec.layout.direction,
      edgeRouting: "orthogonal",
    },
    style: spec.style,
  });
}

function qualityFromDiagram(
  diagram: FlowchartDiagram,
  threshold: number,
): QualityReport {
  const report = gradeDiagram(diagram);
  const checks = report.issues.map((entry) => {
    const severity: "error" | "warning" = entry.startsWith("error:")
      ? "error"
      : "warning";
    return {
      code: qualityCode(entry),
      passed: false,
      severity,
      message: entry.replace(/^(error|warn):\s*/, ""),
      refs: [],
    };
  });
  const hasError = checks.some((check) => check.severity === "error");

  return {
    accepted: report.grade >= threshold && !hasError,
    score: report.grade,
    threshold,
    summary: {
      nodeCount: diagram.nodes.length,
      edgeCount: diagram.edges.length,
    },
    checks,
  };
}

function qualityCode(entry: string): string {
  if (entry.includes("generic label")) {
    return "generic_label";
  }
  if (entry.includes("shorten label")) {
    return "label_too_long";
  }
  if (entry.includes("disconnected")) {
    return "disconnected_graph";
  }
  return "quality_below_threshold";
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

async function storedArtifactsForFormats(input: {
  formats: readonly ArtifactFormat[];
  scene: RenderedDiagramScene;
  excalidraw: unknown;
  renderer?: CodeModeArtifactRenderer | undefined;
}): Promise<StoredArtifactFormat[]> {
  const artifacts: StoredArtifactFormat[] = [];

  for (const format of input.formats) {
    const data = await dataForArtifactFormat(input, format);
    artifacts.push({
      format,
      mimeType: ARTIFACT_MIME_TYPES[format],
      data,
      sizeBytes: sizeBytesForArtifactData(data),
    });
  }

  return artifacts;
}

async function dataForArtifactFormat(
  input: {
    scene: RenderedDiagramScene;
    excalidraw: unknown;
    renderer?: CodeModeArtifactRenderer | undefined;
  },
  format: ArtifactFormat,
): Promise<unknown> {
  if (format === "scene") {
    return input.scene;
  }

  if (format === "excalidraw") {
    return input.excalidraw;
  }

  if (!input.renderer) {
    throw new ArtifactExportError(
      issue({
        code: "render_failed",
        stage: "export",
        ref: { kind: "artifact", path: "options.artifactFormats" },
        message: "PNG artifact rendering is not configured for this runtime.",
        hint: "Use the hosted Studio Code Mode runtime with its Cloudflare Browser Run binding, or omit png from artifactFormats.",
      }),
    );
  }

  return input.renderer.renderPng({
    scene: input.scene,
    excalidraw: input.excalidraw,
  });
}

function sizeBytesForArtifactData(data: unknown): number {
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    return data.byteLength;
  }

  return jsonSizeBytes(data);
}

function artifactExportIssues(error: unknown): CodeModeIssue[] {
  if (error instanceof ArtifactExportError) {
    return [error.issue];
  }

  return [
    issue({
      code: "render_failed",
      stage: "export",
      message:
        error instanceof Error ? error.message : "Artifact export failed.",
      hint: "Retry the request; if it keeps failing, inspect the configured renderer.",
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
        hint: "Rebuild the flowchart artifact before applying visual patches.",
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

async function resolvePatchSource(
  store: CodeModeArtifactStore,
  input: ApplyDiagramPatchRequest,
): Promise<SourceScene | CodeModeIssue[]> {
  if ("scene" in input.source) {
    return { scene: cloneScene(input.source.scene) };
  }

  let artifact: StoredArtifactFormat | null;
  try {
    artifact = await store.read(input.source.artifactId, "scene");
  } catch (error) {
    return [
      storageIssue(
        error instanceof Error
          ? error.message
          : `Scene artifact "${input.source.artifactId}" could not be read.`,
        "storage_read_failed",
      ),
    ];
  }
  if (!artifact) {
    return [
      issue({
        code: "patch_source_unavailable",
        stage: "storage",
        ref: { kind: "artifact", id: input.source.artifactId },
        message: `Scene artifact "${input.source.artifactId}" is not available.`,
        hint: "Call buildFlowchart first, then patch the accepted artifact id.",
      }),
    ];
  }

  const parsed = RenderedDiagramSceneSchema.safeParse(artifact.data);
  if (!parsed.success) {
    return [
      issue({
        code: "patch_source_unavailable",
        stage: "storage",
        ref: { kind: "artifact", id: input.source.artifactId },
        message: `Scene artifact "${input.source.artifactId}" could not be decoded.`,
        hint: "Rebuild the flowchart and patch the new artifact.",
      }),
    ];
  }

  return {
    scene: cloneScene(parsed.data),
    sourceArtifactId: input.source.artifactId,
  };
}

function responseRequestId(requestId: string | undefined) {
  return requestId ? { requestId } : {};
}

export function createCodeModeRuntime(
  options: CodeModeRuntimeOptions = {},
): CodeModeRuntime {
  const store = options.store ?? createMemoryArtifactStore();
  const createId = options.createId ?? defaultCreateId;
  const renderer = options.renderer;

  return {
    async buildFlowchart(input) {
      const parsed = BuildFlowchartRequestSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          status: "invalid_input",
          issues: inputIssues(parsed.error),
        };
      }

      const request = parsed.data;
      const formats = requestedFormats(request.options);
      const buildId = createId("build");
      const normalizedSpec = normalizeFlowchartSpec(request.spec);
      const validationIssues = validateNormalizedFlowchart(normalizedSpec);
      if (validationIssues.length > 0) {
        return {
          ok: false,
          status: "invalid_flowchart",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          issues: validationIssues,
        };
      }

      let diagram: FlowchartDiagram;
      try {
        diagram = toFlowchartDiagram(normalizedSpec);
      } catch (error) {
        return {
          ok: false,
          status: "invalid_flowchart",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          issues: [
            issue({
              code: "disconnected_graph",
              stage: "flowchart",
              ref: { kind: "diagram", id: normalizedSpec.id },
              message:
                error instanceof Error
                  ? error.message
                  : "Flowchart failed core validation.",
              hint: "Repair the flowchart spec and call buildFlowchart again.",
            }),
          ],
        };
      }

      const quality = qualityFromDiagram(
        diagram,
        request.options?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE,
      );
      if (!quality.accepted) {
        return {
          ok: false,
          status: "quality_failed",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          issues: qualityIssues(quality),
        };
      }

      let scene: RenderedDiagramScene;
      try {
        scene = renderIntermediateDiagram(diagram);
      } catch (error) {
        return {
          ok: false,
          status: "render_failed",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          issues: [
            issue({
              code: "render_failed",
              stage: "render",
              ref: { kind: "diagram", id: normalizedSpec.id },
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to render flowchart scene.",
              hint: "Simplify the graph or retry with a smaller flowchart.",
            }),
          ],
        };
      }

      const excalidraw = convertSceneToExcalidraw(scene);
      const validation = validateExcalidrawScene(excalidraw);
      if (!validation.ok) {
        return {
          ok: false,
          status: "export_failed",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          partial: {
            diagramId: scene.diagramId,
            formats: [
              {
                format: "scene",
                mimeType: ARTIFACT_MIME_TYPES.scene,
                inline: scene,
                sizeBytes: jsonSizeBytes(scene),
              },
            ],
          },
          issues: exportIssues(validation.issues),
        };
      }

      let storedFormats: StoredArtifactFormat[];
      try {
        storedFormats = await storedArtifactsForFormats({
          formats,
          scene,
          excalidraw,
          renderer,
        });
      } catch (error) {
        return {
          ok: false,
          status: "export_failed",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          partial: {
            diagramId: scene.diagramId,
            formats: [
              {
                format: "scene",
                mimeType: ARTIFACT_MIME_TYPES.scene,
                inline: scene,
                sizeBytes: jsonSizeBytes(scene),
              },
            ],
          },
          issues: artifactExportIssues(error),
        };
      }

      try {
        const artifactId = createId("artifact");
        const artifact = await store.write({
          artifactId,
          diagramId: scene.diagramId,
          formats: storedFormats,
          inlineFormats: requestedInlineFormats(request.options),
        });

        return {
          ok: true,
          status: "accepted",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          artifact,
          issues: [],
        };
      } catch (error) {
        return {
          ok: false,
          status: "storage_failed",
          buildId,
          ...responseRequestId(request.requestId),
          normalizedSpec,
          quality,
          issues: [
            storageIssue(
              error instanceof Error ? error.message : "Artifact write failed.",
            ),
          ],
        };
      }
    },

    async getArtifact(input) {
      const parsed = GetArtifactRequestSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          status: "invalid_input",
          issues: inputIssues(parsed.error),
        };
      }

      const request = parsed.data;
      let manifest: Awaited<ReturnType<CodeModeArtifactStore["readManifest"]>>;
      try {
        manifest = await store.readManifest(request.artifactId);
      } catch (error) {
        return {
          ok: false,
          status: "storage_failed",
          issues: [
            storageIssue(
              error instanceof Error
                ? error.message
                : "Artifact manifest read failed.",
              "storage_read_failed",
            ),
          ],
        };
      }
      if (!manifest) {
        return {
          ok: false,
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
        };
      }

      const format = request.format ?? "scene";
      if (!manifest.formats.some((entry) => entry.format === format)) {
        return {
          ok: false,
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
        };
      }

      let artifact: StoredArtifactFormat | null;
      try {
        artifact = await store.read(request.artifactId, format);
      } catch (error) {
        return {
          ok: false,
          status: "storage_failed",
          issues: [
            storageIssue(
              error instanceof Error ? error.message : "Artifact read failed.",
              "storage_read_failed",
            ),
          ],
        };
      }
      if (!artifact) {
        return {
          ok: false,
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
        };
      }

      return {
        ok: true,
        artifactId: request.artifactId,
        diagramId: manifest.diagramId,
        format,
        mimeType: artifact.mimeType,
        ...(request.inline !== true || !isInlineArtifactFormat(format)
          ? {}
          : { inline: artifact.data }),
        sizeBytes: artifact.sizeBytes,
      };
    },

    async applyDiagramPatch(input) {
      const parsed = ApplyDiagramPatchRequestSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          status: "invalid_input",
          issues: inputIssues(parsed.error),
        };
      }

      const request = parsed.data;
      const patchId = createId("patch");
      const formats = requestedFormats(request.options);
      const source = await resolvePatchSource(store, request);
      if (Array.isArray(source)) {
        return {
          ok: false,
          status: source.some(
            (sourceIssue) =>
              sourceIssue.code === "storage_read_failed" ||
              sourceIssue.code === "storage_write_failed",
          )
            ? "storage_failed"
            : "source_unavailable",
          patchId,
          ...responseRequestId(request.requestId),
          issues: source,
        };
      }

      const scene = source.scene;
      const beforeConnectivity = sourceConnectivity(scene);
      for (const operation of request.operations) {
        const operationIssues = applyPatchOperation(scene, operation);
        if (operationIssues.length > 0) {
          return {
            ok: false,
            status:
              operationIssues[0]?.code === "unknown_patch_target"
                ? "target_not_found"
                : "unsupported_operation",
            patchId,
            ...responseRequestId(request.requestId),
            ...(source.sourceArtifactId
              ? { sourceArtifactId: source.sourceArtifactId }
              : {}),
            issues: operationIssues,
          };
        }
      }

      if (request.options?.preserveConnectivity !== false) {
        const afterConnectivity = sourceConnectivity(scene);
        if (!sameConnectivity(beforeConnectivity, afterConnectivity)) {
          return {
            ok: false,
            status: "connectivity_changed",
            patchId,
            ...responseRequestId(request.requestId),
            ...(source.sourceArtifactId
              ? { sourceArtifactId: source.sourceArtifactId }
              : {}),
            issues: [
              issue({
                code: "patch_preserve_connectivity_failed",
                stage: "flowchart",
                ref: { kind: "diagram", id: scene.diagramId },
                message: "Patch changed the diagram edge connectivity.",
                hint: "Use buildFlowchart with a repaired FlowchartSpec for structural graph changes.",
              }),
            ],
          };
        }
      }

      const renderedScene = normalizePatchableScene(scene);
      if (!renderedScene) {
        return {
          ok: false,
          status: "render_failed",
          patchId,
          ...responseRequestId(request.requestId),
          ...(source.sourceArtifactId
            ? { sourceArtifactId: source.sourceArtifactId }
            : {}),
          issues: [
            issue({
              code: "patch_output_invalid",
              stage: "render",
              ref: { kind: "diagram", id: scene.diagramId },
              message: "Patched scene has an invalid arrow point list.",
              hint: "Reroute edges or rebuild the flowchart artifact.",
            }),
          ],
        };
      }

      const excalidraw = convertSceneToExcalidraw(renderedScene);
      const validation = validateExcalidrawScene(excalidraw);
      if (!validation.ok) {
        return {
          ok: false,
          status: "export_failed",
          patchId,
          ...responseRequestId(request.requestId),
          ...(source.sourceArtifactId
            ? { sourceArtifactId: source.sourceArtifactId }
            : {}),
          partial: {
            diagramId: renderedScene.diagramId,
            formats: [
              {
                format: "scene",
                mimeType: ARTIFACT_MIME_TYPES.scene,
                inline: renderedScene,
                sizeBytes: jsonSizeBytes(renderedScene),
              },
            ],
          },
          issues: exportIssues(validation.issues),
        };
      }

      let storedFormats: StoredArtifactFormat[];
      try {
        storedFormats = await storedArtifactsForFormats({
          formats,
          scene: renderedScene,
          excalidraw,
          renderer,
        });
      } catch (error) {
        return {
          ok: false,
          status: "export_failed",
          patchId,
          ...responseRequestId(request.requestId),
          ...(source.sourceArtifactId
            ? { sourceArtifactId: source.sourceArtifactId }
            : {}),
          partial: {
            diagramId: renderedScene.diagramId,
            formats: [
              {
                format: "scene",
                mimeType: ARTIFACT_MIME_TYPES.scene,
                inline: renderedScene,
                sizeBytes: jsonSizeBytes(renderedScene),
              },
            ],
          },
          issues: artifactExportIssues(error),
        };
      }

      try {
        const artifactId = createId("artifact");
        const artifact = await store.write({
          artifactId,
          diagramId: renderedScene.diagramId,
          formats: storedFormats,
          inlineFormats: requestedInlineFormats(request.options),
        });

        return {
          ok: true,
          status: "accepted",
          patchId,
          ...responseRequestId(request.requestId),
          ...(source.sourceArtifactId
            ? { sourceArtifactId: source.sourceArtifactId }
            : {}),
          artifact,
          issues: [],
        };
      } catch (error) {
        return {
          ok: false,
          status: "storage_failed",
          patchId,
          ...responseRequestId(request.requestId),
          ...(source.sourceArtifactId
            ? { sourceArtifactId: source.sourceArtifactId }
            : {}),
          issues: [
            storageIssue(
              error instanceof Error ? error.message : "Artifact write failed.",
            ),
          ],
        };
      }
    },
  };
}
