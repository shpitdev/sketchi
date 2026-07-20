import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import type {
  CodeModeObjectBucket,
  CodeModeObjectBucketBody,
  CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";

import {
  handleBuildFlowchartRequest as handleBuildFlowchartRequestEffect,
  handleBuildMindmapRequest as handleBuildMindmapRequestEffect,
  handleGetArtifactRequest as handleGetArtifactRequestEffect,
  handlePatchArtifactRequest as handlePatchArtifactRequestEffect,
} from "./codemode-api.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import { runPlaygroundEffect } from "../runtime/playground-runtime.server";

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

interface StoredObject {
  readonly body: CodeModeObjectBucketBody;
  readonly contentType?: string;
}

class RecordingBucket implements CodeModeObjectBucket {
  readonly objects = new Map<string, StoredObject>();

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (isRecord(value) && typeof value[field] === "string") {
    return value[field];
  }
  throw new Error(`Compatibility response did not contain ${field}.`);
}

function artifactIdFrom(value: unknown): string {
  if (isRecord(value) && isRecord(value.artifact)) {
    return stringField(value.artifact, "artifactId");
  }
  throw new Error("Compatibility response did not contain an artifact.");
}

function normalizeStrings(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    let normalized = value;
    for (const [actual, replacement] of replacements) {
      normalized = normalized.replaceAll(actual, replacement);
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStrings(entry, replacements));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeStrings(entry, replacements),
      ]),
    );
  }
  return value;
}

async function jsonObservation(
  response: Response,
  replacements: ReadonlyMap<string, string>,
) {
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: normalizeStrings(await response.json(), replacements),
  };
}

function persistedArtifactObjects(
  bucket: RecordingBucket,
  artifactIds: readonly string[],
  replacements: ReadonlyMap<string, string>,
) {
  return [...bucket.objects.entries()]
    .filter(([key]) =>
      artifactIds.some((artifactId) =>
        key.startsWith(`codemode/${artifactId}/`),
      ),
    )
    .map(([key, object]) => {
      const body =
        typeof object.body === "string"
          ? normalizeStrings(JSON.parse(object.body), replacements)
          : [...new Uint8Array(object.body)];
      return {
        key: normalizeStrings(key, replacements),
        ...(object.contentType ? { contentType: object.contentType } : {}),
        encoding: typeof object.body === "string" ? "utf8-json" : "bytes",
        body,
      };
    })
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("exact-base Code Mode HTTP artifact compatibility corpus", () => {
  it("captures build, patch, get, raw, mindmap, and persisted encodings", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T12:34:56.789Z"));
    const bucket = new RecordingBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };

    const buildResponse = await handleBuildFlowchartRequest(
      env,
      postRequest("https://studio.test/api/v1/flowcharts/build", {
        requestId: "http-build-request",
        spec: approvalSpec(),
      }),
    );
    const buildBody: unknown = await buildResponse.json();
    const sourceArtifactId = artifactIdFrom(buildBody);
    const buildId = stringField(buildBody, "buildId");

    const patchResponse = await handlePatchArtifactRequest(
      env,
      postRequest(
        `https://studio.test/api/v1/artifacts/${sourceArtifactId}/patch`,
        {
          requestId: "http-patch-request",
          operations: [
            {
              op: "setStyle",
              selector: { nodeIds: ["approve"] },
              style: { fillColor: "#ede9fe", strokeColor: "#7c3aed" },
            },
          ],
        },
      ),
      sourceArtifactId,
    );
    const patchBody: unknown = await patchResponse.json();
    const childArtifactId = artifactIdFrom(patchBody);
    const patchId = stringField(patchBody, "patchId");

    const replacements = new Map([
      [sourceArtifactId, "<source-artifact-id>"],
      [childArtifactId, "<child-artifact-id>"],
      [buildId, "<build-id>"],
      [patchId, "<patch-id>"],
    ]);

    const getResponse = await handleGetArtifactRequest(
      env,
      new Request(
        `https://studio.test/api/v1/artifacts/${childArtifactId}?format=scene&inline=true`,
      ),
      childArtifactId,
    );
    const rawResponse = await handleGetArtifactRequest(
      env,
      new Request(
        `https://studio.test/api/v1/artifacts/${childArtifactId}?format=excalidraw&raw=true`,
      ),
      childArtifactId,
    );
    const rawBody: unknown = await rawResponse.json();

    const mindmapResponse = await handleBuildMindmapRequest(
      env,
      postRequest("https://studio.test/api/v1/mindmaps/build", {
        requestId: "http-mindmap-request",
        spec: {
          title: "Release plan",
          root: {
            label: "Release",
            children: [
              {
                label: "Engineering",
                children: [{ label: "Verification" }],
              },
              { label: "Launch", children: [{ label: "Documentation" }] },
            ],
          },
        },
      }),
    );
    const mindmapBody: unknown = await mindmapResponse.json();
    const mindmapArtifactId = artifactIdFrom(mindmapBody);
    const mindmapBuildId = stringField(mindmapBody, "buildId");
    replacements.set(mindmapArtifactId, "<mindmap-artifact-id>");
    replacements.set(mindmapBuildId, "<mindmap-build-id>");

    const corpus = {
      version: 1,
      lineage: {
        exactBase: "486e7169255354b8dc79cfa86e30c508721f5425",
        captureRule:
          "All observations were produced by the exact-base production HTTP handlers and object-bucket adapter.",
      },
      build: {
        status: buildResponse.status,
        cacheControl: buildResponse.headers.get("cache-control"),
        body: normalizeStrings(buildBody, replacements),
      },
      patch: {
        status: patchResponse.status,
        cacheControl: patchResponse.headers.get("cache-control"),
        body: normalizeStrings(patchBody, replacements),
      },
      get: await jsonObservation(getResponse, replacements),
      raw: {
        status: rawResponse.status,
        cacheControl: rawResponse.headers.get("cache-control"),
        contentDisposition: normalizeStrings(
          rawResponse.headers.get("content-disposition"),
          replacements,
        ),
        contentType: rawResponse.headers.get("content-type"),
        body: normalizeStrings(rawBody, replacements),
      },
      mindmap: {
        status: mindmapResponse.status,
        cacheControl: mindmapResponse.headers.get("cache-control"),
        body: normalizeStrings(mindmapBody, replacements),
      },
      persistedEncoding: persistedArtifactObjects(
        bucket,
        [sourceArtifactId, childArtifactId, mindmapArtifactId],
        replacements,
      ),
    };
    const fixturePath = `${process.cwd()}/apps/playground/src/server/codemode/fixtures/codemode-http-artifact-compatibility-v1.json`;
    await expect(`${JSON.stringify(corpus, null, 2)}\n`).toMatchFileSnapshot(
      fixturePath,
    );
  });
});
