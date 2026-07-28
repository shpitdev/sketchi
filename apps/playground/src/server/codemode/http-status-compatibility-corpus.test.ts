import { describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import type {
  ApplyDiagramPatchResult,
  BuildFlowchartResult,
  BuildMindmapResult,
  GetArtifactResult,
} from "@sketchi/diagram-agent";

const runtimeResults = vi.hoisted(() => {
  let buildFlowchartResult: unknown;
  let buildMindmapResult: unknown;
  let getArtifactResult: unknown;
  let applyDiagramPatchResult: unknown;

  return {
    getApplyDiagramPatch: () => applyDiagramPatchResult,
    getBuildFlowchart: () => buildFlowchartResult,
    getBuildMindmap: () => buildMindmapResult,
    getGetArtifact: () => getArtifactResult,
    setApplyDiagramPatch: (result: unknown) => {
      applyDiagramPatchResult = result;
    },
    setBuildFlowchart: (result: unknown) => {
      buildFlowchartResult = result;
    },
    setBuildMindmap: (result: unknown) => {
      buildMindmapResult = result;
    },
    setGetArtifact: (result: unknown) => {
      getArtifactResult = result;
    },
  };
});

vi.mock("./service.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./service.server")>();
  return {
    ...actual,
    PlaygroundCodeModeLive: Layer.succeed(actual.PlaygroundCodeMode, {
      applyDiagramPatch: () =>
        Effect.succeed(
          runtimeResults.getApplyDiagramPatch() as ApplyDiagramPatchResult,
        ),
      buildFlowchart: () =>
        Effect.succeed(
          runtimeResults.getBuildFlowchart() as BuildFlowchartResult,
        ),
      buildMindmap: () =>
        Effect.succeed(runtimeResults.getBuildMindmap() as BuildMindmapResult),
      buildSequenceDiagram: () =>
        Effect.die("Sequence diagrams are outside the frozen v1 corpus."),
      getArtifact: () =>
        Effect.succeed(runtimeResults.getGetArtifact() as GetArtifactResult),
      readStoredArtifact: () => Effect.succeed(null),
    }),
  };
});

import {
  MAX_CODE_MODE_BUILD_REQUEST_BYTES,
  handleBuildFlowchartRequest as handleBuildFlowchartRequestEffect,
  handleBuildMindmapRequest as handleBuildMindmapRequestEffect,
  handleGetArtifactRequest as handleGetArtifactRequestEffect,
  handlePatchArtifactRequest as handlePatchArtifactRequestEffect,
} from "./api.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";

function testBoundary(env: StudioEnv, request: Request) {
  return {
    env,
    request,
    platform: {
      waitUntilPromise: (promise: Promise<unknown>) => {
        void promise;
      },
    },
  };
}

function handleBuildFlowchartRequest(env: StudioEnv, request: Request) {
  return runPlaygroundEffect(
    handleBuildFlowchartRequestEffect(request),
    testBoundary(env, request),
  );
}

function handleBuildMindmapRequest(env: StudioEnv, request: Request) {
  return runPlaygroundEffect(
    handleBuildMindmapRequestEffect(request),
    testBoundary(env, request),
  );
}

function handleGetArtifactRequest(
  env: StudioEnv,
  request: Request,
  artifactId: string,
) {
  return runPlaygroundEffect(
    handleGetArtifactRequestEffect(request, artifactId),
    testBoundary(env, request),
  );
}

function handlePatchArtifactRequest(
  env: StudioEnv,
  request: Request,
  artifactId: string,
) {
  return runPlaygroundEffect(
    handlePatchArtifactRequestEffect(request, artifactId),
    testBoundary(env, request),
  );
}

function issue(input: {
  readonly code: string;
  readonly hint: string;
  readonly message: string;
  readonly path?: string;
  readonly stage: string;
}) {
  return {
    code: input.code,
    severity: "error",
    stage: input.stage,
    ...(input.path ? { ref: { kind: "request", path: input.path } } : {}),
    message: input.message,
    hint: input.hint,
  };
}

function failure(
  status: string,
  code: string,
  input: {
    readonly hint?: string;
    readonly message?: string;
    readonly path?: string;
    readonly stage?: string;
  } = {},
) {
  return {
    ok: false,
    status,
    issues: [
      issue({
        code,
        hint: input.hint ?? `Compatibility hint for ${status}.`,
        message: input.message ?? `Compatibility message for ${status}.`,
        ...(input.path ? { path: input.path } : {}),
        stage: input.stage ?? "input",
      }),
    ],
  };
}

function acceptedBuild(operation: "flowchart" | "mindmap") {
  return {
    ok: true,
    status: "accepted",
    buildId: `build-http-${operation}`,
    normalizedSpec: { id: `${operation}-http` },
    quality: {
      accepted: true,
      score: 10,
      threshold: 8,
      summary: { nodeCount: 1, edgeCount: 0 },
      checks: [],
    },
    artifact: {
      artifactId: `artifact-http-${operation}`,
      diagramId: `${operation}-http`,
      formats: [],
    },
    issues: [],
  };
}

function acceptedPatch() {
  return {
    ok: true,
    status: "accepted",
    patchId: "patch-http",
    sourceArtifactId: "artifact-source",
    artifact: {
      artifactId: "artifact-child",
      diagramId: "patch-http",
      formats: [],
      provenance: { sourceArtifactId: "artifact-source" },
    },
    issues: [],
  };
}

function acceptedGet() {
  return {
    ok: true,
    artifactId: "artifact-http",
    diagramId: "diagram-http",
    format: "scene",
    mimeType: "application/vnd.sketchi.scene+json",
    sizeBytes: 123,
  };
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function observe(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

const flowchartCases = [
  ["accepted", acceptedBuild("flowchart")],
  ["invalid_input", failure("invalid_input", "missing_field")],
  ["invalid_flowchart", failure("invalid_flowchart", "missing_start")],
  ["quality_failed", failure("quality_failed", "generic_label")],
  ["render_failed", failure("render_failed", "render_failed")],
  ["export_failed", failure("export_failed", "export_invalid_scene")],
  ["storage_failed", failure("storage_failed", "storage_write_failed")],
] as const;

const mindmapCases = [
  ["accepted", acceptedBuild("mindmap")],
  ["invalid_input", failure("invalid_input", "missing_field")],
  ["invalid_mindmap", failure("invalid_mindmap", "disconnected_graph")],
  ["quality_failed", failure("quality_failed", "generic_label")],
  ["render_failed", failure("render_failed", "render_failed")],
  ["export_failed", failure("export_failed", "export_invalid_scene")],
  ["storage_failed", failure("storage_failed", "storage_write_failed")],
] as const;

const getCases = [
  ["accepted", acceptedGet()],
  ["invalid_input", failure("invalid_input", "missing_field")],
  ["not_found", failure("not_found", "patch_source_unavailable")],
  [
    "format_unavailable",
    failure("format_unavailable", "unsupported_artifact_format"),
  ],
  [
    "expired",
    failure("expired", "patch_source_unavailable", {
      hint: "Rebuild the artifact and use its new artifactId.",
      message: 'Artifact "artifact-expired" has expired.',
      stage: "storage",
    }),
  ],
  ["storage_failed", failure("storage_failed", "storage_read_failed")],
] as const;

const patchCases = [
  ["accepted", acceptedPatch()],
  ["invalid_input", failure("invalid_input", "missing_field")],
  [
    "source_unavailable",
    failure("source_unavailable", "patch_source_unavailable"),
  ],
  ["target_not_found", failure("target_not_found", "unknown_patch_target")],
  [
    "unsupported_operation",
    failure("unsupported_operation", "unsupported_patch_operation"),
  ],
  [
    "connectivity_changed",
    failure("connectivity_changed", "patch_preserve_connectivity_failed", {
      hint: "Use a build operation when changing graph structure.",
      message: "Patch changed the diagram edge connectivity.",
      path: "operations",
      stage: "flowchart",
    }),
  ],
  [
    "render_failed",
    failure("render_failed", "patch_output_invalid", {
      hint: "Reroute edges or rebuild the flowchart artifact.",
      message: "Patched scene has an invalid arrow point list.",
      path: "operations",
      stage: "render",
    }),
  ],
  ["export_failed", failure("export_failed", "export_invalid_scene")],
  ["storage_failed", failure("storage_failed", "storage_write_failed")],
] as const;

describe("exact-base Code Mode HTTP status compatibility corpus", () => {
  it("maps every public result family through the production handlers", async () => {
    const flowchart: Record<string, unknown> = {};
    for (const [name, result] of flowchartCases) {
      runtimeResults.setBuildFlowchart(result);
      flowchart[name] = await observe(
        await handleBuildFlowchartRequest(
          {},
          postRequest("https://studio.test/api/v1/flowcharts/build", {}),
        ),
      );
    }

    const mindmap: Record<string, unknown> = {};
    for (const [name, result] of mindmapCases) {
      runtimeResults.setBuildMindmap(result);
      mindmap[name] = await observe(
        await handleBuildMindmapRequest(
          {},
          postRequest("https://studio.test/api/v1/mindmaps/build", {}),
        ),
      );
    }

    const getArtifact: Record<string, unknown> = {};
    for (const [name, result] of getCases) {
      runtimeResults.setGetArtifact(result);
      getArtifact[name] = await observe(
        await handleGetArtifactRequest(
          {},
          new Request("https://studio.test/api/v1/artifacts/artifact-http"),
          "artifact-http",
        ),
      );
    }

    const applyDiagramPatch: Record<string, unknown> = {};
    for (const [name, result] of patchCases) {
      runtimeResults.setApplyDiagramPatch(result);
      applyDiagramPatch[name] = await observe(
        await handlePatchArtifactRequest(
          {},
          postRequest(
            "https://studio.test/api/v1/artifacts/artifact-source/patch",
            { operations: [{ op: "rerouteEdges" }] },
          ),
          "artifact-source",
        ),
      );
    }

    const requestTooLarge = await observe(
      await handleBuildFlowchartRequest(
        {},
        new Request("https://studio.test/api/v1/flowcharts/build", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_CODE_MODE_BUILD_REQUEST_BYTES + 1),
          },
          body: "{}",
        }),
      ),
    );

    const corpus = {
      version: 1,
      lineage: {
        exactBase: "486e7169255354b8dc79cfa86e30c508721f5425",
        captureRule:
          "Response status and body observations were captured by production HTTP handlers at the exact base.",
      },
      flowchart,
      mindmap,
      getArtifact,
      applyDiagramPatch,
      requestTooLarge,
    };
    const fixturePath = `${process.cwd()}/apps/playground/src/server/codemode/fixtures/http-status-compatibility-v1.json`;
    await expect(`${JSON.stringify(corpus, null, 2)}\n`).toMatchFileSnapshot(
      fixturePath,
    );
  });
});
