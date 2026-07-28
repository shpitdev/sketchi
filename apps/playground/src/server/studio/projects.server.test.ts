import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import type { FlowchartSpec } from "@sketchi/diagram-agent";
import { MemoryStudioObjectBucket } from "@sketchi/studio-projects/server";

import type { StudioEnv } from "../bindings/studio-env.server";
import { PlaygroundCodeMode } from "../codemode/service.server";
import { runPlaygroundEffect } from "../runtime/runtime.server";
import {
  handleCreateStudioProjectFromArtifactRequest as handleCreateStudioProjectFromArtifactRequestEffect,
  handleListStudioProjectsRequest as handleListStudioProjectsRequestEffect,
} from "./projects.server";

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

function handleCreateStudioProjectFromArtifactRequest(
  env: StudioEnv,
  request: Request,
) {
  return runPlaygroundEffect(
    handleCreateStudioProjectFromArtifactRequestEffect(request),
    testBoundary(env, request),
  );
}

function handleListStudioProjectsRequest(env: StudioEnv, request: Request) {
  return runPlaygroundEffect(
    handleListStudioProjectsRequestEffect(request),
    testBoundary(env, request),
  );
}

function flowchartSpec(title: string): FlowchartSpec {
  return {
    edges: [
      { id: "draft-persist", source: "draft", target: "persist" },
      { id: "persist-done", source: "persist", target: "done" },
    ],
    nodes: [
      { id: "draft", label: "Draft diagram", kind: "start" },
      { id: "persist", label: "Save artifact", kind: "process" },
      { id: "done", label: "Persisted", kind: "end" },
    ],
    layout: { direction: "LR" },
    style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
    title,
  };
}

function postArtifact(artifactId: string): Request {
  return new Request("https://studio.test/api/studio/projects/from-artifact", {
    body: JSON.stringify({ artifactId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

async function createArtifact(
  bucket: MemoryStudioObjectBucket,
  title: string,
): Promise<string> {
  const request = new Request("https://studio.test/test-artifact", {
    method: "POST",
  });
  const env = { SKETCHI_ARTIFACTS: bucket };
  const result = await runPlaygroundEffect(
    Effect.gen(function* () {
      const codeMode = yield* PlaygroundCodeMode;
      return yield* codeMode.buildFlowchart({
        spec: flowchartSpec(title),
        options: {
          artifactFormats: ["scene", "excalidraw"],
          inlineArtifacts: ["scene"],
        },
      });
    }),
    testBoundary(env, request),
  );

  if (!result.ok) {
    throw new Error("Expected the test artifact to be accepted.");
  }
  return result.artifact.artifactId;
}

describe("Studio project app adapter", () => {
  it("loads and validates a Code Mode scene before returning the HTTP success response", async () => {
    const bucket = new MemoryStudioObjectBucket();
    const artifactId = await createArtifact(
      bucket,
      "Validated Studio artifact",
    );

    const response = await handleCreateStudioProjectFromArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      postArtifact(artifactId),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      diagram: {
        artifactId,
        title: "Validated Studio artifact",
      },
      ok: true,
      project: {
        title: "Validated Studio artifact",
      },
    });
  });

  it("maps a malformed stored scene to the preserved invalid_scene response", async () => {
    const bucket = new MemoryStudioObjectBucket();
    const artifactId = await createArtifact(bucket, "Malformed scene source");
    await bucket.put(
      `codemode/${artifactId}/scene.json`,
      JSON.stringify({ title: "Missing renderable scene fields" }),
    );

    const response = await handleCreateStudioProjectFromArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      postArtifact(artifactId),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_scene",
      message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
      ok: false,
    });
  });

  it("maps a missing Code Mode artifact to the preserved not_found response", async () => {
    const bucket = new MemoryStudioObjectBucket();
    const response = await handleCreateStudioProjectFromArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      postArtifact("missing-artifact"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_found",
      message:
        'Playground artifact "missing-artifact" is not available for Studio persistence.',
      ok: false,
    });
  });

  it("keeps binding-shape failures inside the Studio JSON error response", async () => {
    const bucketWithoutList = {
      async get() {
        return null;
      },
      async put() {
        return null;
      },
    };
    const response = await handleListStudioProjectsRequest(
      { SKETCHI_ARTIFACTS: bucketWithoutList },
      new Request("https://studio.test/api/studio/projects"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "storage_failed",
      message:
        "Studio persistence requires an object bucket with list support.",
      ok: false,
    });
  });
});
