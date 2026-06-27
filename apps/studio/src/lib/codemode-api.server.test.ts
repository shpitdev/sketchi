import { describe, expect, it } from "vitest";

import type {
  CodeModeObjectBucket,
  CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";

import {
  handleBuildFlowchartRequest,
  handleGetArtifactRequest,
  handlePatchArtifactRequest,
} from "./codemode-api.server";

function approvalSpec() {
  return {
    title: "Worker API approval flow",
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
  };
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactIdFrom(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.artifact) &&
    typeof value.artifact.artifactId === "string"
  ) {
    return value.artifact.artifactId;
  }
  throw new Error("Response did not contain an artifact id.");
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("Code Mode API handlers", () => {
  it("builds, retrieves, and patches an artifact through Response handlers", async () => {
    const buildResponse = await handleBuildFlowchartRequest(
      {},
      postRequest("https://studio.test/api/v1/flowcharts/build", {
        spec: approvalSpec(),
      }),
    );

    expect(buildResponse.status).toBe(200);
    const built: unknown = await buildResponse.json();
    expect(built).toMatchObject({ ok: true, status: "accepted" });

    const artifactId = artifactIdFrom(built);
    expect(built).toMatchObject({
      artifact: {
        formats: expect.arrayContaining([
          expect.objectContaining({
            format: "excalidraw",
            url: `https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`,
          }),
          expect.objectContaining({
            format: "scene",
            url: `https://studio.test/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
          }),
        ]),
      },
    });
    const getResponse = await handleGetArtifactRequest(
      {},
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=scene`,
      ),
      artifactId,
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      ok: true,
      artifactId,
      format: "scene",
      url: `https://studio.test/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
    });

    const rawExcalidrawResponse = await handleGetArtifactRequest(
      {},
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`,
      ),
      artifactId,
    );

    expect(rawExcalidrawResponse.status).toBe(200);
    expect(rawExcalidrawResponse.headers.get("content-type")).toBe(
      "application/vnd.excalidraw+json",
    );
    expect(rawExcalidrawResponse.headers.get("content-disposition")).toBe(
      `inline; filename="${artifactId}.excalidraw"`,
    );
    await expect(rawExcalidrawResponse.json()).resolves.toMatchObject({
      type: "excalidraw",
      version: 2,
      files: {},
    });

    const invalidGetResponse = await handleGetArtifactRequest(
      {},
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=svg`,
      ),
      artifactId,
    );

    expect(invalidGetResponse.status).toBe(400);
    await expect(invalidGetResponse.json()).resolves.toMatchObject({
      ok: false,
      status: "invalid_input",
    });

    const patchResponse = await handlePatchArtifactRequest(
      {},
      postRequest(`https://studio.test/api/v1/artifacts/${artifactId}/patch`, {
        operations: [
          {
            op: "setStyle",
            selector: { nodeIds: ["approve"] },
            style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
          },
        ],
      }),
      artifactId,
    );

    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({
      ok: true,
      sourceArtifactId: artifactId,
      status: "accepted",
    });
  });

  it("uses the R2-compatible artifact binding when one is configured", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const buildResponse = await handleBuildFlowchartRequest(
      env,
      postRequest("https://studio.test/api/v1/flowcharts/build", {
        spec: approvalSpec(),
      }),
    );

    expect(buildResponse.status).toBe(200);
    const built: unknown = await buildResponse.json();
    const artifactId = artifactIdFrom(built);

    expect([...bucket.objects.keys()].sort()).toEqual([
      `codemode/${artifactId}/excalidraw.json`,
      `codemode/${artifactId}/manifest.json`,
      `codemode/${artifactId}/scene.json`,
    ]);
    const excalidrawObject = await bucket.get(
      `codemode/${artifactId}/excalidraw.json`,
    );
    const excalidrawJson = JSON.parse((await excalidrawObject?.text()) ?? "{}");
    expect(excalidrawJson).toMatchObject({
      type: "excalidraw",
      version: 2,
      source: "https://sketchi.app",
      files: {},
      elements: expect.any(Array),
      appState: expect.any(Object),
    });

    const getResponse = await handleGetArtifactRequest(
      env,
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=scene`,
      ),
      artifactId,
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      ok: true,
      artifactId,
      format: "scene",
    });
  });

  it("returns raw PNG bytes from the R2-compatible artifact binding", async () => {
    const bucket = new MemoryBucket();
    const artifactId = "artifact-png";
    bucket.objects.set(
      `codemode/${artifactId}/manifest.json`,
      JSON.stringify({
        artifactId,
        diagramId: "diagram-png",
        formats: [
          {
            format: "png",
            mimeType: "image/png",
            sizeBytes: 4,
          },
        ],
        createdAt: new Date().toISOString(),
      }),
    );
    bucket.objects.set(
      `codemode/${artifactId}/png.png`,
      new Uint8Array([137, 80, 78, 71]),
    );

    const getResponse = await handleGetArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=png&raw=true`,
      ),
      artifactId,
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });
});
