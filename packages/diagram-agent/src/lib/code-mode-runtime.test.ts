import { describe, expect, it } from "vitest";

import {
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
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

function parseInlineScene(value: unknown) {
  return RenderedDiagramSceneSchema.parse(value);
}

class MemoryBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, string>();

  async get(key: string): Promise<CodeModeObjectBucketObject | null> {
    const value = this.objects.get(key);
    if (!value) {
      return null;
    }
    return {
      size: new TextEncoder().encode(value).length,
      text: async () => value,
    };
  }

  async put(key: string, value: string): Promise<unknown> {
    this.objects.set(key, value);
    return null;
  }
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
    expect(excalidraw.inline).toMatchObject({
      appState: expect.any(Object),
      elements: expect.any(Array),
    });
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

  it("keeps PNG out of the public artifact format contract", async () => {
    const runtime = createTestRuntime();
    const result = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: { artifactFormats: ["png"] },
    });

    expectBuildFailure(result);
    expect(result.status).toBe("invalid_input");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid_enum",
        ref: { kind: "request", path: "options.artifactFormats.[0]" },
      }),
    );
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
    });

    expectGetOk(scene);
    expect(parseInlineScene(scene.inline).diagramId).toBe(
      "simple-approval-flow",
    );
  });
});
