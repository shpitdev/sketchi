import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  handleCreateFromArtifactRequestEffect,
  handleGetDiagramRequestEffect,
  handleGetProjectRequestEffect,
  handleListProjectsRequestEffect,
  makeIsoDateString,
  makeStudioRecordId,
  makeStudioObjectStoreLayer,
  makeStudioPersistencePolicyLayer,
  makeStudioRecordFactoryLayer,
  MemoryStudioObjectBucket,
  StudioPersistencePolicyLive,
  StudioProjectsLive,
  StudioRecordFactoryLive,
  StudioSessionServiceLive,
  StudioSourceArtifactError,
  StudioSourceArtifactStore,
  studioDiagramRecordKey,
  studioOwnerKey,
  studioOwnerProjectEntryKey,
  studioProjectRecordKey,
  type StudioObjectBucketListOptions,
  type StudioObjectBucketListResult,
  type StudioOwner,
  type StudioProjectRecord,
  type StudioSourceArtifactStoreShape,
} from "./server.js";

class TestSourceArtifacts implements StudioSourceArtifactStoreShape {
  readonly artifacts = new Map<string, { diagramId: string; title: string }>();

  load(artifactId: string) {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return Effect.fail(
        StudioSourceArtifactError.make({
          artifactId,
          code: "not_found",
          message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
          status: 404,
        }),
      );
    }

    return Effect.succeed(artifact);
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

function createTestServer<
  SourceArtifacts extends StudioSourceArtifactStoreShape = TestSourceArtifacts,
>(
  bucket = new MemoryStudioObjectBucket(),
  sourceArtifacts: SourceArtifacts = new TestSourceArtifacts() as unknown as SourceArtifacts,
  overrides: {
    createId?: (kind: "dia" | "proj") => string;
    listingConcurrency?: number;
    now?: () => string;
  } = {},
) {
  const dependencies = Layer.mergeAll(
    makeStudioObjectStoreLayer(bucket),
    Layer.succeed(StudioSourceArtifactStore, sourceArtifacts),
    overrides.listingConcurrency === undefined
      ? StudioPersistencePolicyLive
      : makeStudioPersistencePolicyLayer({
          listingConcurrency: overrides.listingConcurrency,
        }),
    overrides.createId || overrides.now
      ? makeStudioRecordFactoryLayer({
          createId: (kind) =>
            makeStudioRecordId(
              (overrides.createId ??
                ((recordKind) =>
                  recordKind === "proj" ? "proj_test" : "dia_test"))(kind),
            ),
          now: Effect.succeed(
            makeIsoDateString(
              overrides.now?.() ?? "2026-07-20T02:00:00.000Z",
            ),
          ),
        })
      : StudioRecordFactoryLive,
    StudioSessionServiceLive,
  );
  const appLayer = StudioProjectsLive.pipe(Layer.provideMerge(dependencies));
  const run = <A>(
    effect: Effect.Effect<A, never, Layer.Success<typeof appLayer>>,
    signal: AbortSignal,
  ) => Effect.runPromise(effect.pipe(Effect.provide(appLayer)), { signal });
  return {
    bucket,
    server: {
      handleCreateFromArtifactRequest: (request: Request) =>
        run(handleCreateFromArtifactRequestEffect(request), request.signal),
      handleGetDiagramRequest: (request: Request, diagramId: string) =>
        run(handleGetDiagramRequestEffect(request, diagramId), request.signal),
      handleGetProjectRequest: (request: Request, projectId: string) =>
        run(handleGetProjectRequestEffect(request, projectId), request.signal),
      handleListProjectsRequest: (request: Request) =>
        run(handleListProjectsRequestEffect(request), request.signal),
    },
    sourceArtifacts,
  };
}

function postRequest(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
  signal?: AbortSignal,
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
    ...(signal ? { signal } : {}),
  });
}

function requestWithSession(url: string, sessionId: string): Request {
  return new Request(url, {
    headers: { Cookie: `sketchi_studio_session=${sessionId}` },
  });
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

describe("Studio project HTTP runtime edge", () => {
  it("preserves keys, bytes, identifiers, and HTTP bodies for valid records", async () => {
    const sessionId = "anon_abcdefghijklmnop";
    const owner: StudioOwner = {
      kind: "anonymous",
      sessionId: makeStudioRecordId(sessionId),
    };
    const createdAt = "2026-07-20T02:00:00.000Z";
    const { bucket, server, sourceArtifacts } = createTestServer(
      new MemoryStudioObjectBucket(),
      new TestSourceArtifacts(),
      {
        createId: (kind) =>
          kind === "proj" ? "proj_persisted" : "dia_persisted",
        now: () => createdAt,
      },
    );
    sourceArtifacts.artifacts.set("artifact-approval", {
      diagramId: "approval-flow",
      title: "Studio persistence approval flow",
    });

    const createResponse = await server.handleCreateFromArtifactRequest(
      postRequest(
        "https://studio.test/api/studio/projects/from-artifact",
        { artifactId: "artifact-approval" },
        { Cookie: `sketchi_studio_session=${sessionId}` },
      ),
    );
    expect(createResponse.status).toBe(200);
    expect(createResponse.headers.get("cache-control")).toBe("no-store");
    const created: unknown = await createResponse.json();
    expect(created).toMatchObject({
      auth: { status: "anonymous" },
      diagram: {
        artifactDiagramId: "approval-flow",
        artifactId: "artifact-approval",
        id: "dia_persisted",
        projectId: "proj_persisted",
        reviewUrl: "/diagrams/dia_persisted",
        title: "Studio persistence approval flow",
      },
      ok: true,
      project: {
        diagramCount: 1,
        id: "proj_persisted",
        primaryDiagramId: "dia_persisted",
      },
      urls: {
        diagram: "/diagrams/dia_persisted",
        edit: "/diagrams/dia_persisted/edit",
        project: "/projects/proj_persisted",
      },
    });

    const source: StudioProjectRecord["source"] = {
      artifactId: "artifact-approval",
      kind: "playground-artifact",
    };
    expect(bucket.objects).toEqual(
      new Map([
        [
          studioDiagramRecordKey("dia_persisted"),
          JSON.stringify({
            artifactDiagramId: "approval-flow",
            artifactId: "artifact-approval",
            createdAt,
            id: "dia_persisted",
            owner,
            projectId: "proj_persisted",
            source,
            title: "Studio persistence approval flow",
            updatedAt: createdAt,
          }),
        ],
        [
          studioProjectRecordKey("proj_persisted"),
          JSON.stringify({
            createdAt,
            diagramIds: ["dia_persisted"],
            id: "proj_persisted",
            owner,
            source,
            title: "Studio persistence approval flow",
            updatedAt: createdAt,
          }),
        ],
        [
          studioOwnerProjectEntryKey(owner, "proj_persisted"),
          JSON.stringify({
            ownerKey: studioOwnerKey(owner),
            projectId: "proj_persisted",
            updatedAt: createdAt,
          }),
        ],
      ]),
    );

    const listResponse = await server.handleListProjectsRequest(
      requestWithSession("https://studio.test/api/studio/projects", sessionId),
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      projects: [{ id: "proj_persisted", primaryDiagramId: "dia_persisted" }],
    });

    const projectResponse = await server.handleGetProjectRequest(
      requestWithSession(
        "https://studio.test/api/studio/projects/proj_persisted",
        sessionId,
      ),
      "proj_persisted",
    );
    expect(projectResponse.status).toBe(200);
    await expect(projectResponse.json()).resolves.toMatchObject({
      details: {
        diagrams: [{ id: "dia_persisted" }],
        project: { id: "proj_persisted" },
      },
      ok: true,
    });
  });

  it("sets the preserved anonymous cookie contract", async () => {
    const { server } = createTestServer();
    const response = await server.handleListProjectsRequest(
      new Request("https://studio.test/api/studio/projects"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "sketchi_studio_session=anon_",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax; Max-Age=31536000; Secure",
    );
  });

  it("maps malformed session cookies to a stable public failure", async () => {
    const { server } = createTestServer();
    const response = await server.handleListProjectsRequest(
      new Request("https://studio.test/api/studio/projects", {
        headers: { Cookie: "sketchi_studio_session=%E0%A4%A" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "storage_failed",
      message: "Studio session could not be resolved.",
      ok: false,
    });
  });

  it("keeps ownership failures concealed behind the existing 404 contract", async () => {
    const firstSession = "anon_abcdefghijklmnop";
    const secondSession = "anon_qrstuvwxyzabcdef";
    const { server, sourceArtifacts } = createTestServer();
    sourceArtifacts.artifacts.set("artifact-isolated", {
      diagramId: "isolated-flow",
      title: "Isolated Studio project",
    });
    const createResponse = await server.handleCreateFromArtifactRequest(
      postRequest(
        "https://studio.test/api/studio/projects/from-artifact",
        { artifactId: "artifact-isolated" },
        { Cookie: `sketchi_studio_session=${firstSession}` },
      ),
    );
    const created: unknown = await createResponse.json();
    const projectId = nestedString(created, "project", "id");
    const diagramId = nestedString(created, "diagram", "id");

    const deniedProject = await server.handleGetProjectRequest(
      requestWithSession(
        `https://studio.test/api/studio/projects/${projectId}`,
        secondSession,
      ),
      projectId,
    );
    const deniedDiagram = await server.handleGetDiagramRequest(
      requestWithSession(
        `https://studio.test/api/studio/diagrams/${diagramId}`,
        secondSession,
      ),
      diagramId,
    );

    expect(deniedProject.status).toBe(404);
    expect(deniedDiagram.status).toBe(404);
    await expect(deniedProject.json()).resolves.toMatchObject({
      code: "not_found",
      message: "Studio project was not found for this session.",
      ok: false,
    });
  });

  it("follows R2 cursors until the owner listing is complete", async () => {
    const bucket = new PaginatedMemoryBucket();
    const ids = ["proj_pageone", "dia_pageone", "proj_pagetwo", "dia_pagetwo"];
    const { server, sourceArtifacts } = createTestServer(
      bucket,
      new TestSourceArtifacts(),
      { createId: () => ids.shift() ?? "proj_fallback" },
    );
    sourceArtifacts.artifacts.set("artifact-page-one", {
      diagramId: "page-one",
      title: "First page",
    });
    sourceArtifacts.artifacts.set("artifact-page-two", {
      diagramId: "page-two",
      title: "Second page",
    });
    const sessionId = "anon_abcdefghijklmnop";

    for (const artifactId of ["artifact-page-one", "artifact-page-two"]) {
      const response = await server.handleCreateFromArtifactRequest(
        postRequest(
          "https://studio.test/api/studio/projects/from-artifact",
          { artifactId },
          { Cookie: `sketchi_studio_session=${sessionId}` },
        ),
      );
      expect(response.status).toBe(200);
    }

    const response = await server.handleListProjectsRequest(
      requestWithSession("https://studio.test/api/studio/projects", sessionId),
    );
    const payload: unknown = await response.json();
    expect(
      isRecord(payload) &&
        Array.isArray(payload["projects"]) &&
        payload["projects"].length,
    ).toBe(2);
    expect(bucket.listCalls).toEqual([
      {
        prefix: `studio/owners/anonymous/${sessionId}/projects/`,
      },
      {
        cursor: "1",
        prefix: `studio/owners/anonymous/${sessionId}/projects/`,
      },
    ]);
  });

  it.each([
    [
      "schema-invalid JSON",
      JSON.stringify({ id: "proj_corrupt" }),
      "Stored Studio data could not be decoded.",
    ],
    [
      "syntactically invalid JSON",
      "{not-json",
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    ],
    ["empty bytes", "", "Unexpected end of JSON input"],
  ])(
    "maps %s to typed corruption instead of not-found",
    async (_, bytes, expectedMessage) => {
      const bucket = new MemoryStudioObjectBucket();
      const { server } = createTestServer(bucket);
      await bucket.put(studioProjectRecordKey("proj_corrupt"), bytes);

      const response = await server.handleGetProjectRequest(
        requestWithSession(
          "https://studio.test/api/studio/projects/proj_corrupt",
          "anon_abcdefghijklmnop",
        ),
        "proj_corrupt",
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        code: "storage_failed",
        message: expectedMessage,
        ok: false,
      });
    },
  );

  it("propagates request cancellation without committing records", async () => {
    const bucket = new MemoryStudioObjectBucket();
    const controller = new AbortController();
    let sourceInterrupted = false;
    let sourceLoadStarted: (() => void) | undefined;
    const sourceStarted = new Promise<void>((resolve) => {
      sourceLoadStarted = resolve;
    });
    const sourceArtifacts: StudioSourceArtifactStoreShape = {
      load: () =>
        Effect.sync(() => sourceLoadStarted?.()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              sourceInterrupted = true;
            }),
          ),
        ),
    };
    const { server } = createTestServer(bucket, sourceArtifacts);
    const response = server.handleCreateFromArtifactRequest(
      postRequest(
        "https://studio.test/api/studio/projects/from-artifact",
        { artifactId: "artifact-cancelled" },
        {},
        controller.signal,
      ),
    );

    await sourceStarted;
    controller.abort();

    await expect(response).rejects.toThrow();
    expect(sourceInterrupted).toBe(true);
    expect(bucket.objects.size).toBe(0);
  });

  it("preserves source-artifact failure responses without writes", async () => {
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

  it("preserves the invalid request body contract", async () => {
    const { server } = createTestServer();
    const response = await server.handleCreateFromArtifactRequest(
      postRequest("https://studio.test/api/studio/projects/from-artifact", {}),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_input",
      message: "A playground artifactId is required.",
      ok: false,
    });
  });
});
