import { describe, expect, it } from "vitest";

import type {
  CodeModeObjectBucket,
  CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";

import { handleGetArtifactRequest } from "./codemode-api.server";
import {
  diagramToolInputToFlowchartSpec,
  handleCreatePlaygroundArtifactRequest,
} from "./playground-artifacts.server";

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
      arrayBuffer: async () => {
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        return buffer;
      },
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

function toolInput() {
  return {
    title: "Artifact handoff approval flow",
    direction: "LR" as const,
    nodes: [
      { id: "request", label: "Request arrives", kind: "start" as const },
      { id: "lookup", label: "Load artifact", kind: "data" as const },
      { id: "review", label: "Review works?", kind: "decision" as const },
      { id: "publish", label: "Publish link", kind: "external" as const },
      { id: "done", label: "Done", kind: "end" as const },
      { id: "retry", label: "Retry save", kind: "end" as const },
    ],
    edges: [
      { source: "request", target: "lookup" },
      { source: "lookup", target: "review" },
      { source: "review", target: "publish", label: "yes" },
      { source: "publish", target: "done" },
      { source: "review", target: "retry", label: "no" },
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

describe("Playground artifact handoff", () => {
  it("converts accepted chat diagram input to the artifact flowchart contract", () => {
    const spec = diagramToolInputToFlowchartSpec(toolInput());

    expect(spec).toMatchObject({
      id: "artifact-handoff-approval-flow",
      title: "Artifact handoff approval flow",
      layout: { direction: "LR" },
      style: {
        accentColor: "#8f707f",
        backgroundColor: "#fffdf8",
      },
    });
    expect(spec.nodes).toEqual([
      { id: "request", label: "Request arrives", kind: "start" },
      { id: "lookup", label: "Load artifact", kind: "process" },
      { id: "review", label: "Review works?", kind: "decision" },
      { id: "publish", label: "Publish link", kind: "process" },
      { id: "done", label: "Done", kind: "end" },
      { id: "retry", label: "Retry save", kind: "end" },
    ]);
  });

  it("creates a linkable artifact and serves its scene and exports", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const createResponse = await handleCreatePlaygroundArtifactRequest(
      env,
      postRequest("https://playground.test/api/playground/artifacts", {
        input: toolInput(),
      }),
    );

    expect(createResponse.status).toBe(200);
    const created: unknown = await createResponse.json();
    const artifactId = artifactIdFrom(created);
    expect(created).toMatchObject({
      ok: true,
      status: "accepted",
      exportUrls: {
        excalidraw: `/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`,
        scene: `/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
      },
      editUrl: `/artifacts/${artifactId}/edit`,
      viewUrl: `/artifacts/${artifactId}`,
    });

    const sceneResponse = await handleGetArtifactRequest(
      env,
      new Request(
        `https://playground.test/api/v1/artifacts/${artifactId}?format=scene&inline=true`,
      ),
      artifactId,
    );
    expect(sceneResponse.status).toBe(200);
    await expect(sceneResponse.json()).resolves.toMatchObject({
      ok: true,
      artifactId,
      format: "scene",
      inline: {
        title: "Artifact handoff approval flow",
      },
    });

    const rawSceneResponse = await handleGetArtifactRequest(
      env,
      new Request(
        `https://playground.test/api/v1/artifacts/${artifactId}?format=scene&raw=true`,
      ),
      artifactId,
    );
    expect(rawSceneResponse.status).toBe(200);
    expect(rawSceneResponse.headers.get("content-type")).toBe(
      "application/vnd.sketchi.scene+json",
    );
  });
});
