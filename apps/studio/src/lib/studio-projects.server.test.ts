import { describe, expect, it } from "vitest";

import type {
  CodeModeObjectBucket,
  CodeModeObjectBucketObject,
  FlowchartSpec,
} from "@sketchi/diagram-agent";

import { createStudioCodeModeRuntime } from "./codemode-api.server";
import {
  createAuthenticatedStudioSession,
  createStudioProjectFromArtifact,
  handleCreateStudioProjectFromArtifactRequest,
  handleGetStudioDiagramRequest,
  handleGetStudioProjectRequest,
  handleListStudioProjectsRequest,
  listStudioProjects,
  studioOwnerKey,
} from "./studio-projects.server";

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

  async list(options: { prefix: string }): Promise<{
    objects: readonly { key: string }[];
    truncated: false;
  }> {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    };
  }
}

function flowchartSpec(
  title = "Studio persistence approval flow",
): FlowchartSpec {
  return {
    edges: [
      { id: "draft-persist", source: "draft", target: "persist" },
      { id: "persist-review", source: "persist", target: "review" },
      { id: "review-done", source: "review", target: "done", label: "yes" },
      {
        id: "review-revise",
        source: "review",
        target: "revise",
        label: "no",
      },
    ],
    nodes: [
      { id: "draft", label: "Draft diagram", kind: "start" },
      { id: "persist", label: "Save artifact", kind: "process" },
      { id: "review", label: "Open Studio?", kind: "decision" },
      { id: "done", label: "Persisted", kind: "end" },
      { id: "revise", label: "Revise", kind: "end" },
    ],
    layout: { direction: "LR" },
    style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
    title,
  };
}

function postRequest(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}

function getRequest(url: string, headers: HeadersInit = {}): Request {
  return new Request(url, { headers });
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

function projectIdFrom(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.project) &&
    typeof value.project.id === "string"
  ) {
    return value.project.id;
  }
  throw new Error("Response did not contain a project id.");
}

function diagramIdFrom(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.diagram) &&
    typeof value.diagram.id === "string"
  ) {
    return value.diagram.id;
  }
  throw new Error("Response did not contain a diagram id.");
}

function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Response did not set a session cookie.");
  }
  return setCookie.split(";")[0] ?? setCookie;
}

async function createArtifact(
  bucket: MemoryBucket,
  title?: string,
): Promise<string> {
  const result = await createStudioCodeModeRuntime(
    { SKETCHI_ARTIFACTS: bucket },
    { origin: "https://studio.test" },
  ).buildFlowchart({
    spec: flowchartSpec(title),
    options: {
      artifactFormats: ["scene", "excalidraw"],
      inlineArtifacts: ["scene"],
    },
  });

  expect(result.ok).toBe(true);
  return artifactIdFrom(result);
}

describe("Studio project persistence", () => {
  it("creates a project from a Playground artifact and reloads it for the same session", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const artifactId = await createArtifact(bucket);

    const createResponse = await handleCreateStudioProjectFromArtifactRequest(
      env,
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId,
      }),
    );
    expect(createResponse.status).toBe(200);
    const cookie = cookieHeaderFrom(createResponse);
    const created: unknown = await createResponse.json();
    const projectId = projectIdFrom(created);
    const diagramId = diagramIdFrom(created);

    expect(created).toMatchObject({
      auth: {
        status: "anonymous",
      },
      diagram: {
        artifactId,
        id: diagramId,
        projectId,
        reviewUrl: `/diagrams/${diagramId}`,
        title: "Studio persistence approval flow",
      },
      ok: true,
      project: {
        diagramCount: 1,
        id: projectId,
        primaryDiagramId: diagramId,
        title: "Studio persistence approval flow",
      },
      urls: {
        diagram: `/diagrams/${diagramId}`,
        edit: `/diagrams/${diagramId}/edit`,
        project: `/projects/${projectId}`,
      },
    });

    const listResponse = await handleListStudioProjectsRequest(
      env,
      getRequest("https://studio.test/api/studio/projects", {
        Cookie: cookie,
      }),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      projects: [
        {
          id: projectId,
          primaryDiagramId: diagramId,
          title: "Studio persistence approval flow",
        },
      ],
    });

    const projectResponse = await handleGetStudioProjectRequest(
      env,
      getRequest(`https://studio.test/api/studio/projects/${projectId}`, {
        Cookie: cookie,
      }),
      projectId,
    );
    expect(projectResponse.status).toBe(200);
    await expect(projectResponse.json()).resolves.toMatchObject({
      details: {
        diagrams: [
          {
            artifactId,
            id: diagramId,
          },
        ],
        project: {
          id: projectId,
        },
      },
      ok: true,
    });

    const diagramResponse = await handleGetStudioDiagramRequest(
      env,
      getRequest(`https://studio.test/api/studio/diagrams/${diagramId}`, {
        Cookie: cookie,
      }),
      diagramId,
    );
    expect(diagramResponse.status).toBe(200);
    await expect(diagramResponse.json()).resolves.toMatchObject({
      diagram: {
        artifactId,
        id: diagramId,
      },
      ok: true,
      project: {
        id: projectId,
      },
    });
  });

  it("keeps anonymous project lists isolated by session cookie", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const artifactId = await createArtifact(bucket);
    const createResponse = await handleCreateStudioProjectFromArtifactRequest(
      env,
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId,
      }),
    );
    const created: unknown = await createResponse.json();
    const projectId = projectIdFrom(created);

    const otherSessionResponse = await handleListStudioProjectsRequest(
      env,
      getRequest("https://studio.test/api/studio/projects"),
    );

    expect(otherSessionResponse.status).toBe(200);
    await expect(otherSessionResponse.json()).resolves.toMatchObject({
      ok: true,
      projects: [],
    });

    const deniedResponse = await handleGetStudioProjectRequest(
      env,
      getRequest(`https://studio.test/api/studio/projects/${projectId}`),
      projectId,
    );
    expect(deniedResponse.status).toBe(404);
  });

  it("stores projects under an authenticated owner when auth exists", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const artifactId = await createArtifact(bucket);
    const session = createAuthenticatedStudioSession({
      displayName: "Ada",
      subjectId: "user_ada",
    });

    const created = await createStudioProjectFromArtifact(
      env,
      new Request("https://studio.test/api/studio/projects/from-artifact"),
      { artifactId, session },
    );

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.message);
    }
    expect(studioOwnerKey(created.projectRecord.owner)).toBe(
      "authenticated/user_ada",
    );

    const projects = await listStudioProjects(env, session);
    expect(projects).toEqual([
      expect.objectContaining({
        id: created.project.id,
        title: "Studio persistence approval flow",
      }),
    ]);
  });

  it("keeps concurrent project saves for the same owner in the project list", async () => {
    const bucket = new MemoryBucket();
    const env = { SKETCHI_ARTIFACTS: bucket };
    const session = createAuthenticatedStudioSession({
      subjectId: "user_concurrent",
    });
    const [firstArtifactId, secondArtifactId] = await Promise.all([
      createArtifact(bucket, "First concurrent Studio save"),
      createArtifact(bucket, "Second concurrent Studio save"),
    ]);

    const [first, second] = await Promise.all([
      createStudioProjectFromArtifact(
        env,
        new Request("https://studio.test/api/studio/projects/from-artifact"),
        { artifactId: firstArtifactId, session },
      ),
      createStudioProjectFromArtifact(
        env,
        new Request("https://studio.test/api/studio/projects/from-artifact"),
        { artifactId: secondArtifactId, session },
      ),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Concurrent Studio saves should both succeed.");
    }

    const projects = await listStudioProjects(env, session);
    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((project) => project.id))).toEqual(
      new Set([first.project.id, second.project.id]),
    );
  });

  it("rejects project creation when the artifact is unavailable", async () => {
    const bucket = new MemoryBucket();
    const response = await handleCreateStudioProjectFromArtifactRequest(
      { SKETCHI_ARTIFACTS: bucket },
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId: "missing-artifact",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_found",
      ok: false,
    });
  });
});
