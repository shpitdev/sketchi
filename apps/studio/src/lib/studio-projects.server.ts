import "@tanstack/react-start/server-only";

import {
  RenderedDiagramSceneSchema,
  type CodeModeObjectBucket,
  type CodeModeObjectBucketObject,
} from "@sketchi/diagram-agent";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { StudioEnv } from "./agent.server";
import { createStudioCodeModeRuntime } from "./codemode-api.server";
import {
  CreateStudioProjectFromArtifactRequestSchema,
  StudioDiagramRecordSchema,
  StudioProjectRecordSchema,
  studioDiagramEditUrl,
  studioDiagramUrl,
  studioProjectUrl,
  type StudioAuthStatus,
  type StudioDiagramRecord,
  type StudioDiagramSummary,
  type StudioOwner,
  type StudioProjectDetails,
  type StudioProjectRecord,
  type StudioProjectSummary,
  type StudioPublicSession,
} from "./studio-projects-contract";

const STUDIO_PREFIX = "studio";
const STUDIO_SESSION_COOKIE = "sketchi_studio_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const ANONYMOUS_SESSION_PATTERN = /^anon_[a-zA-Z0-9_-]{12,64}$/;

const StudioProjectIndexEntrySchema = z.object({
  ownerKey: z.string().min(1),
  projectId: z.string().min(1),
  updatedAt: z.string().min(1),
});

type StudioProjectIndexEntry = z.infer<typeof StudioProjectIndexEntrySchema>;

interface StudioObjectBucketListEntry {
  key: string;
}

interface StudioObjectBucketListOptions {
  cursor?: string;
  prefix: string;
}

interface StudioObjectBucketListResult {
  cursor?: string;
  objects: readonly StudioObjectBucketListEntry[];
  truncated?: boolean;
}

interface StudioObjectBucket extends CodeModeObjectBucket {
  list(
    options: StudioObjectBucketListOptions,
  ): Promise<StudioObjectBucketListResult>;
}

interface StudioSessionResolution {
  auth: StudioAuthStatus;
  session: StudioOwner;
  publicSession: StudioPublicSession;
  setCookie?: string;
}

interface StudioProjectOperationFailure {
  code: string;
  message: string;
  ok: false;
  status: number;
}

interface StudioProjectCreateSuccess {
  diagram: StudioDiagramSummary;
  diagramRecord: StudioDiagramRecord;
  ok: true;
  project: StudioProjectSummary;
  projectRecord: StudioProjectRecord;
  urls: {
    diagram: string;
    edit: string;
    project: string;
  };
}

type StudioProjectCreateResult =
  | StudioProjectCreateSuccess
  | StudioProjectOperationFailure;

class MemoryStudioBucket implements StudioObjectBucket {
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

  async list(
    options: StudioObjectBucketListOptions,
  ): Promise<StudioObjectBucketListResult> {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .sort()
        .map((key) => ({ key })),
      truncated: false,
    };
  }
}

const localStudioBucket = new MemoryStudioBucket();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStudioObjectBucket(
  bucket: CodeModeObjectBucket,
): bucket is StudioObjectBucket {
  return isRecord(bucket) && typeof bucket["list"] === "function";
}

function bucketForEnv(env: StudioEnv): StudioObjectBucket {
  const bucket = env.SKETCHI_ARTIFACTS ?? localStudioBucket;

  if (!isStudioObjectBucket(bucket)) {
    throw new Error(
      "Studio persistence requires an object bucket with list support.",
    );
  }

  return bucket;
}

function keySegment(value: string): string {
  return encodeURIComponent(value);
}

export function studioOwnerKey(owner: StudioOwner): string {
  return owner.kind === "authenticated"
    ? `authenticated/${keySegment(owner.subjectId)}`
    : `anonymous/${keySegment(owner.sessionId)}`;
}

function ownerProjectsPrefix(owner: StudioOwner): string {
  return `${STUDIO_PREFIX}/owners/${studioOwnerKey(owner)}/projects/`;
}

function ownerProjectEntryKey(owner: StudioOwner, projectId: string): string {
  return `${ownerProjectsPrefix(owner)}${keySegment(projectId)}.json`;
}

function projectKey(projectId: string): string {
  return `${STUDIO_PREFIX}/projects/${keySegment(projectId)}.json`;
}

function diagramKey(diagramId: string): string {
  return `${STUDIO_PREFIX}/diagrams/${keySegment(diagramId)}.json`;
}

function ownersMatch(left: StudioOwner, right: StudioOwner): boolean {
  return studioOwnerKey(left) === studioOwnerKey(right);
}

async function readJson<T>(
  bucket: CodeModeObjectBucket,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) {
    return null;
  }

  const parsed = schema.safeParse(JSON.parse(await object.text()));
  return parsed.success ? parsed.data : null;
}

async function putJson(
  bucket: CodeModeObjectBucket,
  key: string,
  value: unknown,
): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}

function publicSession(session: StudioOwner): StudioPublicSession {
  if (session.kind === "authenticated") {
    return session.displayName
      ? { displayName: session.displayName, kind: "authenticated" }
      : { kind: "authenticated" };
  }

  return { kind: "anonymous" };
}

function authStatus(session: StudioOwner): StudioAuthStatus {
  if (session.kind === "authenticated") {
    return session.displayName
      ? { displayName: session.displayName, status: "authenticated" }
      : { status: "authenticated" };
  }

  return {
    message:
      "Studio persistence is using an anonymous session cookie until product auth is wired.",
    status: "anonymous",
  };
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("Cookie");
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }

  return undefined;
}

function sessionCookie(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(
    sessionId,
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}${secure}`;
}

export function createAuthenticatedStudioSession(input: {
  displayName?: string;
  subjectId: string;
}): StudioOwner {
  return input.displayName
    ? {
        displayName: input.displayName,
        kind: "authenticated",
        subjectId: input.subjectId,
      }
    : {
        kind: "authenticated",
        subjectId: input.subjectId,
      };
}

export function resolveStudioSession(
  request: Request,
): StudioSessionResolution {
  const existingSessionId = cookieValue(request, STUDIO_SESSION_COOKIE);

  if (existingSessionId && ANONYMOUS_SESSION_PATTERN.test(existingSessionId)) {
    const session: StudioOwner = {
      kind: "anonymous",
      sessionId: existingSessionId,
    };
    return {
      auth: authStatus(session),
      publicSession: publicSession(session),
      session,
    };
  }

  const session: StudioOwner = {
    kind: "anonymous",
    sessionId: `anon_${nanoid(24)}`,
  };

  return {
    auth: authStatus(session),
    publicSession: publicSession(session),
    session,
    setCookie: sessionCookie(session.sessionId, request),
  };
}

function projectSummary(record: StudioProjectRecord): StudioProjectSummary {
  return {
    createdAt: record.createdAt,
    diagramCount: record.diagramIds.length,
    id: record.id,
    primaryDiagramId: record.diagramIds[0],
    source: record.source,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

function diagramSummary(record: StudioDiagramRecord): StudioDiagramSummary {
  return {
    artifactDiagramId: record.artifactDiagramId,
    artifactId: record.artifactId,
    createdAt: record.createdAt,
    editUrl: studioDiagramEditUrl(record.id),
    id: record.id,
    projectId: record.projectId,
    reviewUrl: studioDiagramUrl(record.id),
    source: record.source,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

function sortedProjects(
  projects: StudioProjectSummary[],
): StudioProjectSummary[] {
  return [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

async function readProjectRecord(
  bucket: CodeModeObjectBucket,
  projectId: string,
): Promise<StudioProjectRecord | null> {
  return readJson(bucket, projectKey(projectId), StudioProjectRecordSchema);
}

async function readDiagramRecord(
  bucket: CodeModeObjectBucket,
  diagramId: string,
): Promise<StudioDiagramRecord | null> {
  return readJson(bucket, diagramKey(diagramId), StudioDiagramRecordSchema);
}

async function writeProjectRecord(
  bucket: CodeModeObjectBucket,
  record: StudioProjectRecord,
): Promise<void> {
  await putJson(bucket, projectKey(record.id), record);
}

async function writeDiagramRecord(
  bucket: CodeModeObjectBucket,
  record: StudioDiagramRecord,
): Promise<void> {
  await putJson(bucket, diagramKey(record.id), record);
}

async function listOwnerProjectEntryKeys(
  bucket: StudioObjectBucket,
  session: StudioOwner,
): Promise<string[]> {
  const prefix = ownerProjectsPrefix(session);
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await bucket.list(cursor ? { cursor, prefix } : { prefix });
    keys.push(...result.objects.map((object) => object.key));
    cursor =
      result.truncated === true && result.cursor ? result.cursor : undefined;
  } while (cursor);

  return keys;
}

async function listOwnerProjectIds(
  bucket: StudioObjectBucket,
  session: StudioOwner,
): Promise<string[]> {
  const ownerKey = studioOwnerKey(session);
  const entryKeys = await listOwnerProjectEntryKeys(bucket, session);
  const entries = await Promise.all(
    entryKeys.map((entryKey) =>
      readJson(bucket, entryKey, StudioProjectIndexEntrySchema),
    ),
  );

  return entries.flatMap((entry) =>
    entry && entry.ownerKey === ownerKey ? [entry.projectId] : [],
  );
}

async function writeOwnerProjectEntry(
  bucket: CodeModeObjectBucket,
  session: StudioOwner,
  projectId: string,
  updatedAt: string,
): Promise<void> {
  const entry = {
    ownerKey: studioOwnerKey(session),
    projectId,
    updatedAt,
  } satisfies StudioProjectIndexEntry;

  await putJson(bucket, ownerProjectEntryKey(session, projectId), entry);
}

export async function listStudioProjects(
  env: StudioEnv,
  session: StudioOwner,
): Promise<StudioProjectSummary[]> {
  const bucket = bucketForEnv(env);
  const projectIds = await listOwnerProjectIds(bucket, session);
  const records = await Promise.all(
    projectIds.map((projectId) => readProjectRecord(bucket, projectId)),
  );

  return sortedProjects(
    records.flatMap((record) =>
      record && ownersMatch(record.owner, session)
        ? [projectSummary(record)]
        : [],
    ),
  );
}

export async function getStudioProjectDetails(
  env: StudioEnv,
  session: StudioOwner,
  projectId: string,
): Promise<StudioProjectDetails | null> {
  const bucket = bucketForEnv(env);
  const project = await readProjectRecord(bucket, projectId);
  if (!project || !ownersMatch(project.owner, session)) {
    return null;
  }

  const diagrams = await Promise.all(
    project.diagramIds.map((diagramId) => readDiagramRecord(bucket, diagramId)),
  );

  return {
    diagrams: diagrams.flatMap((diagram) =>
      diagram && ownersMatch(diagram.owner, session)
        ? [diagramSummary(diagram)]
        : [],
    ),
    project: projectSummary(project),
  };
}

export async function getStudioDiagramDetails(
  env: StudioEnv,
  session: StudioOwner,
  diagramId: string,
): Promise<{
  diagram: StudioDiagramSummary;
  project: StudioProjectSummary;
} | null> {
  const bucket = bucketForEnv(env);
  const diagram = await readDiagramRecord(bucket, diagramId);
  if (!diagram || !ownersMatch(diagram.owner, session)) {
    return null;
  }

  const project = await readProjectRecord(bucket, diagram.projectId);
  if (!project || !ownersMatch(project.owner, session)) {
    return null;
  }

  return {
    diagram: diagramSummary(diagram),
    project: projectSummary(project),
  };
}

export async function createStudioProjectFromArtifact(
  env: StudioEnv,
  request: Request,
  input: {
    artifactId: string;
    session: StudioOwner;
  },
): Promise<StudioProjectCreateResult> {
  const artifact = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).getArtifact({
    artifactId: input.artifactId,
    format: "scene",
    inline: true,
  });

  if (!artifact.ok) {
    return {
      code: artifact.status,
      message: `Playground artifact "${input.artifactId}" is not available for Studio persistence.`,
      ok: false,
      status: artifact.status === "storage_failed" ? 500 : 404,
    };
  }

  const scene = RenderedDiagramSceneSchema.safeParse(artifact.inline);
  if (!scene.success) {
    return {
      code: "invalid_scene",
      message: `Playground artifact "${input.artifactId}" does not include a renderable scene.`,
      ok: false,
      status: 422,
    };
  }

  const bucket = bucketForEnv(env);
  const now = new Date().toISOString();
  const projectId = `proj_${nanoid(14)}`;
  const diagramId = `dia_${nanoid(14)}`;
  const source = {
    artifactId: input.artifactId,
    kind: "playground-artifact",
  } satisfies StudioProjectRecord["source"];
  const diagram: StudioDiagramRecord = {
    artifactDiagramId: artifact.diagramId,
    artifactId: input.artifactId,
    createdAt: now,
    id: diagramId,
    owner: input.session,
    projectId,
    source,
    title: scene.data.title,
    updatedAt: now,
  };
  const project: StudioProjectRecord = {
    createdAt: now,
    diagramIds: [diagram.id],
    id: projectId,
    owner: input.session,
    source,
    title: scene.data.title,
    updatedAt: now,
  };

  await writeDiagramRecord(bucket, diagram);
  await writeProjectRecord(bucket, project);
  await writeOwnerProjectEntry(bucket, input.session, project.id, now);

  return {
    diagram: diagramSummary(diagram),
    diagramRecord: diagram,
    ok: true,
    project: projectSummary(project),
    projectRecord: project,
    urls: {
      diagram: studioDiagramUrl(diagram.id),
      edit: studioDiagramEditUrl(diagram.id),
      project: studioProjectUrl(project.id),
    },
  };
}

async function readRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function responseHeaders(resolution: StudioSessionResolution): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
  });

  if (resolution.setCookie) {
    headers.append("Set-Cookie", resolution.setCookie);
  }

  return headers;
}

function jsonWithSession(
  resolution: StudioSessionResolution,
  body: unknown,
  status = 200,
): Response {
  return Response.json(body, {
    headers: responseHeaders(resolution),
    status,
  });
}

function projectNotFoundResponse(
  resolution: StudioSessionResolution,
): Response {
  return jsonWithSession(
    resolution,
    {
      code: "not_found",
      message: "Studio project was not found for this session.",
      ok: false,
    },
    404,
  );
}

function diagramNotFoundResponse(
  resolution: StudioSessionResolution,
): Response {
  return jsonWithSession(
    resolution,
    {
      code: "not_found",
      message: "Studio diagram was not found for this session.",
      ok: false,
    },
    404,
  );
}

function storageFailureResponse(
  resolution: StudioSessionResolution,
  error: unknown,
): Response {
  return jsonWithSession(
    resolution,
    {
      code: "storage_failed",
      message:
        error instanceof Error ? error.message : "Studio persistence failed.",
      ok: false,
    },
    500,
  );
}

export async function handleListStudioProjectsRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const resolution = resolveStudioSession(request);
  try {
    const projects = await listStudioProjects(env, resolution.session);
    return jsonWithSession(resolution, {
      auth: resolution.auth,
      ok: true,
      projects,
      session: resolution.publicSession,
    });
  } catch (error) {
    return storageFailureResponse(resolution, error);
  }
}

export async function handleCreateStudioProjectFromArtifactRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const resolution = resolveStudioSession(request);
  const body = await readRequestJson(request);
  const parsed = CreateStudioProjectFromArtifactRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonWithSession(
      resolution,
      {
        code: "invalid_input",
        message: "A playground artifactId is required.",
        ok: false,
      },
      400,
    );
  }

  try {
    const result = await createStudioProjectFromArtifact(env, request, {
      artifactId: parsed.data.artifactId,
      session: resolution.session,
    });

    if (!result.ok) {
      return jsonWithSession(
        resolution,
        {
          code: result.code,
          message: result.message,
          ok: false,
        },
        result.status,
      );
    }

    return jsonWithSession(resolution, {
      auth: resolution.auth,
      diagram: result.diagram,
      ok: true,
      project: result.project,
      session: resolution.publicSession,
      urls: result.urls,
    });
  } catch (error) {
    return storageFailureResponse(resolution, error);
  }
}

export async function handleGetStudioProjectRequest(
  env: StudioEnv,
  request: Request,
  projectId: string,
): Promise<Response> {
  const resolution = resolveStudioSession(request);
  try {
    const details = await getStudioProjectDetails(
      env,
      resolution.session,
      projectId,
    );
    if (!details) {
      return projectNotFoundResponse(resolution);
    }

    return jsonWithSession(resolution, {
      auth: resolution.auth,
      details,
      ok: true,
      session: resolution.publicSession,
    });
  } catch (error) {
    return storageFailureResponse(resolution, error);
  }
}

export async function handleGetStudioDiagramRequest(
  env: StudioEnv,
  request: Request,
  diagramId: string,
): Promise<Response> {
  const resolution = resolveStudioSession(request);
  try {
    const details = await getStudioDiagramDetails(
      env,
      resolution.session,
      diagramId,
    );
    if (!details) {
      return diagramNotFoundResponse(resolution);
    }

    return jsonWithSession(resolution, {
      auth: resolution.auth,
      diagram: details.diagram,
      ok: true,
      project: details.project,
      session: resolution.publicSession,
    });
  } catch (error) {
    return storageFailureResponse(resolution, error);
  }
}
