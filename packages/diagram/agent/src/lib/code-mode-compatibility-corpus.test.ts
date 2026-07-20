import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { z } from "zod";

import {
  ARTIFACT_MIME_TYPES,
  CodeModeArtifactStorageError,
  makeMemoryArtifactStorage,
  makeObjectBucketArtifactStorage,
  type CodeModeArtifactStorageShape,
  type CodeModeObjectBucket,
  type CodeModeObjectBucketBody,
  type CodeModeObjectBucketObject,
} from "./code-mode-artifacts";
import {
  ApplyDiagramPatchRequestSchema,
  ArtifactProvenanceSchema,
  BuildFlowchartRequestSchema,
  BuildMindmapRequestSchema,
  CodeModeIssueCodeSchema,
  CodeModeIssueSchema,
  DIAGRAM_PATCH_OPERATION_NAMES,
  GetArtifactRequestSchema,
  RenderedDiagramSceneSchema,
  type ApplyDiagramPatchResult,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type CodeModeIssue,
  type CodeModeIssueCode,
  type GetArtifactResult,
} from "./code-mode-contract";
import { createPlaygroundCodeModePromiseRuntimeForIssue243 } from "./code-mode-runtime";

const renderFailure = vi.hoisted(() => {
  let message: string | undefined;
  return {
    get: () => message,
    set: (next: string | undefined) => {
      message = next;
    },
  };
});

const exportFailure = vi.hoisted(() => {
  let issue:
    | {
        readonly code:
          | "empty-scene"
          | "missing-arrow-binding"
          | "overlapping-arrow-segment"
          | "text-overflow";
        readonly elementId?: string;
        readonly message: string;
      }
    | undefined;
  return {
    get: () => issue,
    set: (next: typeof issue) => {
      issue = next;
    },
  };
});

vi.mock("@sketchi/diagram-renderer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sketchi/diagram-renderer")>();
  return {
    ...actual,
    renderIntermediateDiagram: (
      input: Parameters<typeof actual.renderIntermediateDiagram>[0],
    ) => {
      const failure = renderFailure.get();
      if (failure) throw new Error(failure);
      return actual.renderIntermediateDiagram(input);
    },
  };
});

vi.mock("@sketchi/diagram-excalidraw", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sketchi/diagram-excalidraw")>();
  return {
    ...actual,
    validateExcalidrawScene: (
      input: Parameters<typeof actual.validateExcalidrawScene>[0],
    ) => {
      const failure = exportFailure.get();
      return failure
        ? { ok: false, issues: [failure] }
        : actual.validateExcalidrawScene(input);
    },
  };
});

interface RecordedObject {
  readonly body: CodeModeObjectBucketBody;
  readonly contentType?: string;
}

class RecordingBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, RecordedObject>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    const bytes =
      typeof object.body === "string"
        ? new TextEncoder().encode(object.body)
        : new Uint8Array(object.body);
    return {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    };
  }

  async put(
    key: string,
    value: CodeModeObjectBucketBody,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    this.objects.set(key, {
      body: typeof value === "string" ? value : new Uint8Array(value).slice(),
      ...(options?.httpMetadata?.contentType
        ? { contentType: options.httpMetadata.contentType }
        : {}),
    });
    return null;
  }
}

function deterministicRuntime(input?: {
  readonly bucket?: RecordingBucket;
  readonly renderer?: boolean;
  readonly store?: CodeModeArtifactStorageShape;
}) {
  let nextId = 0;
  return createPlaygroundCodeModePromiseRuntimeForIssue243({
    createId: (prefix) => `${prefix}-${(nextId += 1)}`,
    ...(input?.renderer
      ? {
          renderer: {
            renderPng: async () => new Uint8Array([137, 80, 78, 71]),
          },
        }
      : {}),
    store:
      input?.store ??
      (input?.bucket
        ? makeObjectBucketArtifactStorage(input.bucket, {
            prefix: "codemode",
          })
        : makeMemoryArtifactStorage()),
  });
}

function approvalSpec() {
  return {
    title: "Simple approval flow",
    nodes: [
      { id: "request", label: "Request arrives", kind: "start" },
      { id: "approve", label: "Approved?", kind: "decision" },
      { id: "done", label: "Done", kind: "end" },
      { id: "revise", label: "Revise", kind: "end" },
    ],
    edges: [
      { source: "request", target: "approve" },
      { source: "approve", target: "done", label: "yes" },
      { source: "approve", target: "revise", label: "no" },
    ],
    layout: { direction: "TB" },
  };
}

function invalidFlowchartSpec() {
  return {
    title: "Broken approval flow",
    nodes: [
      { id: "request", label: "Request arrives", kind: "process" },
      { id: "approve", label: "Approved?", kind: "decision" },
      { id: "done", label: "Done", kind: "process" },
    ],
    edges: [{ source: "request", target: "approve" }],
  };
}

function lowQualityFlowchartSpec() {
  return {
    title: "Flowchart",
    nodes: [
      { id: "start", label: "Task", kind: "start" },
      { id: "work", label: "Process", kind: "process" },
      { id: "done", label: "Done", kind: "end" },
    ],
    edges: [
      { source: "start", target: "work" },
      { source: "work", target: "done" },
    ],
  };
}

function successfulMindmapRequest() {
  return {
    requestId: "mindmap-request",
    spec: {
      title: "Launch strategy",
      root: {
        label: "Launch",
        children: [
          {
            label: "Product",
            children: [{ label: "Scope" }, { label: "Quality" }],
          },
          { label: "Go to market", children: [{ label: "Docs" }] },
        ],
      },
    },
    options: {
      artifactFormats: ["scene", "excalidraw"],
      inlineArtifacts: ["scene", "excalidraw"],
    },
  };
}

function throwingStore(
  operation: "read" | "readManifest" | "write",
): CodeModeArtifactStorageShape {
  const fail = (
    failedOperation: "read" | "readManifest" | "write",
    message: string,
  ) =>
    Effect.fail(
      new CodeModeArtifactStorageError({
        cause: new Error(message),
        message,
        operation: failedOperation,
      }),
    );
  return {
    read: () =>
      operation === "read"
        ? fail("read", "golden artifact read failed")
        : Effect.succeed(null),
    readManifest: () =>
      operation === "readManifest"
        ? fail("readManifest", "golden manifest read failed")
        : Effect.succeed(null),
    write: () =>
      operation === "write"
        ? fail("write", "golden write failed")
        : fail("write", "unexpected golden write"),
  };
}

function persistedObjects(bucket: RecordingBucket) {
  return [...bucket.objects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, object]) => ({
      key,
      ...(object.contentType ? { contentType: object.contentType } : {}),
      encoding: typeof object.body === "string" ? "utf8" : "bytes",
      body:
        typeof object.body === "string"
          ? object.body
          : [...new Uint8Array(object.body)],
    }));
}

type BuildFlowchartStatus =
  | "accepted"
  | Extract<BuildFlowchartResult, { ok: false }>["status"];
type BuildMindmapStatus =
  | "accepted"
  | Extract<BuildMindmapResult, { ok: false }>["status"];
type GetArtifactStatus =
  | "accepted"
  | Extract<GetArtifactResult, { ok: false }>["status"];
type ApplyDiagramPatchStatus =
  | "accepted"
  | Extract<ApplyDiagramPatchResult, { ok: false }>["status"];

const publicStatusFamilies = {
  buildFlowchart: [
    "accepted",
    "invalid_input",
    "invalid_flowchart",
    "quality_failed",
    "render_failed",
    "export_failed",
    "storage_failed",
  ],
  buildMindmap: [
    "accepted",
    "invalid_input",
    "invalid_mindmap",
    "quality_failed",
    "render_failed",
    "export_failed",
    "storage_failed",
  ],
  getArtifact: [
    "accepted",
    "invalid_input",
    "not_found",
    "format_unavailable",
    "expired",
    "storage_failed",
  ],
  applyDiagramPatch: [
    "accepted",
    "invalid_input",
    "source_unavailable",
    "target_not_found",
    "unsupported_operation",
    "connectivity_changed",
    "render_failed",
    "export_failed",
    "storage_failed",
  ],
} satisfies {
  readonly buildFlowchart: readonly BuildFlowchartStatus[];
  readonly buildMindmap: readonly BuildMindmapStatus[];
  readonly getArtifact: readonly GetArtifactStatus[];
  readonly applyDiagramPatch: readonly ApplyDiagramPatchStatus[];
};

const httpStatusMappings = {
  buildFlowchart: {
    accepted: 200,
    invalid_input: 400,
    invalid_flowchart: 422,
    quality_failed: 422,
    render_failed: 500,
    export_failed: 500,
    storage_failed: 500,
  },
  buildMindmap: {
    accepted: 200,
    invalid_input: 400,
    invalid_mindmap: 422,
    quality_failed: 422,
    render_failed: 500,
    export_failed: 500,
    storage_failed: 500,
  },
  getArtifact: {
    accepted: 200,
    invalid_input: 400,
    not_found: 404,
    format_unavailable: 404,
    expired: 410,
    storage_failed: 500,
  },
  applyDiagramPatch: {
    accepted: 200,
    invalid_input: 400,
    source_unavailable: 404,
    target_not_found: 404,
    unsupported_operation: 422,
    connectivity_changed: 422,
    render_failed: 500,
    export_failed: 500,
    storage_failed: 500,
  },
} satisfies {
  readonly buildFlowchart: Record<BuildFlowchartStatus, number>;
  readonly buildMindmap: Record<BuildMindmapStatus, number>;
  readonly getArtifact: Record<GetArtifactStatus, number>;
  readonly applyDiagramPatch: Record<ApplyDiagramPatchStatus, number>;
};

type PublicCodeModeResult =
  | BuildFlowchartResult
  | BuildMindmapResult
  | GetArtifactResult
  | ApplyDiagramPatchResult;

function observeIssue(
  result: PublicCodeModeResult,
  code: CodeModeIssueCode,
): {
  readonly issue: CodeModeIssue;
  readonly issueIndex: number;
  readonly issueOrder: readonly CodeModeIssueCode[];
  readonly resultKeys: readonly string[];
  readonly status: string;
} {
  if (result.ok) {
    throw new Error(
      `Compatibility scenario unexpectedly succeeded for ${code}: ${JSON.stringify(result)}`,
    );
  }
  const issueIndex = result.issues.findIndex((issue) => issue.code === code);
  const observed = result.issues[issueIndex];
  if (!observed) {
    throw new Error(
      `Compatibility scenario did not produce ${code}: ${JSON.stringify(result)}`,
    );
  }
  return {
    issue: observed,
    issueIndex,
    issueOrder: result.issues.map((issue) => issue.code),
    resultKeys: Object.keys(result),
    status: result.status,
  };
}

function linearSpec(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    label: `Concrete operation ${index}`,
    kind: index === 0 ? "start" : index === nodeCount - 1 ? "end" : "process",
  }));
  return {
    title: `Linear workflow with ${nodeCount} concrete operations`,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      source: node.id,
      target: nodes[index + 1]?.id,
    })),
  };
}

function nonterminatingSpec() {
  return {
    title: "Release retry branch",
    nodes: [
      { id: "start", label: "Open release", kind: "start" },
      { id: "route", label: "Release ready?", kind: "decision" },
      { id: "done", label: "Release live", kind: "end" },
      { id: "retry-a", label: "Retry validation", kind: "process" },
      { id: "retry-b", label: "Retry packaging", kind: "process" },
    ],
    edges: [
      { id: "start-route", source: "start", target: "route" },
      { id: "route-done", source: "route", target: "done", label: "yes" },
      {
        id: "route-retry",
        source: "route",
        target: "retry-a",
        label: "retry",
      },
      { id: "retry-a-b", source: "retry-a", target: "retry-b" },
      { id: "retry-b-a", source: "retry-b", target: "retry-a" },
    ],
  };
}

function deepMindmapSpec() {
  const root: { label: string; children?: unknown[] } = { label: "Root" };
  let current = root;
  for (let depth = 0; depth < 9; depth += 1) {
    const child: { label: string; children?: unknown[] } = {
      label: `Depth ${depth}`,
    };
    current.children = [child];
    current = child;
  }
  return { title: "Deep hierarchy", root };
}

async function buildIssueCompatibilityMatrix(
  sourceScene: ReturnType<typeof RenderedDiagramSceneSchema.parse>,
) {
  const flowchart = (spec: unknown, options?: unknown) =>
    deterministicRuntime().buildFlowchart({
      spec,
      ...(options ? { options } : {}),
    });
  const base = approvalSpec();

  const missingField = await deterministicRuntime().buildFlowchart({
    spec: { title: "", nodes: [], edges: [] },
  });
  const invalidType = await deterministicRuntime().buildFlowchart({
    spec: null,
  });
  const invalidEnum = await flowchart({
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "done" ? { ...node, kind: "terminal" } : node,
    ),
  });
  const invalidColor = await flowchart({
    ...base,
    style: { accentColor: "violet", backgroundColor: "#ffffff" },
  });
  const duplicateNodeId = await flowchart({
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "revise" ? { ...node, id: "done" } : node,
    ),
  });
  const duplicateEdgeId = await flowchart({
    ...base,
    edges: base.edges.map((edge) => ({ ...edge, id: "duplicate-edge" })),
  });
  const missingEdgeSource = await flowchart({
    ...base,
    edges: [
      { id: "missing-source", source: "missing", target: "done" },
      ...base.edges,
    ],
  });
  const missingEdgeTarget = await flowchart({
    ...base,
    edges: [
      { id: "missing-target", source: "request", target: "missing" },
      ...base.edges,
    ],
  });
  const selfLoop = await flowchart({
    ...base,
    edges: [
      { id: "self-loop", source: "approve", target: "approve" },
      ...base.edges,
    ],
  });
  const missingStart = await flowchart({
    ...base,
    nodes: base.nodes.map((node) =>
      node.kind === "start" ? { ...node, kind: "process" } : node,
    ),
  });
  const multipleStarts = await flowchart({
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "revise" ? { ...node, kind: "start" } : node,
    ),
  });
  const missingEnd = await flowchart({
    ...base,
    nodes: base.nodes.map((node) =>
      node.kind === "end" ? { ...node, kind: "process" } : node,
    ),
  });
  const startHasIncoming = await flowchart({
    ...base,
    edges: [
      ...base.edges,
      { id: "back-to-start", source: "done", target: "request" },
    ],
  });
  const endHasOutgoing = await flowchart({
    ...base,
    edges: [
      ...base.edges,
      { id: "after-end", source: "done", target: "revise" },
    ],
  });
  const unreachableNode = await flowchart({
    ...base,
    nodes: [
      ...base.nodes,
      { id: "orphan", label: "Orphan outcome", kind: "end" },
    ],
  });
  const nonterminatingNode = await flowchart(nonterminatingSpec());
  const missingOutgoingEdge = await flowchart({
    ...base,
    nodes: [
      ...base.nodes,
      { id: "orphan", label: "Orphan operation", kind: "process" },
    ],
  });
  const underbranchedDecision = await flowchart({
    ...base,
    edges: base.edges.filter(
      (edge) => !(edge.source === "approve" && edge.target === "revise"),
    ),
  });
  const unlabeledDecisionBranch = await flowchart({
    ...base,
    edges: base.edges.map((edge) =>
      edge.source === "approve" ? { ...edge, label: undefined } : edge,
    ),
  });
  const duplicateDecisionBranchLabel = await flowchart({
    ...base,
    edges: base.edges.map((edge) =>
      edge.source === "approve" ? { ...edge, label: "same" } : edge,
    ),
  });
  const flowchartTooLarge = await flowchart(linearSpec(25));
  const disconnectedGraph = await deterministicRuntime().buildMindmap({
    spec: { title: "Single topic", root: { label: "Only root" } },
  });
  const mindmapTooDeep = await deterministicRuntime().buildMindmap({
    spec: deepMindmapSpec(),
  });
  const mindmapTooLarge = await deterministicRuntime().buildMindmap({
    spec: {
      title: "Wide hierarchy",
      root: {
        label: "Root",
        children: Array.from({ length: 101 }, (_, index) => ({
          label: `Topic ${index}`,
        })),
      },
    },
  });
  const genericLabel = await flowchart(
    {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "done" ? { ...node, label: "Step 2" } : node,
      ),
    },
    { minQualityScore: 10 },
  );
  const labelTooLong = await flowchart(
    {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === "done"
          ? {
              ...node,
              label:
                "Publish the fully verified release to every production region",
            }
          : node,
      ),
    },
    { minQualityScore: 10 },
  );
  const qualityBelowThreshold = await flowchart(
    { ...base, title: "Chart" },
    { minQualityScore: 10 },
  );

  renderFailure.set("compatibility render failed");
  const renderFailed = await flowchart(base);
  renderFailure.set(undefined);

  async function controlledExportFailure(
    failure: NonNullable<Parameters<typeof exportFailure.set>[0]>,
  ) {
    exportFailure.set(failure);
    const result = await flowchart(base);
    exportFailure.set(undefined);
    return result;
  }

  const textOverflow = await controlledExportFailure({
    code: "text-overflow",
    elementId: "label:approve",
    message: "Compatibility text does not fit its container.",
  });
  const arrowBindingInvalid = await controlledExportFailure({
    code: "missing-arrow-binding",
    elementId: "edge:edge-1",
    message: "Compatibility arrow binding is missing.",
  });
  const arrowOverlap = await controlledExportFailure({
    code: "overlapping-arrow-segment",
    elementId: "edge:edge-2",
    message: "Compatibility arrow segments overlap.",
  });
  const exportInvalidScene = await controlledExportFailure({
    code: "empty-scene",
    message: "Compatibility Excalidraw scene is empty.",
  });
  const storageReadFailed = await deterministicRuntime({
    store: throwingStore("readManifest"),
  }).getArtifact({ artifactId: "artifact-storage", format: "scene" });
  const storageWriteFailed = await deterministicRuntime({
    store: throwingStore("write"),
  }).buildFlowchart({ spec: base });

  const sceneOnlyRuntime = deterministicRuntime();
  const sceneOnlyBuild = await sceneOnlyRuntime.buildFlowchart({
    spec: base,
    options: { artifactFormats: ["scene"] },
  });
  if (!sceneOnlyBuild.ok) {
    throw new Error("Compatibility scene-only build must be accepted.");
  }
  const unsupportedArtifactFormat = await sceneOnlyRuntime.getArtifact({
    artifactId: sceneOnlyBuild.artifact.artifactId,
    format: "png",
  });
  const patchSourceUnavailable = await deterministicRuntime().applyDiagramPatch(
    {
      source: { artifactId: "artifact-missing" },
      operations: [{ op: "rerouteEdges" }],
    },
  );
  const unknownPatchTarget = await deterministicRuntime().applyDiagramPatch({
    source: { scene: sourceScene },
    operations: [
      {
        op: "setStyle",
        selector: { nodeIds: ["missing-node"] },
        style: { strokeColor: "#7c3aed" },
      },
    ],
  });
  const unsupportedPatchOperation =
    await deterministicRuntime().applyDiagramPatch({
      source: { scene: sourceScene },
      operations: [{ op: "replaceColor" }],
    });
  const brokenScene = structuredClone(sourceScene);
  const brokenArrow = brokenScene.elements.find(
    (element) => element.type === "arrow",
  );
  if (!brokenArrow || brokenArrow.type !== "arrow") {
    throw new Error("Compatibility source scene must contain an arrow.");
  }
  brokenArrow.targetNodeId = "missing-node";
  const patchOutputInvalid = await deterministicRuntime().applyDiagramPatch({
    source: { scene: brokenScene },
    operations: [
      {
        op: "rerouteEdges",
        selector: { edgeIds: [brokenArrow.edgeId] },
      },
    ],
  });

  return {
    missing_field: observeIssue(missingField, "missing_field"),
    invalid_type: observeIssue(invalidType, "invalid_type"),
    invalid_enum: observeIssue(invalidEnum, "invalid_enum"),
    invalid_color: observeIssue(invalidColor, "invalid_color"),
    duplicate_node_id: observeIssue(duplicateNodeId, "duplicate_node_id"),
    duplicate_edge_id: observeIssue(duplicateEdgeId, "duplicate_edge_id"),
    missing_edge_source: observeIssue(missingEdgeSource, "missing_edge_source"),
    missing_edge_target: observeIssue(missingEdgeTarget, "missing_edge_target"),
    self_loop: observeIssue(selfLoop, "self_loop"),
    missing_start: observeIssue(missingStart, "missing_start"),
    multiple_starts: observeIssue(multipleStarts, "multiple_starts"),
    missing_end: observeIssue(missingEnd, "missing_end"),
    start_has_incoming: observeIssue(startHasIncoming, "start_has_incoming"),
    end_has_outgoing: observeIssue(endHasOutgoing, "end_has_outgoing"),
    unreachable_node: observeIssue(unreachableNode, "unreachable_node"),
    nonterminating_node: observeIssue(
      nonterminatingNode,
      "nonterminating_node",
    ),
    missing_outgoing_edge: observeIssue(
      missingOutgoingEdge,
      "missing_outgoing_edge",
    ),
    underbranched_decision: observeIssue(
      underbranchedDecision,
      "underbranched_decision",
    ),
    unlabeled_decision_branch: observeIssue(
      unlabeledDecisionBranch,
      "unlabeled_decision_branch",
    ),
    duplicate_decision_branch_label: observeIssue(
      duplicateDecisionBranchLabel,
      "duplicate_decision_branch_label",
    ),
    disconnected_graph: observeIssue(disconnectedGraph, "disconnected_graph"),
    flowchart_too_large: observeIssue(flowchartTooLarge, "flowchart_too_large"),
    mindmap_too_deep: observeIssue(mindmapTooDeep, "mindmap_too_deep"),
    mindmap_too_large: observeIssue(mindmapTooLarge, "mindmap_too_large"),
    generic_label: observeIssue(genericLabel, "generic_label"),
    label_too_long: observeIssue(labelTooLong, "label_too_long"),
    quality_below_threshold: observeIssue(
      qualityBelowThreshold,
      "quality_below_threshold",
    ),
    render_failed: observeIssue(renderFailed, "render_failed"),
    text_overflow: observeIssue(textOverflow, "text_overflow"),
    arrow_binding_invalid: observeIssue(
      arrowBindingInvalid,
      "arrow_binding_invalid",
    ),
    arrow_overlap: observeIssue(arrowOverlap, "arrow_overlap"),
    export_invalid_scene: observeIssue(
      exportInvalidScene,
      "export_invalid_scene",
    ),
    storage_read_failed: observeIssue(storageReadFailed, "storage_read_failed"),
    storage_write_failed: observeIssue(
      storageWriteFailed,
      "storage_write_failed",
    ),
    unsupported_artifact_format: observeIssue(
      unsupportedArtifactFormat,
      "unsupported_artifact_format",
    ),
    patch_source_unavailable: observeIssue(
      patchSourceUnavailable,
      "patch_source_unavailable",
    ),
    unknown_patch_target: observeIssue(
      unknownPatchTarget,
      "unknown_patch_target",
    ),
    unsupported_patch_operation: observeIssue(
      unsupportedPatchOperation,
      "unsupported_patch_operation",
    ),
    patch_output_invalid: observeIssue(
      patchOutputInvalid,
      "patch_output_invalid",
    ),
  } satisfies Partial<
    Record<CodeModeIssueCode, ReturnType<typeof observeIssue>>
  >;
}

async function buildGoldenCorpus() {
  const bucket = new RecordingBucket();
  const successRuntime = deterministicRuntime({ bucket, renderer: true });
  const build = await successRuntime.buildFlowchart({
    requestId: "flowchart-request",
    spec: approvalSpec(),
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["scene", "excalidraw"],
    },
  });
  if (!build.ok) throw new Error("Golden flowchart build must be accepted.");

  const patch = await successRuntime.applyDiagramPatch({
    requestId: "patch-request",
    source: { artifactId: build.artifact.artifactId },
    intent: "Rename and style the accepted completion node.",
    operations: [
      {
        op: "replaceText",
        selector: { nodeIds: ["done"] },
        text: "Ship to production",
      },
      {
        op: "setStyle",
        selector: { nodeIds: ["done"] },
        style: { fillColor: "#ede9fe", strokeColor: "#7c3aed" },
      },
    ],
    options: {
      artifactFormats: ["scene", "excalidraw", "png"],
      inlineArtifacts: ["scene", "excalidraw"],
      preserveConnectivity: true,
    },
  });
  if (!patch.ok) throw new Error("Golden diagram patch must be accepted.");

  const getScene = await successRuntime.getArtifact({
    artifactId: patch.artifact.artifactId,
    format: "scene",
    inline: true,
  });
  const getExcalidraw = await successRuntime.getArtifact({
    artifactId: patch.artifact.artifactId,
    format: "excalidraw",
    inline: true,
  });
  const getPng = await successRuntime.getArtifact({
    artifactId: patch.artifact.artifactId,
    format: "png",
    inline: true,
  });
  if (!getScene.ok || !getExcalidraw.ok || !getPng.ok) {
    throw new Error("Golden artifact reads must succeed.");
  }
  const sourceScene = RenderedDiagramSceneSchema.parse(getScene.inline);

  const mindmapBucket = new RecordingBucket();
  const mindmap = await deterministicRuntime({
    bucket: mindmapBucket,
  }).buildMindmap(successfulMindmapRequest());
  if (!mindmap.ok) throw new Error("Golden mindmap build must be accepted.");

  const invalidFlowchart = deterministicRuntime();
  const lowQualityFlowchart = deterministicRuntime();
  renderFailure.set("golden flowchart render failed");
  const renderFailedFlowchart = await deterministicRuntime().buildFlowchart({
    spec: approvalSpec(),
  });
  renderFailure.set(undefined);
  renderFailure.set("golden mindmap render failed");
  const renderFailedMindmap = await deterministicRuntime().buildMindmap(
    successfulMindmapRequest(),
  );
  renderFailure.set(undefined);

  const sceneOnlyRuntime = deterministicRuntime();
  const sceneOnlyBuild = await sceneOnlyRuntime.buildFlowchart({
    spec: approvalSpec(),
    options: { artifactFormats: ["scene"] },
  });
  if (!sceneOnlyBuild.ok) {
    throw new Error("Golden scene-only build must be accepted.");
  }

  const brokenScene = structuredClone(sourceScene);
  const brokenArrow = brokenScene.elements.find(
    (element) => element.type === "arrow",
  );
  if (!brokenArrow || brokenArrow.type !== "arrow") {
    throw new Error("Golden source scene must contain an arrow.");
  }
  brokenArrow.targetNodeId = "missing-node";

  return {
    version: 1,
    capturedFrom: {
      effect: "4.0.0-beta.99",
      implementation: "pre-Effect Code Mode Promise runtime",
    },
    publicContract: {
      publicStatusFamilies,
      httpStatusMappings,
      artifactMimeTypes: ARTIFACT_MIME_TYPES,
      mcpVisible: {
        operationOrder: [
          "buildFlowchart",
          "buildMindmap",
          "getArtifact",
          "applyDiagramPatch",
        ],
        patchOperationOrder: DIAGRAM_PATCH_OPERATION_NAMES,
        issueCodeOrder: CodeModeIssueCodeSchema.options,
        schemas: {
          buildFlowchart: z.toJSONSchema(BuildFlowchartRequestSchema),
          buildMindmap: z.toJSONSchema(BuildMindmapRequestSchema),
          getArtifact: z.toJSONSchema(GetArtifactRequestSchema),
          applyDiagramPatch: z.toJSONSchema(ApplyDiagramPatchRequestSchema),
          codeModeIssue: z.toJSONSchema(CodeModeIssueSchema),
          artifactProvenance: z.toJSONSchema(ArtifactProvenanceSchema),
        },
      },
    },
    successes: {
      buildFlowchart: build,
      applyDiagramPatch: patch,
      getArtifact: { scene: getScene, excalidraw: getExcalidraw, png: getPng },
      buildMindmap: mindmap,
    },
    failures: {
      buildFlowchart: {
        invalidInput: await invalidFlowchart.buildFlowchart({
          requestId: "",
          spec: { title: "", nodes: [] },
        }),
        invalidFlowchart: await invalidFlowchart.buildFlowchart({
          requestId: "invalid-flowchart",
          spec: invalidFlowchartSpec(),
        }),
        qualityFailed: await lowQualityFlowchart.buildFlowchart({
          requestId: "quality-flowchart",
          spec: lowQualityFlowchartSpec(),
          options: { minQualityScore: 10 },
        }),
        renderFailed: renderFailedFlowchart,
        exportFailed: await deterministicRuntime().buildFlowchart({
          requestId: "export-flowchart",
          spec: approvalSpec(),
          options: { artifactFormats: ["png"] },
        }),
        storageFailed: await deterministicRuntime({
          store: throwingStore("write"),
        }).buildFlowchart({
          requestId: "storage-flowchart",
          spec: approvalSpec(),
        }),
      },
      buildMindmap: {
        invalidInput: await deterministicRuntime().buildMindmap({
          requestId: "",
          spec: { title: "", root: { label: "" } },
        }),
        invalidMindmap: await deterministicRuntime().buildMindmap({
          requestId: "invalid-mindmap",
          spec: { title: "Single topic", root: { label: "Only root" } },
        }),
        qualityFailed: await deterministicRuntime().buildMindmap({
          requestId: "quality-mindmap",
          spec: {
            title: "Mindmap quality",
            root: { label: "Mindmap", children: [{ label: "Topic" }] },
          },
          options: { minQualityScore: 10 },
        }),
        renderFailed: renderFailedMindmap,
        exportFailed: await deterministicRuntime().buildMindmap({
          ...successfulMindmapRequest(),
          requestId: "export-mindmap",
          options: { artifactFormats: ["png"] },
        }),
        storageFailed: await deterministicRuntime({
          store: throwingStore("write"),
        }).buildMindmap({
          ...successfulMindmapRequest(),
          requestId: "storage-mindmap",
        }),
      },
      getArtifact: {
        invalidInput: await deterministicRuntime().getArtifact({
          artifactId: "",
          format: "svg",
        }),
        notFound: await deterministicRuntime().getArtifact({
          artifactId: "artifact-missing",
          format: "scene",
        }),
        formatUnavailable: await sceneOnlyRuntime.getArtifact({
          artifactId: sceneOnlyBuild.artifact.artifactId,
          format: "png",
        }),
        storageFailed: await deterministicRuntime({
          store: throwingStore("readManifest"),
        }).getArtifact({ artifactId: "artifact-storage", format: "scene" }),
      },
      applyDiagramPatch: {
        invalidInput: await deterministicRuntime().applyDiagramPatch({}),
        sourceUnavailable: await deterministicRuntime().applyDiagramPatch({
          requestId: "missing-source",
          source: { artifactId: "artifact-missing" },
          operations: [{ op: "rerouteEdges" }],
        }),
        targetNotFound: await deterministicRuntime().applyDiagramPatch({
          requestId: "missing-target",
          source: { scene: sourceScene },
          operations: [
            {
              op: "setStyle",
              selector: { nodeIds: ["missing-node"] },
              style: { strokeColor: "#7c3aed" },
            },
          ],
        }),
        unsupportedOperation: await deterministicRuntime().applyDiagramPatch({
          requestId: "unsupported-operation",
          source: { scene: brokenScene },
          operations: [
            {
              op: "rerouteEdges",
              selector: { edgeIds: [brokenArrow.edgeId] },
            },
          ],
        }),
        exportFailed: await deterministicRuntime().applyDiagramPatch({
          requestId: "export-patch",
          source: { scene: sourceScene },
          operations: [
            {
              op: "setStyle",
              selector: { nodeIds: ["done"] },
              style: { strokeColor: "#7c3aed" },
            },
          ],
          options: { artifactFormats: ["png"] },
        }),
        storageFailed: await deterministicRuntime({
          store: throwingStore("write"),
        }).applyDiagramPatch({
          requestId: "storage-patch",
          source: { scene: sourceScene },
          operations: [
            {
              op: "setStyle",
              selector: { nodeIds: ["done"] },
              style: { strokeColor: "#7c3aed" },
            },
          ],
        }),
      },
    },
    persistedEncoding: {
      flowchartAndPatch: persistedObjects(bucket),
      mindmap: persistedObjects(mindmapBucket),
    },
  };
}

afterEach(() => {
  renderFailure.set(undefined);
  exportFailure.set(undefined);
  vi.useRealTimers();
});

describe("pre-Effect Code Mode compatibility corpus", () => {
  it("matches the frozen pre-refactor public and persisted contract", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T12:34:56.789Z"));
    const corpus = await buildGoldenCorpus();
    const fixturePath = new URL(
      "./fixtures/code-mode-compatibility-v1.json",
      import.meta.url,
    ).pathname;
    await expect(`${JSON.stringify(corpus, null, 2)}\n`).toMatchFileSnapshot(
      fixturePath,
    );
  });

  it("matches the expanded exact-base issue behavior matrix", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T12:34:56.789Z"));
    const baseline = await buildGoldenCorpus();
    const sourceGet = baseline.successes.getArtifact.scene;
    if (!sourceGet.ok) {
      throw new Error("Compatibility source artifact must be available.");
    }
    const sourceScene = RenderedDiagramSceneSchema.parse(sourceGet.inline);
    const issueMatrix = await buildIssueCompatibilityMatrix(sourceScene);
    const directlyReachableCodes = Object.keys(issueMatrix);
    const boundaryOnlyCodes = [
      "request_too_large",
      "patch_preserve_connectivity_failed",
    ];
    expect([...directlyReachableCodes, ...boundaryOnlyCodes].sort()).toEqual(
      [...CodeModeIssueCodeSchema.options].sort(),
    );

    const corpus = {
      version: 2,
      lineage: {
        exactBase: "486e7169255354b8dc79cfa86e30c508721f5425",
        previousFixture:
          "code-mode-compatibility-v1.json@c668b53ee90043a06c640d06cc28253496d50e7431c916b523fcd4157b91ae55",
        captureRule:
          "Added expectations were generated only by the exact-base Promise implementation.",
      },
      issueMatrix,
      ordering: {
        invalidFlowchart: baseline.failures.buildFlowchart.invalidFlowchart,
        invalidInput: baseline.failures.buildFlowchart.invalidInput,
      },
      persistedEncoding: baseline.persistedEncoding,
    };
    const fixturePath = new URL(
      "./fixtures/code-mode-compatibility-v2.json",
      import.meta.url,
    ).pathname;
    await expect(`${JSON.stringify(corpus, null, 2)}\n`).toMatchFileSnapshot(
      fixturePath,
    );
  });
});
