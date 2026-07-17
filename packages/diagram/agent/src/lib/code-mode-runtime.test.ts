import { describe, expect, it } from "vitest";

import {
  FLOWCHART_MAX_EDGES,
  FLOWCHART_MAX_ISSUES,
  FLOWCHART_MAX_NODES,
  FlowchartDiagramSchema,
  getFlowchartValidationIssues,
} from "@sketchi/diagram-core";
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
  type ArtifactFormat,
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

function linearFlowchartSpec(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    label: `Concrete operation ${index}`,
    kind: index === 0 ? "start" : index === nodeCount - 1 ? "end" : "process",
  }));
  return {
    title: `Linear flow with ${nodeCount} nodes`,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      source: node.id,
      target: nodes[index + 1]?.id,
    })),
  };
}

function denseAcyclicFlowchartSpec(edgeCount: number) {
  const spec = linearFlowchartSpec(FLOWCHART_MAX_NODES);
  const chainKeys = new Set(
    spec.edges.map((edge) => `${edge.source}->${edge.target}`),
  );
  const extraEdges = spec.nodes.flatMap((source, sourceIndex) =>
    spec.nodes.slice(sourceIndex + 1).flatMap((target, targetOffset) => {
      const key = `${source.id}->${target.id}`;
      return chainKeys.has(key)
        ? []
        : [
            {
              source: source.id,
              target: target.id,
              id: `extra-${sourceIndex}-${sourceIndex + targetOffset + 1}`,
            },
          ];
    }),
  );
  return {
    ...spec,
    edges: [...spec.edges, ...extraEdges].slice(0, edgeCount),
  };
}

function whitespaceFlowchartCases(): Array<{
  name: string;
  path: string;
  spec: unknown;
}> {
  const base = linearFlowchartSpec(3);
  const processNodeId = base.nodes[1]?.id ?? "node-1";
  return [
    {
      name: "title",
      path: "spec.title",
      spec: { ...base, title: "   " },
    },
    {
      name: "node label",
      path: "spec.nodes.[1].label",
      spec: {
        ...base,
        nodes: base.nodes.map((node, index) =>
          index === 1 ? { ...node, label: "   " } : node,
        ),
      },
    },
    {
      name: "node id",
      path: "spec.nodes.[1].id",
      spec: {
        ...base,
        nodes: base.nodes.map((node, index) =>
          index === 1 ? { ...node, id: "   " } : node,
        ),
        edges: base.edges.map((edge) => ({
          ...edge,
          source: edge.source === processNodeId ? "   " : edge.source,
          target: edge.target === processNodeId ? "   " : edge.target,
        })),
      },
    },
    {
      name: "optional node description",
      path: "spec.nodes.[1].description",
      spec: {
        ...base,
        nodes: base.nodes.map((node, index) =>
          index === 1 ? { ...node, description: "   " } : node,
        ),
      },
    },
  ];
}

function canonicalCodesForSpec(spec: ReturnType<typeof approvalSpec>) {
  const diagram = FlowchartDiagramSchema.parse({
    id: "canonical-parity",
    title: spec.title,
    type: "flowchart",
    nodes: spec.nodes,
    edges: spec.edges.map((edge, index) => ({
      ...edge,
      id: `edge-${index + 1}`,
    })),
  });
  return getFlowchartValidationIssues(diagram).map((issue) => issue.code);
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

function productionReleaseRollbackSpec() {
  return {
    id: "production-release-incident-response-rollback",
    title: "Production Release Incident Response Rollback Flow",
    nodes: [
      { id: "start", label: "Start", kind: "start" },
      { id: "ci_build", label: "CI Build", kind: "process" },
      { id: "ci_gate", label: "CI Gate", kind: "decision" },
      { id: "security_scan", label: "Security Scan", kind: "process" },
      { id: "scan_gate", label: "Scan Gate", kind: "decision" },
      { id: "vuln_gate", label: "Vuln Gate", kind: "decision" },
      { id: "deploy_staging", label: "Deploy Staging", kind: "process" },
      { id: "smoke_staging", label: "Smoke Staging", kind: "process" },
      { id: "staging_gate", label: "Staging Gate", kind: "decision" },
      { id: "fix_code", label: "Fix Code", kind: "process" },
      { id: "canary_deploy", label: "Canary Deploy", kind: "process" },
      { id: "canary_gate", label: "Canary Gate", kind: "decision" },
      { id: "full_rollout", label: "Full Rollout", kind: "process" },
      { id: "monitor", label: "Monitor", kind: "process" },
      { id: "incident_gate", label: "Incident Gate", kind: "decision" },
      { id: "severity_gate", label: "Severity Gate", kind: "decision" },
      { id: "page_oncall", label: "Page Oncall", kind: "process" },
      { id: "mitigate", label: "Mitigate", kind: "process" },
      { id: "mitigation_gate", label: "Mitigation Gate", kind: "decision" },
      { id: "rollback", label: "Rollback", kind: "process" },
      { id: "rollback_gate", label: "Rollback Gate", kind: "decision" },
      { id: "manual_recovery", label: "Manual Recovery", kind: "process" },
      { id: "postmortem", label: "Postmortem", kind: "process" },
      { id: "done", label: "Done", kind: "end" },
    ],
    edges: [
      { source: "start", target: "ci_build", label: "trigger" },
      { source: "ci_build", target: "ci_gate", label: "tests done" },
      { source: "ci_gate", target: "security_scan", label: "green" },
      { source: "ci_gate", target: "fix_code", label: "red" },
      { source: "fix_code", target: "ci_build", label: "rebuild" },
      { source: "security_scan", target: "scan_gate", label: "scan" },
      { source: "scan_gate", target: "deploy_staging", label: "clean" },
      { source: "scan_gate", target: "vuln_gate", label: "vulns" },
      { source: "vuln_gate", target: "done", label: "abort" },
      { source: "vuln_gate", target: "fix_code", label: "patch" },
      { source: "deploy_staging", target: "smoke_staging", label: "deploy" },
      { source: "smoke_staging", target: "staging_gate", label: "verify" },
      { source: "staging_gate", target: "canary_deploy", label: "healthy" },
      { source: "staging_gate", target: "fix_code", label: "failed" },
      {
        source: "canary_deploy",
        target: "canary_gate",
        label: "5 percent",
      },
      { source: "canary_gate", target: "full_rollout", label: "ok" },
      { source: "canary_gate", target: "rollback", label: "regression" },
      { source: "full_rollout", target: "monitor", label: "observe" },
      { source: "monitor", target: "incident_gate", label: "signals" },
      { source: "incident_gate", target: "done", label: "stable" },
      { source: "incident_gate", target: "severity_gate", label: "incident" },
      { source: "severity_gate", target: "page_oncall", label: "sev1" },
      { source: "severity_gate", target: "mitigate", label: "low sev" },
      { source: "page_oncall", target: "mitigate", label: "triage" },
      { source: "mitigate", target: "mitigation_gate", label: "mitigate" },
      { source: "mitigation_gate", target: "monitor", label: "worked" },
      { source: "mitigation_gate", target: "rollback", label: "missed SLA" },
      { source: "rollback", target: "rollback_gate", label: "rollback" },
      { source: "rollback_gate", target: "postmortem", label: "restored" },
      {
        source: "rollback_gate",
        target: "manual_recovery",
        label: "still failing",
      },
      {
        source: "manual_recovery",
        target: "rollback_gate",
        label: "re-verify",
      },
      { source: "postmortem", target: "done", label: "closed" },
    ],
    layout: { direction: "TB" },
  };
}

function expectBuildOk(
  result: BuildFlowchartResult,
): asserts result is Extract<BuildFlowchartResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected build success: ${JSON.stringify(result.issues)}`);
  }
  expect(result.ok).toBe(true);
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
  it("builds a nested mindmap with deterministic hierarchy ids and exports", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildMindmap({
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
    });
    expect(built).toMatchObject({
      ok: true,
      status: "accepted",
      requestId: "mindmap-request",
      normalizedSpec: {
        id: "launch-strategy",
        root: {
          id: "topic-0",
          children: [
            {
              id: "topic-0-0",
              children: [{ id: "topic-0-0-0" }, { id: "topic-0-0-1" }],
            },
            { id: "topic-0-1" },
          ],
        },
      },
    });
    if (!built.ok) throw new Error("Expected accepted mindmap");
    expect(built.artifact.formats.map((format) => format.format)).toEqual([
      "excalidraw",
      "scene",
    ]);
  });

  it("returns typed mindmap hierarchy failures", async () => {
    const result = await createTestRuntime().buildMindmap({
      spec: { title: "Empty", root: { label: "Only root" } },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "invalid_mindmap",
      issues: [{ code: "disconnected_graph", stage: "mindmap" }],
    });
  });

  it("preflights extreme mindmap depth before recursive schema decoding", async () => {
    const root: { label: string; children?: unknown[] } = { label: "root" };
    let current = root;
    for (let depth = 0; depth < 2_000; depth += 1) {
      const child: { label: string; children?: unknown[] } = {
        label: `depth ${depth}`,
      };
      current.children = [child];
      current = child;
    }
    const result = await createTestRuntime().buildMindmap({
      spec: { title: "Deep", root },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "invalid_mindmap",
      issues: [{ code: "mindmap_too_deep", stage: "mindmap" }],
    });
  });

  it("preflights overly wide mindmaps", async () => {
    const result = await createTestRuntime().buildMindmap({
      spec: {
        title: "Wide",
        root: {
          label: "root",
          children: Array.from({ length: 101 }, (_, index) => ({
            label: `topic ${index}`,
          })),
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "invalid_mindmap",
      issues: [{ code: "mindmap_too_large" }],
    });
  });

  it("counts malformed child slots and keeps extreme-width failures bounded", async () => {
    const result = await createTestRuntime().buildMindmap({
      spec: {
        title: "Malformed width",
        root: {
          label: "root",
          children: Array.from({ length: 100_000 }, () => null),
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "invalid_mindmap",
      issues: [{ code: "mindmap_too_large" }],
    });
    expect(result.issues).toHaveLength(1);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });

  it("caps schema issue amplification for every Code Mode operation", async () => {
    const result = await createTestRuntime().buildFlowchart({
      spec: {
        title: "Malformed",
        nodes: Array.from({ length: 1_000 }, () => ({})),
      },
    });
    expect(result).toMatchObject({ ok: false, status: "invalid_input" });
    expect(result.issues).toHaveLength(21);
    expect(result.issues.at(-1)?.message).toContain(
      "additional input issues were omitted",
    );
  });

  it.each([
    [
      "title",
      { title: "  ", root: { label: "Root", children: [{ label: "Child" }] } },
      "spec.title",
    ],
    [
      "topic",
      { title: "Valid", root: { label: "Root", children: [{ label: "''" }] } },
      "spec.root.children.[0].label",
    ],
    [
      "tool-cleaned topic",
      {
        title: "Valid",
        root: { label: "Root", children: [{ label: " , title:" }] },
      },
      "spec.root.children.[0].label",
    ],
  ])(
    "returns precise invalid_input paths for empty semantic %s strings",
    async (_name, spec, path) => {
      const result = await createTestRuntime().buildMindmap({ spec });
      expect(result).toMatchObject({
        ok: false,
        status: "invalid_input",
        issues: [{ stage: "input", ref: { path } }],
      });
    },
  );

  it("renders and exports right-to-left mindmaps", async () => {
    const result = await createTestRuntime().buildMindmap({
      spec: {
        title: "RTL hierarchy",
        layout: { direction: "RL" },
        root: {
          label: "Root",
          children: [{ label: "Child", children: [{ label: "Leaf" }] }],
        },
      },
      options: { inlineArtifacts: ["scene", "excalidraw"] },
    });
    expect(result).toMatchObject({
      ok: true,
      normalizedSpec: { layout: { direction: "RL" } },
    });
    if (!result.ok) throw new Error("Expected accepted RL mindmap");
    const scene = parseInlineScene(
      result.artifact.formats.find((format) => format.format === "scene")
        ?.inline,
    );
    const nodes = scene.elements.filter((element) => element.type === "node");
    const root = nodes.find((node) => node.nodeId === "topic-0");
    const child = nodes.find((node) => node.nodeId === "topic-0-0");
    expect(root?.x).toBeGreaterThan(child?.x ?? Number.POSITIVE_INFINITY);
    expect(
      result.artifact.formats.find((format) => format.format === "excalidraw")
        ?.inline,
    ).toBeDefined();
  });

  it("round-trips a persisted mindmap through getArtifact and patch retrieval", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildMindmap({
      spec: {
        title: "Roadmap",
        root: {
          label: "Roadmap",
          children: [{ label: "Now" }, { label: "Next" }],
        },
      },
    });
    if (!built.ok) throw new Error("Expected accepted mindmap");
    const persisted = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "scene",
      inline: true,
    });
    expect(persisted).toMatchObject({ ok: true, diagramId: "roadmap" });
    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: built.artifact.artifactId },
      operations: [
        {
          op: "replaceText",
          selector: { nodeIds: ["topic-0-1"] },
          text: "Later",
        },
      ],
    });
    if (!patched.ok) throw new Error("Expected accepted mindmap patch");
    const retrieved = await runtime.getArtifact({
      artifactId: patched.artifact.artifactId,
      format: "scene",
      inline: true,
    });
    expect(retrieved).toMatchObject({
      ok: true,
      provenance: { sourceArtifactId: built.artifact.artifactId },
    });
    expect(JSON.stringify(retrieved)).toContain("Later");
  });
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
      type: "excalidraw",
      version: 2,
      source: "https://sketchi.app",
      appState: expect.any(Object),
      elements: expect.any(Array),
      files: {},
    });
  });

  it("adds raw artifact URLs when the runtime is configured with a URL builder", async () => {
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createMemoryArtifactStore(),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      artifactUrl: ({ artifactId, format }) =>
        `https://studio.test/api/v1/artifacts/${artifactId}?format=${format}&raw=true`,
    });

    const built = await runtime.buildFlowchart({
      spec: approvalSpec(),
      options: {
        artifactFormats: ["scene", "excalidraw"],
        inlineArtifacts: ["scene"],
      },
    });

    expectBuildOk(built);
    expect(built.artifact.formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: "scene",
          url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=scene&raw=true`,
        }),
        expect.objectContaining({
          format: "excalidraw",
          url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=excalidraw&raw=true`,
        }),
      ]),
    );

    const excalidraw = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "excalidraw",
      inline: true,
    });

    expectGetOk(excalidraw);
    expect(excalidraw).toMatchObject({
      format: "excalidraw",
      url: `https://studio.test/api/v1/artifacts/${built.artifact.artifactId}?format=excalidraw&raw=true`,
      inline: {
        type: "excalidraw",
        version: 2,
        files: {},
      },
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

  it("exports production release rollback flows without dense route collisions", async () => {
    const runtime = createTestRuntime();
    const built = await runtime.buildFlowchart({
      spec: productionReleaseRollbackSpec(),
      options: {
        artifactFormats: ["scene", "excalidraw"],
        inlineArtifacts: ["scene", "excalidraw"],
      },
    });

    expectBuildOk(built);
    expect(built.quality.summary).toEqual({ nodeCount: 24, edgeCount: 32 });
    expect(built.artifact.formats.map((format) => format.format)).toEqual([
      "scene",
      "excalidraw",
    ]);
  });

  it("keeps missing start and end failures in parity with diagram-core", async () => {
    const specs = [
      {
        expected: "missing_start",
        spec: {
          ...approvalSpec(),
          nodes: approvalSpec().nodes.map((node) =>
            node.kind === "start" ? { ...node, kind: "process" } : node,
          ),
        },
      },
      {
        expected: "missing_end",
        spec: {
          ...approvalSpec(),
          nodes: approvalSpec().nodes.map((node) =>
            node.kind === "end" ? { ...node, kind: "process" } : node,
          ),
        },
      },
    ];

    for (const { expected, spec } of specs) {
      const canonicalCodes = canonicalCodesForSpec(spec);
      const result = await createTestRuntime().buildFlowchart({ spec });
      expectBuildFailure(result);
      expect(result.status).toBe("invalid_flowchart");
      expect(result.issues.map((issue) => issue.code)).toEqual(canonicalCodes);
      expect(canonicalCodes).toContain(expected);
    }
  });

  it.each(whitespaceFlowchartCases())(
    "rejects whitespace-only $name after normalization as a bounded flowchart failure",
    async ({ spec, path }) => {
      const result = await createTestRuntime().buildFlowchart({ spec });
      expectBuildFailure(result);

      expect(result.status).toBe("invalid_flowchart");
      expect(result.issues.length).toBeLessThanOrEqual(FLOWCHART_MAX_ISSUES);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          stage: "flowchart",
          ref: expect.objectContaining({ path }),
        }),
      );
      expect(result.issues.map((entry) => entry.code)).not.toContain(
        "render_failed",
      );
    },
  );

  it("caps normalized flowchart schema failures deterministically", async () => {
    const base = linearFlowchartSpec(FLOWCHART_MAX_NODES);
    const spec = {
      ...base,
      nodes: base.nodes.map((node) => ({ ...node, label: "   " })),
    };
    const first = await createTestRuntime().buildFlowchart({ spec });
    const second = await createTestRuntime().buildFlowchart({ spec });
    expectBuildFailure(first);
    expectBuildFailure(second);

    expect(first.status).toBe("invalid_flowchart");
    expect(first.issues).toHaveLength(FLOWCHART_MAX_ISSUES);
    expect(second.issues).toEqual(first.issues);
  });

  it("rejects a reachable closed cycle with typed nonterminating nodes", async () => {
    const result = await createTestRuntime().buildFlowchart({
      spec: {
        title: "Closed retry cycle",
        nodes: [
          { id: "start", label: "Request arrives", kind: "start" },
          { id: "route", label: "Ready?", kind: "decision" },
          { id: "done", label: "Completed", kind: "end" },
          { id: "retry-a", label: "Retry stage alpha", kind: "process" },
          { id: "retry-b", label: "Retry stage beta", kind: "process" },
        ],
        edges: [
          { source: "start", target: "route" },
          { source: "route", target: "done", label: "yes" },
          { source: "route", target: "retry-a", label: "retry" },
          { source: "retry-a", target: "retry-b" },
          { source: "retry-b", target: "retry-a" },
        ],
      },
    });

    expectBuildFailure(result);
    expect(result.status).toBe("invalid_flowchart");
    expect(
      result.issues
        .filter((issue) => issue.code === "nonterminating_node")
        .map((issue) => issue.ref?.id),
    ).toEqual(["retry-a", "retry-b"]);
  });

  it("accepts retry loops that retain an eventual exit", async () => {
    const result = await createTestRuntime().buildFlowchart({
      spec: {
        title: "Retry with eventual exit",
        nodes: [
          { id: "start", label: "Start request", kind: "start" },
          { id: "attempt", label: "Attempt operation", kind: "process" },
          { id: "retry", label: "Succeeded?", kind: "decision" },
          { id: "done", label: "Complete request", kind: "end" },
        ],
        edges: [
          { source: "start", target: "attempt" },
          { source: "attempt", target: "retry" },
          { source: "retry", target: "attempt", label: "retry" },
          { source: "retry", target: "done", label: "yes" },
        ],
      },
    });

    expectBuildOk(result);
  });

  it("rejects disconnected cycles from canonical start reachability", async () => {
    const result = await createTestRuntime().buildFlowchart({
      spec: {
        title: "Disconnected graph",
        nodes: [
          { id: "start", label: "Start request", kind: "start" },
          { id: "done", label: "Complete request", kind: "end" },
          { id: "orphan-a", label: "Orphan alpha", kind: "process" },
          { id: "orphan-b", label: "Orphan beta", kind: "process" },
        ],
        edges: [
          { source: "start", target: "done" },
          { source: "orphan-a", target: "orphan-b" },
          { source: "orphan-b", target: "orphan-a" },
        ],
      },
    });

    expectBuildFailure(result);
    expect(
      result.issues
        .filter((issue) => issue.code === "unreachable_node")
        .map((issue) => issue.ref?.id),
    ).toEqual(["orphan-a", "orphan-b"]);
  });

  it("rejects node and edge counts above the canonical limits", async () => {
    for (const spec of [
      linearFlowchartSpec(FLOWCHART_MAX_NODES + 1),
      denseAcyclicFlowchartSpec(FLOWCHART_MAX_EDGES + 1),
    ]) {
      const result = await createTestRuntime().buildFlowchart({ spec });
      expectBuildFailure(result);
      expect(result.status).toBe("invalid_flowchart");
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "flowchart_too_large" }),
      );
    }
  });

  it("fails semantic limits before rendering or persisting artifacts", async () => {
    let renderCalls = 0;
    let writeCalls = 0;
    const store: CodeModeArtifactStore = {
      read: async () => null,
      readManifest: async () => null,
      write: async () => {
        writeCalls += 1;
        throw new Error("invalid flowchart must not persist");
      },
    };
    const runtime = createCodeModeRuntime({
      store,
      renderer: {
        renderPng: async () => {
          renderCalls += 1;
          return new Uint8Array([137, 80, 78, 71]);
        },
      },
    });
    const result = await runtime.buildFlowchart({
      spec: linearFlowchartSpec(FLOWCHART_MAX_NODES + 1),
      options: { artifactFormats: ["png"] },
    });

    expectBuildFailure(result);
    expect(result.status).toBe("invalid_flowchart");
    expect(renderCalls).toBe(0);
    expect(writeCalls).toBe(0);
  });

  it("caps canonical flowchart issue output deterministically", async () => {
    const spec = {
      title: "Bounded issue output",
      nodes: [
        { id: "start", label: "Start request", kind: "start" },
        { id: "done", label: "Complete request", kind: "end" },
        ...Array.from({ length: FLOWCHART_MAX_NODES - 2 }, (_, index) => ({
          id: `orphan-${index}`,
          label: `Orphan operation ${index}`,
          kind: "process",
        })),
      ],
      edges: [{ source: "start", target: "done" }],
    };
    const first = await createTestRuntime().buildFlowchart({ spec });
    const second = await createTestRuntime().buildFlowchart({ spec });
    expectBuildFailure(first);
    expectBuildFailure(second);

    expect(first.issues).toHaveLength(FLOWCHART_MAX_ISSUES);
    expect(second.issues).toEqual(first.issues);
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

  it("keeps patch provenance consistent across the result and later format retrieval", async () => {
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createMemoryArtifactStore(),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      renderer: {
        renderPng: async () => new Uint8Array([137, 80, 78, 71]),
      },
    });
    const built = await runtime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);

    expect(built.artifact).not.toHaveProperty("provenance");
    const rootScene = await runtime.getArtifact({
      artifactId: built.artifact.artifactId,
      format: "scene",
      inline: true,
    });
    expectGetOk(rootScene);
    expect(rootScene).not.toHaveProperty("provenance");

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
        artifactFormats: ["scene", "excalidraw", "png"],
        inlineArtifacts: ["scene"],
      },
    });
    expectPatchOk(patched);

    const provenance = {
      sourceArtifactId: built.artifact.artifactId,
    };
    expect(patched.sourceArtifactId).toBe(provenance.sourceArtifactId);
    expect(patched.artifact.provenance).toEqual(provenance);
    if (!patched.artifact.provenance) {
      throw new Error("Expected the patched artifact to include provenance.");
    }
    patched.artifact.provenance.sourceArtifactId = "artifact-mutated";

    const formats: ArtifactFormat[] = ["scene", "excalidraw", "png"];
    for (const format of formats) {
      const retrieved = await runtime.getArtifact({
        artifactId: patched.artifact.artifactId,
        format,
      });
      expectGetOk(retrieved);
      expect(retrieved.provenance).toEqual(provenance);
    }
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
        message: "manifest read failed",
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

  it("rejects an object-store scene whose source manifest was not published", async () => {
    const sourceRuntime = createTestRuntime();
    const built = await sourceRuntime.buildFlowchart({ spec: approvalSpec() });
    expectBuildOk(built);
    const sourceScene = parseInlineScene(
      built.artifact.formats.find((format) => format.format === "scene")
        ?.inline,
    );

    const bucket = new MemoryBucket();
    await bucket.put(
      "codemode/artifact-partial/scene.json",
      JSON.stringify(sourceScene),
    );
    let id = 0;
    const runtime = createCodeModeRuntime({
      store: createObjectBucketArtifactStore(bucket, { prefix: "codemode" }),
      createId: (prefix) => `${prefix}-${(id += 1)}`,
    });

    const patched = await runtime.applyDiagramPatch({
      source: { artifactId: "artifact-partial" },
      operations: [{ op: "rerouteEdges" }],
    });

    expectPatchFailure(patched);
    expect(patched.status).toBe("source_unavailable");
    expect(patched.issues).toContainEqual(
      expect.objectContaining({
        code: "patch_source_unavailable",
        message: expect.stringContaining("valid source manifest"),
      }),
    );
    expect([...bucket.objects.keys()]).toEqual([
      "codemode/artifact-partial/scene.json",
    ]);
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
