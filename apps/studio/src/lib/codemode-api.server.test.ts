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

async function readBucketJson(
  bucket: MemoryBucket,
  key: string,
): Promise<unknown> {
  const object = await bucket.get(key);
  return JSON.parse((await object?.text()) ?? "{}");
}

async function usageEventsFrom(bucket: MemoryBucket): Promise<unknown[]> {
  const eventKeys = [...bucket.objects.keys()]
    .filter((key) => key.startsWith("codemode/usage/"))
    .filter((key) => key.endsWith("/event.json"))
    .sort();

  return Promise.all(eventKeys.map((key) => readBucketJson(bucket, key)));
}

async function waitForUsageEvents(
  bucket: MemoryBucket,
  count: number,
): Promise<unknown[]> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const events = await usageEventsFrom(bucket);
    if (events.length >= count) {
      return events;
    }
    await delay(5);
  }

  throw new Error(`Expected ${count} usage event(s) to be persisted.`);
}

async function waitForPipelineRecords(
  pipeline: MemoryPipeline,
  count: number,
): Promise<unknown[]> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const records = pipeline.records();
    if (records.length >= count) {
      return records;
    }
    await delay(5);
  }

  throw new Error(`Expected ${count} pipeline record(s) to be sent.`);
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

class DelayedUsageBucket extends MemoryBucket {
  private readonly releaseUsageWrite: Promise<void>;
  private resolveReleaseUsageWrite: () => void = () => {};
  readonly usageWriteFinished: Promise<void>;
  private resolveUsageWriteFinished: () => void = () => {};
  readonly usageWriteStarted: Promise<void>;
  private resolveUsageWriteStarted: () => void = () => {};

  constructor() {
    super();
    this.releaseUsageWrite = new Promise((resolve) => {
      this.resolveReleaseUsageWrite = resolve;
    });
    this.usageWriteFinished = new Promise((resolve) => {
      this.resolveUsageWriteFinished = resolve;
    });
    this.usageWriteStarted = new Promise((resolve) => {
      this.resolveUsageWriteStarted = resolve;
    });
  }

  override async put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
  ): Promise<unknown> {
    if (!key.startsWith("codemode/usage/")) {
      return super.put(key, value);
    }

    this.resolveUsageWriteStarted();
    await this.releaseUsageWrite;
    const result = await super.put(key, value);
    this.resolveUsageWriteFinished();
    return result;
  }

  releaseUsagePersistence(): void {
    this.resolveReleaseUsageWrite();
  }
}

class MemoryPipeline {
  readonly batches: unknown[][] = [];

  async send(records: readonly unknown[]): Promise<void> {
    this.batches.push([...records]);
  }

  records(): unknown[] {
    return this.batches.flat();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    expect(buildResponse.headers.get("x-sketchi-run-id")).toMatch(/^run_/);
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

    expect(
      [...bucket.objects.keys()]
        .filter((key) => key.startsWith(`codemode/${artifactId}/`))
        .sort(),
    ).toEqual([
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

    const usageEvents = await waitForUsageEvents(bucket, 1);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      artifactRefs: [
        {
          artifactId,
          diagramId: "worker-api-approval-flow",
        },
      ],
      client: {},
      operation: "buildFlowchart",
      request: {
        method: "POST",
        path: "/api/v1/flowcharts/build",
      },
      schema: "sketchi.codemode.usage.v1",
      status: "ok",
      statusCode: 200,
      surface: "api",
    });
    if (!isRecord(usageEvents[0]) || !isRecord(usageEvents[0].request)) {
      throw new Error("Usage event did not include request metadata.");
    }
    if (!isRecord(usageEvents[0].request.body)) {
      throw new Error("Usage event did not include a request snapshot.");
    }
    expect(usageEvents[0].request.body.value).toMatchObject({
      spec: { title: "Worker API approval flow" },
    });
  });

  it("does not wait for usage event persistence before returning the API response", async () => {
    const bucket = new DelayedUsageBucket();
    const responsePromise = handleBuildFlowchartRequest(
      { SKETCHI_ARTIFACTS: bucket },
      postRequest("https://studio.test/api/v1/flowcharts/build", {
        spec: approvalSpec(),
      }),
    );

    await bucket.usageWriteStarted;
    expect(await usageEventsFrom(bucket)).toHaveLength(0);

    const response = await Promise.race([
      responsePromise,
      delay(250).then(() => undefined),
    ]);

    bucket.releaseUsagePersistence();
    await bucket.usageWriteFinished;

    if (!response) {
      throw new Error("API response waited for usage event persistence.");
    }

    expect(response.status).toBe(200);
    expect(await usageEventsFrom(bucket)).toHaveLength(1);
  });

  it("sends aggregate usage and issue rows to Pipeline bindings", async () => {
    const bucket = new MemoryBucket();
    const usageEvents = new MemoryPipeline();
    const usageIssues = new MemoryPipeline();

    const response = await handleBuildFlowchartRequest(
      {
        CODEMODE_USAGE_EVENTS: usageEvents,
        CODEMODE_USAGE_ISSUES: usageIssues,
        SKETCHI_ARTIFACTS: bucket,
      },
      postRequest("https://studio.test/api/v1/flowcharts/build", {
        spec: {
          title: "Broken approval flow",
          nodes: [],
          edges: [{ source: "request", target: "done" }],
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: expect.any(String),
        }),
      ]),
    });

    await waitForUsageEvents(bucket, 1);
    const eventRows = await waitForPipelineRecords(usageEvents, 1);
    const issueRows = await waitForPipelineRecords(usageIssues, 1);

    expect(eventRows[0]).toMatchObject({
      artifact_count: 0,
      artifact_delivery: false,
      issue_count: expect.any(Number),
      operation: "buildFlowchart",
      request_method: "POST",
      request_path: "/api/v1/flowcharts/build",
      schema: "sketchi.codemode.usage.v1",
      status: "error",
      status_code: 400,
      surface: "api",
    });
    if (!isRecord(eventRows[0])) {
      throw new Error("Usage pipeline event row was not an object.");
    }
    expect(eventRows[0].event_key).toMatch(/^codemode\/usage\//);
    expect(eventRows[0].event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(eventRows[0].issue_count).toBeGreaterThan(0);
    expect(eventRows[0].request_snapshot_bytes).toBeGreaterThan(0);
    expect(eventRows[0].response_snapshot_bytes).toBeGreaterThan(0);

    expect(issueRows[0]).toMatchObject({
      operation: "buildFlowchart",
      schema: "sketchi.codemode.usage.v1",
      status: "error",
      surface: "api",
    });
    if (!isRecord(issueRows[0])) {
      throw new Error("Usage pipeline issue row was not an object.");
    }
    expect(issueRows[0].event_key).toBe(eventRows[0].event_key);
    expect(issueRows[0].issue_code).toEqual(expect.any(String));
    expect(issueRows[0].issue_path).toMatch(/^response\.issues\[/);
  });

  it("wraps legacy raw Excalidraw scene artifacts in an importable file envelope", async () => {
    const bucket = new MemoryBucket();
    const artifactId = "artifact-legacy-excalidraw";
    bucket.objects.set(
      `codemode/${artifactId}/manifest.json`,
      JSON.stringify({
        artifactId,
        diagramId: "diagram-legacy-excalidraw",
        formats: [
          {
            format: "excalidraw",
            mimeType: "application/vnd.excalidraw+json",
            sizeBytes: 142,
          },
        ],
        createdAt: new Date().toISOString(),
      }),
    );
    bucket.objects.set(
      `codemode/${artifactId}/excalidraw.json`,
      JSON.stringify({
        appState: { viewBackgroundColor: "#ffffff" },
        elements: [
          {
            id: "node:start",
            type: "rectangle",
          },
        ],
      }),
    );

    const getResponse = await handleGetArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      new Request(
        `https://studio.test/api/v1/artifacts/${artifactId}?format=excalidraw&raw=true`,
      ),
      artifactId,
    );

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toBe(
      "application/vnd.excalidraw+json",
    );
    await expect(getResponse.json()).resolves.toMatchObject({
      appState: { viewBackgroundColor: "#ffffff" },
      elements: [{ id: "node:start", type: "rectangle" }],
      files: {},
      source: "https://sketchi.app",
      type: "excalidraw",
      version: 2,
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
