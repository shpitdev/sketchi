import { describe, expect, it } from "vitest";

import {
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
  type CodeModeArtifactStore,
  type CodeModeObjectBucket,
  type CodeModeObjectBucketObject,
} from "./code-mode-artifacts";
import {
  RenderedDiagramSceneSchema,
  type ApplyDiagramPatchResult,
  type BuildFlowchartResult,
  type GetArtifactResult,
} from "./code-mode-contract";
import { createCodeModeRuntime } from "./code-mode-runtime";

function createTestRuntime() {
  let id = 0;
  return createCodeModeRuntime({
    store: createMemoryArtifactStore(),
    createId: (prefix) => `${prefix}-${(id += 1)}`,
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

function incidentEscalationOpsSpec() {
  return {
    id: "incident-escalation-ops",
    title: "Incident Escalation & Operations Response",
    nodes: [
      { id: "alert_received", label: "Alert Received", kind: "start" },
      { id: "triage", label: "Triage & Deduplicate", kind: "process" },
      { id: "is_actionable", label: "Actionable Signal?", kind: "decision" },
      { id: "auto_close", label: "Auto-Close / Suppress", kind: "end" },
      { id: "severity", label: "Assess Severity", kind: "decision" },
      { id: "sev1_page", label: "Page On-Call (SEV1)", kind: "process" },
      { id: "sev2_assign", label: "Assign Owner (SEV2)", kind: "process" },
      { id: "sev3_queue", label: "Queue Backlog (SEV3)", kind: "process" },
      { id: "incident_bridge", label: "Open Incident Bridge", kind: "process" },
      { id: "investigate", label: "Investigate Root Cause", kind: "process" },
      { id: "mitigated", label: "Mitigated?", kind: "decision" },
      { id: "reassess", label: "Reassess Severity", kind: "process" },
      { id: "comms", label: "Notify Stakeholders", kind: "process" },
      { id: "monitor", label: "Stable After Monitoring?", kind: "decision" },
      { id: "postmortem", label: "Write Postmortem", kind: "process" },
      { id: "resolved", label: "Incident Resolved", kind: "end" },
    ],
    edges: [
      { source: "alert_received", target: "triage" },
      { source: "triage", target: "is_actionable" },
      { source: "is_actionable", target: "auto_close", label: "no" },
      { source: "is_actionable", target: "severity", label: "yes" },
      { source: "severity", target: "sev1_page", label: "SEV1" },
      { source: "severity", target: "sev2_assign", label: "SEV2" },
      { source: "severity", target: "sev3_queue", label: "SEV3" },
      { source: "sev1_page", target: "incident_bridge" },
      { source: "sev2_assign", target: "incident_bridge" },
      { source: "incident_bridge", target: "investigate" },
      { source: "sev3_queue", target: "investigate" },
      { source: "investigate", target: "mitigated" },
      { source: "mitigated", target: "comms", label: "yes" },
      { source: "mitigated", target: "reassess", label: "no" },
      { source: "reassess", target: "severity", label: "re-triage" },
      { source: "comms", target: "monitor" },
      { source: "monitor", target: "postmortem", label: "stable" },
      { source: "monitor", target: "investigate", label: "regressed" },
      { source: "postmortem", target: "resolved" },
    ],
    layout: { direction: "TB" },
  };
}

function expectBuildOk(
  result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected build success: ${JSON.stringify(result.issues)}`);
  }
}

function expectBuildFailure(
  result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected build failure.");
  }
}

function expectGetOk(
  result: GetArtifactResult,
): asserts result is Extract<GetArtifactResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected get success: ${JSON.stringify(result.issues)}`);
  }
}

function expectPatchOk(
  result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected patch success: ${JSON.stringify(result.issues)}`);
  }
  expect(result.ok).toBe(true);
}

function expectPatchFailure(
  result: ApplyDiagramPatchResult,
): asserts result is Extract<ApplyDiagramPatchResult, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected patch failure.");
  }
}

function throwingStore(): CodeModeArtifactStore {
  return {
    read: async () => {
      throw new Error("bucket read failed");
    },
    readManifest: async () => {
      throw new Error("manifest read failed");
    },
    write: async () => {
      throw new Error("bucket write failed");
    },
  };
}

function parseInlineScene(value: unknown) {
  return RenderedDiagramSceneSchema.parse(value);
}

class MemoryBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, string | Uint8Array>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (!value) {
      return null;
    }
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    return {
      size: bytes.byteLength,
      arrayBuffer: async () => toArrayBuffer(bytes),
      text: async () =>
        typeof value === "string" ? value : new TextDecoder().decode(value),
    };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
  ): Promise<unknown> {
    this.objects.set(
      key,
      typeof value === "string" ? value : new Uint8Array(value),
    );
    return null;
  }
}

class FailingPngBucket extends MemoryBucket {
  override async put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
  ): Promise<unknown> {
    if (key.endsWith("/png.png")) {
      throw new Error("png write failed");
    }

    return super.put(key, value);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("Code Mode runtime", () => {
  it("builds an accepted flowchart and retrieves stored formats", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({
      requestId: "request-1",
      spec: approvalSpec(),
    });

    expectBuildOk(built);
    expect(built.status).toBe("accepted");
    expect(built.requestId).toBe("request-1");
    expect(built.normalizedSpec.style).toEqual({
      accentColor: "#000000",
      backgroundColor: "#ffffff",
    });
    expect(built.artifact.formats.map((format) => format.format)).toEqual([
      "excalidraw",
      "scene",
    ]);

    const inlineScene = built.artifact.formats.find(
      (format) => format.format === "scene",
    )?.inline;
    expect(parseInlineScene(inlineScene).elements.length).toBeGreaterThan(0);

    const excalidraw = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "excalidraw",
    });

    expectGetOk(excalidraw);
    expect(excalidraw.mimeType).toBe("application/vnd.excalidraw+json");
    expect(excalidraw).not.toHaveProperty("inline");

    const inlineExcalidraw = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "excalidraw",
      inline: true,
    });

    expectGetOk(inlineExcalidraw);
    expect(inlineExcalidraw.inline).toMatchObject({
      appState: expect.any(Object),
      elements: expect.any(Array),
    });
  });

  it("exports dense incident feedback flows without edge-through-node routes", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({
      spec: incidentEscalationOpsSpec(),
      options: {
        artifactFormats: ["scene", "excalidraw"],
        inlineArtifacts: ["scene", "excalidraw"],
      },
    });

    expectBuildOk(built);
    expect(built.quality.summary).toEqual({ nodeCount: 16, edgeCount: 19 });
    expect(built.artifact.formats.map((format) => format.format)).toEqual([
      "scene",
      "excalidraw",
    ]);
  });

  it("returns structured repair issues for invalid connectivity", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({
      spec: {
        ...approvalSpec(),
        edges: [{ source: "request", target: "approve" }],
      },
    });

    expectBuildFailure(built);
    expect(built.status).toBe("invalid_flowchart");
    expect(built.issues).toContainEqual(
      expect.objectContaining({
        code: "underbranched_decision",
        ref: expect.objectContaining({ id: "approve" }),
      }),
    );
    expect(built.issues).toContainEqual(
      expect.objectContaining({
        code: "unreachable_node",
        ref: expect.objectContaining({ id: "done" }),
      }),
    );
  });

  it("returns invalid input issues for malformed artifact requests", async () => {
    const runtime = createTestRuntime();
    const result = await runtime.getArtifact({
      artifactId: "",
      format: "svg",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected get failure.");
    }
    expect(result.status).toBe("invalid_input");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ stage: "input" }),
    );
  });

  it("reports PNG export failure when no hosted renderer is configured", async () => {
    const runtime = createTestRuntime();
    const result = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: { artifactFormats: ["png"] },
    });

    expectBuildFailure(result);
    expect(result.status).toBe("export_failed");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "render_failed",
        message: "PNG artifact rendering is not configured for this runtime.",
      }),
    );
  });

  it("stores PNG artifacts through a configured renderer without inlining binary data", async () => {
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createMemoryArtifactStore(),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      renderer: {
        renderPng: async () => new Uint8Array([137, 80, 78, 71]),
      },
    });

    const built = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: {
        artifactFormats: ["scene", "png"],
        inlineArtifacts: ["scene"],
      },
    });

    expectBuildOk(built);
    expect(built.artifact.formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: "scene",
          inline: expect.any(Object),
        }),
        expect.objectContaining({
          format: "png",
          mimeType: "image/png",
          sizeBytes: 4,
        }),
      ]),
    );
    expect(
      built.artifact.formats.find((format) => format.format === "png"),
    ).not.toHaveProperty("inline");

    const png = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "png",
    });

    expectGetOk(png);
    expect(png).toMatchObject({
      format: "png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(png).not.toHaveProperty("inline");

    const explicitInlinePng = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "png",
      inline: true,
    });

    expectGetOk(explicitInlinePng);
    expect(explicitInlinePng).toMatchObject({
      format: "png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(explicitInlinePng).not.toHaveProperty("inline");
  });

  it("rejects raw Excalidraw patch sources at the request contract", async () => {
    const runtime = createTestRuntime();
    const result = await runtime.applyDiagramPatch({
      source: { excalidraw: { appState: {}, elements: [] } },
      operations: [{ op: "rerouteEdges" }],
    });

    expectPatchFailure(result);
    expect(result.status).toBe("invalid_input");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ path: "source" }),
      }),
    );
  });

  it("patches styling after the graph artifact is accepted", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      intent:
        "Make the approval decision purple after connectivity is accepted.",
      operations: [
        {
          op: "setStyle",
          selector: { nodeIds: ["approve"] },
          style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
        },
        {
          op: "setShape",
          selector: { nodeIds: ["approve"] },
          shape: "diamond",
        },
      ],
    });

    expectPatchOk(patched);
    expect(patched.sourceArtifactId).toBe(built.artifact.artifactId);

    const patchedScene = patched.artifact.formats.find(
      (format) => format.format === "scene",
    )?.inline;
    const scene = parseInlineScene(patchedScene);
    const approvalNode = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "approve",
    );

    expect(approvalNode).toMatchObject({
      shape: "diamond",
      strokeColor: "#7c3aed",
      fillColor: "#ede9fe",
    });
    expect(
      scene.elements
        .filter((element) => element.type === "arrow")
        .map((arrow) => `${arrow.sourceNodeId}->${arrow.targetNodeId}`)
        .sort(),
    ).toEqual(["approve->done", "approve->revise", "request->approve"]);
  });

  it("renders PNG artifacts after patch operations when a renderer is configured", async () => {
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createMemoryArtifactStore(),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      renderer: {
        renderPng: async ({ scene }) =>
          new Uint8Array([137, 80, 78, 71, scene.elements.length]),
      },
    });
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "setShape",
          selector: { nodeIds: ["approve"] },
          shape: "diamond",
        },
      ],
      options: {
        artifactFormats: ["scene", "png"],
        inlineArtifacts: ["scene"],
      },
    });

    expectPatchOk(patched);
    expect(patched.artifact.formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: "scene",
          inline: expect.any(Object),
        }),
        expect.objectContaining({
          format: "png",
          mimeType: "image/png",
          sizeBytes: 5,
        }),
      ]),
    );
    expect(
      patched.artifact.formats.find((format) => format.format === "png"),
    ).not.toHaveProperty("inline");
  });

  it("keeps scoped edge style patches from recoloring node labels", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "setStyle",
          selector: { scope: "edges" },
          style: { strokeColor: "#7c3aed", textColor: "#7c3aed" },
        },
      ],
    });

    expectPatchOk(patched);
    const scene = parseInlineScene(
      patched.artifact.formats.find((format) => format.format === "scene")
        ?.inline,
    );

    expect(
      scene.elements
        .filter((element) => element.type === "text")
        .map((text) => text.textColor),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(
      scene.elements
        .filter((element) => element.type === "arrow")
        .map((arrow) => arrow.strokeColor),
    ).toEqual(["#7c3aed", "#7c3aed", "#7c3aed"]);
  });

  it("rejects patch selectors that do not match the accepted artifact", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "setStyle",
          selector: { nodeIds: ["missing-node"] },
          style: { strokeColor: "#7c3aed" },
        },
      ],
    });

    expectPatchFailure(patched);
    expect(patched.status).toBe("target_not_found");
    expect(patched.issues).toContainEqual(
      expect.objectContaining({ code: "unknown_patch_target" }),
    );
  });

  it("enumerates supported patch operations when the op name is invalid", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "setText",
          selector: { nodeIds: ["done"] },
          text: "Ship to production",
        },
      ],
    });

    expectPatchFailure(patched);
    expect(patched.status).toBe("invalid_input");
    expect(patched.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported_patch_operation",
        ref: { kind: "request", path: "operations.[0].op" },
        hint: expect.stringContaining("replaceText"),
      }),
    );
  });

  it("uses replaceText to update accepted node labels", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "replaceText",
          selector: { nodeIds: ["done"] },
          text: "Ship to production",
        },
      ],
    });

    expectPatchOk(patched);
    const scene = parseInlineScene(
      patched.artifact.formats.find((format) => format.format === "scene")
        ?.inline,
    );

    expect(scene.elements).toContainEqual(
      expect.objectContaining({
        type: "node",
        nodeId: "done",
        label: "Ship to production",
      }),
    );
    expect(scene.elements).toContainEqual(
      expect.objectContaining({
        type: "text",
        containerId: expect.stringContaining("done"),
        text: "Ship to production",
      }),
    );
  });

  it("returns structured storage failures when artifact reads throw", async () => {
    const runtime = createCodeModeRuntime({
      store: throwingStore(),
      createId: (prefix) => `${prefix}-1`,
    });

    const artifact = await runtime.getArtifact({
      artifactId: "artifact-1",
      format: "scene",
    });

    expect(artifact.ok).toBe(false);
    if (artifact.ok) {
      throw new Error("Expected get failure.");
    }
    expect(artifact.status).toBe("storage_failed");
    expect(artifact.issues).toContainEqual(
      expect.objectContaining({
        code: "storage_read_failed",
        message: "manifest read failed",
      }),
    );

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: "artifact-1" },
      operations: [{ op: "rerouteEdges" }],
    });

    expectPatchFailure(patched);
    expect(patched.status).toBe("storage_failed");
    expect(patched.issues).toContainEqual(
      expect.objectContaining({
        code: "storage_read_failed",
        message: "bucket read failed",
      }),
    );
  });

  it("stores and retrieves artifacts through an object-bucket adapter", async () => {
    const bucket = new MemoryBucket();
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createObjectBucketArtifactStore(bucket, {
        prefix: "codemode",
      }),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
    });

    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    expect([...bucket.objects.keys()].sort()).toEqual([
      "codemode/artifact-2/excalidraw.json",
      "codemode/artifact-2/manifest.json",
      "codemode/artifact-2/scene.json",
    ]);

    const scene = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "scene",
      inline: true,
    });

    expectGetOk(scene);
    expect(parseInlineScene(scene.inline).diagramId).toBe(
      "simple-approval-flow",
    );
  });

  it("persists PNG artifacts as binary object-bucket entries", async () => {
    const bucket = new MemoryBucket();
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createObjectBucketArtifactStore(bucket, {
        prefix: "codemode",
      }),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      renderer: {
        renderPng: async () => new Uint8Array([137, 80, 78, 71]),
      },
    });

    const built = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: { artifactFormats: ["scene", "png"] },
    });
    expectBuildOk(built);

    expect([...bucket.objects.keys()].sort()).toEqual([
      "codemode/artifact-2/manifest.json",
      "codemode/artifact-2/png.png",
      "codemode/artifact-2/scene.json",
    ]);

    const png = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "png",
    });

    expectGetOk(png);
    expect(png).toMatchObject({
      format: "png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(png).not.toHaveProperty("inline");
  });

  it("does not publish an object-bucket manifest when a format write fails", async () => {
    const bucket = new FailingPngBucket();
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createObjectBucketArtifactStore(bucket, {
        prefix: "codemode",
      }),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      renderer: {
        renderPng: async () => new Uint8Array([137, 80, 78, 71]),
      },
    });

    const built = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: { artifactFormats: ["scene", "png"] },
    });

    expectBuildFailure(built);
    expect(built.status).toBe("storage_failed");
    expect([...bucket.objects.keys()].sort()).toEqual([
      "codemode/artifact-2/scene.json",
    ]);
  });
});
