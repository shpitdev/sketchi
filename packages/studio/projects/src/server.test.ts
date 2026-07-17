import { describe, expect, it } from "vitest";

import type { StudioOwner, StudioProjectRecord } from "./contracts.js";
import {
  createAuthenticatedStudioSession,
  createStudioProjectsServer,
  MemoryStudioObjectBucket,
  studioOwnerKey,
  type StudioObjectBucketListOptions,
  type StudioObjectBucketListResult,
  type StudioSourceArtifactLoadResult,
  type StudioSourceArtifacts,
} from "./server.js";

class TestSourceArtifacts implements StudioSourceArtifacts {
  readonly artifacts = new Map<string, { diagramId: string; title: string }>();

  async load(artifactId: string): Promise<StudioSourceArtifactLoadResult> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return {
        code: "not_found",
        message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
        ok: false,
        status: 404,
      };
    }

    return { artifact, ok: true };
  }
}

class PaginatedMemoryBucket extends MemoryStudioObjectBucket {
  readonly listCalls: StudioObjectBucketListOptions[] = [];

  override async list(
    options: StudioObjectBucketListOptions,
  ): Promise<StudioObjectBucketListResult> {
    this.listCalls.push(options);
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort();
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
    const objects = keys.slice(offset, offset + 1).map((key) => ({ key }));
    const nextOffset = offset + objects.length;

    return nextOffset < keys.length
      ? {
          cursor: String(nextOffset),
          objects,
          truncated: true,
        }
      : { objects, truncated: false };
  }
}

function createTestServer(
  bucket = new MemoryStudioObjectBucket(),
  sourceArtifacts = new TestSourceArtifacts(),
) {
  return {
    bucket,
    server: createStudioProjectsServer({ bucket, sourceArtifacts }),
    sourceArtifacts,
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

function nestedString(
  value: unknown,
  parentKey: string,
  childKey: string,
): string {
  if (isRecord(value)) {
    const parent = value[parentKey];
    if (isRecord(parent) && typeof parent[childKey] === "string") {
      return parent[childKey];
    }
  }
  throw new Error(`Response did not contain ${parentKey}.${childKey}.`);
}

function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Response did not set a session cookie.");
  }
  return setCookie.split(";")[0] ?? setCookie;
}

function anonymousRequest(sessionId: string): Request {
  return getRequest("https://studio.test/api/studio/projects", {
    Cookie: `sketchi_studio_session=${sessionId}`,
  });
}

describe("Studio project persistence", () => {
  it("creates studio records and reloads every response for the same anonymous session", async () => {
    const { bucket, server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-approval", {
      diagramId: "approval-flow",
      title: "Studio persistence approval flow",
    });

    const createResponse = await server.handleCreateFromArtifactRequest(
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId: "artifact-approval",
      }),
    );
    expect(createResponse.status).toBe(200);
    expect(createResponse.headers.get("cache-control")).toBe("no-store");
    expect(createResponse.headers.get("set-cookie")).toContain(
      "sketchi_studio_session=anon_",
    );
    expect(createResponse.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax; Max-Age=31536000; Secure",
    );

    const cookie = cookieHeaderFrom(createResponse);
    const created: unknown = await createResponse.json();
    const projectId = nestedString(created, "project", "id");
    const diagramId = nestedString(created, "diagram", "id");

    expect(created).toMatchObject({
      auth: { status: "anonymous" },
      diagram: {
        artifactDiagramId: "approval-flow",
        artifactId: "artifact-approval",
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
    expect([...bucket.objects.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^studio\/owners\/anonymous\/anon_[a-zA-Z0-9_-]+\/projects\/proj_[a-zA-Z0-9_-]+\.json$/,
        ),
        `studio/diagrams/${diagramId}.json`,
        `studio/projects/${projectId}.json`,
      ]),
    );
    expect(bucket.objects.size).toBe(3);

    const listResponse = await server.handleListProjectsRequest(
      getRequest("https://studio.test/api/studio/projects", {
        Cookie: cookie,
      }),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      projects: [{ id: projectId, primaryDiagramId: diagramId }],
    });

    const projectResponse = await server.handleGetProjectRequest(
      getRequest(`https://studio.test/api/studio/projects/${projectId}`, {
        Cookie: cookie,
      }),
      projectId,
    );
    expect(projectResponse.status).toBe(200);
    await expect(projectResponse.json()).resolves.toMatchObject({
      details: {
        diagrams: [{ artifactId: "artifact-approval", id: diagramId }],
        project: { id: projectId },
      },
      ok: true,
    });

    const diagramResponse = await server.handleGetDiagramRequest(
      getRequest(`https://studio.test/api/studio/diagrams/${diagramId}`, {
        Cookie: cookie,
      }),
      diagramId,
    );
    expect(diagramResponse.status).toBe(200);
    await expect(diagramResponse.json()).resolves.toMatchObject({
      diagram: { artifactId: "artifact-approval", id: diagramId },
      ok: true,
      project: { id: projectId },
    });
  });

  it("isolates lists and direct reads between anonymous sessions", async () => {
    const { server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-isolated", {
      diagramId: "isolated-flow",
      title: "Isolated Studio project",
    });
    const createResponse = await server.handleCreateFromArtifactRequest(
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId: "artifact-isolated",
      }),
    );
    const created: unknown = await createResponse.json();
    const projectId = nestedString(created, "project", "id");
    const diagramId = nestedString(created, "diagram", "id");

    const otherList = await server.handleListProjectsRequest(
      getRequest("https://studio.test/api/studio/projects"),
    );
    await expect(otherList.json()).resolves.toMatchObject({ projects: [] });

    const deniedProject = await server.handleGetProjectRequest(
      getRequest(`https://studio.test/api/studio/projects/${projectId}`),
      projectId,
    );
    const deniedDiagram = await server.handleGetDiagramRequest(
      getRequest(`https://studio.test/api/studio/diagrams/${diagramId}`),
      diagramId,
    );
    expect(deniedProject.status).toBe(404);
    expect(deniedDiagram.status).toBe(404);
  });

  it("stores and lists projects under authenticated ownership", async () => {
    const { server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-auth", {
      diagramId: "auth-flow",
      title: "Authenticated Studio project",
    });
    const session = createAuthenticatedStudioSession({
      displayName: "Ada",
      subjectId: "user_ada",
    });

    const created = await server.createFromArtifact({
      artifactId: "artifact-auth",
      session,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.message);
    }
    expect(studioOwnerKey(created.projectRecord.owner)).toBe(
      "authenticated/user_ada",
    );
    await expect(server.listProjects(session)).resolves.toEqual([
      expect.objectContaining({
        id: created.project.id,
        title: "Authenticated Studio project",
      }),
    ]);
  });

  it("keeps concurrent saves for one owner in independent index entries", async () => {
    const { server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-first", {
      diagramId: "first-flow",
      title: "First concurrent Studio save",
    });
    sourceArtifacts.artifacts.set("artifact-second", {
      diagramId: "second-flow",
      title: "Second concurrent Studio save",
    });
    const session = createAuthenticatedStudioSession({
      subjectId: "user_concurrent",
    });

    const [first, second] = await Promise.all([
      server.createFromArtifact({ artifactId: "artifact-first", session }),
      server.createFromArtifact({ artifactId: "artifact-second", session }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Concurrent Studio saves should both succeed.");
    }

    const projects = await server.listProjects(session);
    expect(new Set(projects.map((project) => project.id))).toEqual(
      new Set([first.project.id, second.project.id]),
    );
  });

  it("follows R2 cursors until a truncated owner listing is complete", async () => {
    const bucket = new PaginatedMemoryBucket();
    const { server, sourceArtifacts } = createTestServer(bucket);
    sourceArtifacts.artifacts.set("artifact-page-one", {
      diagramId: "page-one",
      title: "First page",
    });
    sourceArtifacts.artifacts.set("artifact-page-two", {
      diagramId: "page-two",
      title: "Second page",
    });
    const session = createAuthenticatedStudioSession({
      subjectId: "user_paginated",
    });
    await server.createFromArtifact({
      artifactId: "artifact-page-one",
      session,
    });
    await server.createFromArtifact({
      artifactId: "artifact-page-two",
      session,
    });

    await expect(server.listProjects(session)).resolves.toHaveLength(2);
    expect(bucket.listCalls).toEqual([
      {
        prefix: "studio/owners/authenticated/user_paginated/projects/",
      },
      {
        cursor: "1",
        prefix: "studio/owners/authenticated/user_paginated/projects/",
      },
    ]);
  });

  it("filters an owner-index entry whose project owner does not match", async () => {
    const { bucket, server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-owner", {
      diagramId: "owner-flow",
      title: "Owner mismatch",
    });
    const owner = createAuthenticatedStudioSession({ subjectId: "user_owner" });
    const otherOwner = createAuthenticatedStudioSession({
      subjectId: "user_other",
    });
    const created = await server.createFromArtifact({
      artifactId: "artifact-owner",
      session: owner,
    });
    if (!created.ok) {
      throw new Error(created.message);
    }
    const mismatchedRecord: StudioProjectRecord = {
      ...created.projectRecord,
      owner: otherOwner,
    };
    await bucket.put(
      `studio/projects/${created.project.id}.json`,
      JSON.stringify(mismatchedRecord),
    );

    await expect(server.listProjects(owner)).resolves.toEqual([]);
    await expect(
      server.getProject(owner, created.project.id),
    ).resolves.toBeNull();
  });

  it("skips schema-invalid records and reports invalid JSON as a storage failure", async () => {
    const sessionId = "anon_abcdefghijklmnop";
    const session: StudioOwner = { kind: "anonymous", sessionId };
    const { bucket, server } = createTestServer();
    const ownerPrefix = `studio/owners/${studioOwnerKey(session)}/projects`;
    await bucket.put(
      `${ownerPrefix}/proj_invalidshape.json`,
      JSON.stringify({
        ownerKey: studioOwnerKey(session),
        projectId: "proj_invalidshape",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    );
    await bucket.put(
      "studio/projects/proj_invalidshape.json",
      JSON.stringify({ id: "proj_invalidshape" }),
    );

    const skippedResponse = await server.handleListProjectsRequest(
      anonymousRequest(sessionId),
    );
    expect(skippedResponse.status).toBe(200);
    await expect(skippedResponse.json()).resolves.toMatchObject({
      ok: true,
      projects: [],
    });

    await bucket.put(
      `${ownerPrefix}/proj_brokenjson.json`,
      JSON.stringify({
        ownerKey: studioOwnerKey(session),
        projectId: "proj_brokenjson",
        updatedAt: "2026-07-16T00:00:01.000Z",
      }),
    );
    await bucket.put("studio/projects/proj_brokenjson.json", "{not-json");

    const malformedResponse = await server.handleListProjectsRequest(
      anonymousRequest(sessionId),
    );
    expect(malformedResponse.status).toBe(500);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      code: "storage_failed",
      ok: false,
    });
  });

  it("preserves source-artifact failures in the HTTP response without writes", async () => {
    const { bucket, server } = createTestServer();
    const response = await server.handleCreateFromArtifactRequest(
      postRequest("https://studio.test/api/studio/projects/from-artifact", {
        artifactId: "missing-artifact",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_found",
      ok: false,
    });
    expect([...bucket.objects.keys()]).toEqual([]);
  });
});
