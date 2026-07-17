import { nanoid } from "nanoid";
import { z } from "zod";

import {
  StudioDiagramRecordSchema,
  StudioProjectRecordSchema,
  studioDiagramEditUrl,
  studioDiagramUrl,
  studioProjectUrl,
  type StudioDiagramRecord,
  type StudioDiagramSummary,
  type StudioOwner,
  type StudioProjectDetails,
  type StudioProjectRecord,
  type StudioProjectSummary,
} from "../contracts.js";
import {
  putStudioJson,
  readStudioJson,
  type StudioObjectBucket,
} from "./bucket.js";
import type { StudioSourceArtifacts } from "./source-artifacts.js";

const STUDIO_PREFIX = "studio";

const StudioProjectIndexEntrySchema = z.object({
  ownerKey: z.string().min(1),
  projectId: z.string().min(1),
  updatedAt: z.string().min(1),
});

type StudioProjectIndexEntry = z.infer<typeof StudioProjectIndexEntrySchema>;

export interface StudioProjectOperationFailure {
  code: string;
  message: string;
  ok: false;
  status: number;
}

export interface StudioProjectCreateSuccess {
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

export type StudioProjectCreateResult =
  | StudioProjectCreateSuccess
  | StudioProjectOperationFailure;

export interface StudioProjectsService {
  createFromArtifact(input: {
    artifactId: string;
    session: StudioOwner;
  }): Promise<StudioProjectCreateResult>;
  getDiagram(
    session: StudioOwner,
    diagramId: string,
  ): Promise<{
    diagram: StudioDiagramSummary;
    project: StudioProjectSummary;
  } | null>;
  getProject(
    session: StudioOwner,
    projectId: string,
  ): Promise<StudioProjectDetails | null>;
  listProjects(session: StudioOwner): Promise<StudioProjectSummary[]>;
}

export interface StudioProjectsServiceOptions {
  bucket: StudioObjectBucket;
  createId?: (kind: "dia" | "proj") => string;
  now?: () => string;
  sourceArtifacts: StudioSourceArtifacts;
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
  bucket: StudioObjectBucket,
  projectId: string,
): Promise<StudioProjectRecord | null> {
  return readStudioJson(
    bucket,
    projectKey(projectId),
    StudioProjectRecordSchema,
  );
}

async function readDiagramRecord(
  bucket: StudioObjectBucket,
  diagramId: string,
): Promise<StudioDiagramRecord | null> {
  return readStudioJson(
    bucket,
    diagramKey(diagramId),
    StudioDiagramRecordSchema,
  );
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
      readStudioJson(bucket, entryKey, StudioProjectIndexEntrySchema),
    ),
  );

  return entries.flatMap((entry) =>
    entry && entry.ownerKey === ownerKey ? [entry.projectId] : [],
  );
}

async function writeOwnerProjectEntry(
  bucket: StudioObjectBucket,
  session: StudioOwner,
  projectId: string,
  updatedAt: string,
): Promise<void> {
  const entry = {
    ownerKey: studioOwnerKey(session),
    projectId,
    updatedAt,
  } satisfies StudioProjectIndexEntry;

  await putStudioJson(bucket, ownerProjectEntryKey(session, projectId), entry);
}

export function createStudioProjectsService(
  options: StudioProjectsServiceOptions,
): StudioProjectsService {
  const createId =
    options.createId ?? ((kind: "dia" | "proj") => `${kind}_${nanoid(14)}`);
  const now = options.now ?? (() => new Date().toISOString());

  const listProjects = async (
    session: StudioOwner,
  ): Promise<StudioProjectSummary[]> => {
    const projectIds = await listOwnerProjectIds(options.bucket, session);
    const records = await Promise.all(
      projectIds.map((projectId) =>
        readProjectRecord(options.bucket, projectId),
      ),
    );

    return sortedProjects(
      records.flatMap((record) =>
        record && ownersMatch(record.owner, session)
          ? [projectSummary(record)]
          : [],
      ),
    );
  };

  const getProject = async (
    session: StudioOwner,
    projectId: string,
  ): Promise<StudioProjectDetails | null> => {
    const project = await readProjectRecord(options.bucket, projectId);
    if (!project || !ownersMatch(project.owner, session)) {
      return null;
    }

    const diagrams = await Promise.all(
      project.diagramIds.map((diagramId) =>
        readDiagramRecord(options.bucket, diagramId),
      ),
    );

    return {
      diagrams: diagrams.flatMap((diagram) =>
        diagram && ownersMatch(diagram.owner, session)
          ? [diagramSummary(diagram)]
          : [],
      ),
      project: projectSummary(project),
    };
  };

  const getDiagram = async (
    session: StudioOwner,
    diagramId: string,
  ): Promise<{
    diagram: StudioDiagramSummary;
    project: StudioProjectSummary;
  } | null> => {
    const diagram = await readDiagramRecord(options.bucket, diagramId);
    if (!diagram || !ownersMatch(diagram.owner, session)) {
      return null;
    }

    const project = await readProjectRecord(options.bucket, diagram.projectId);
    if (!project || !ownersMatch(project.owner, session)) {
      return null;
    }

    return {
      diagram: diagramSummary(diagram),
      project: projectSummary(project),
    };
  };

  const createFromArtifact = async (input: {
    artifactId: string;
    session: StudioOwner;
  }): Promise<StudioProjectCreateResult> => {
    const sourceArtifact = await options.sourceArtifacts.load(input.artifactId);
    if (!sourceArtifact.ok) {
      return sourceArtifact;
    }

    const createdAt = now();
    const projectId = createId("proj");
    const diagramId = createId("dia");
    const source = {
      artifactId: input.artifactId,
      kind: "playground-artifact",
    } satisfies StudioProjectRecord["source"];
    const diagram: StudioDiagramRecord = {
      artifactDiagramId: sourceArtifact.artifact.diagramId,
      artifactId: input.artifactId,
      createdAt,
      id: diagramId,
      owner: input.session,
      projectId,
      source,
      title: sourceArtifact.artifact.title,
      updatedAt: createdAt,
    };
    const project: StudioProjectRecord = {
      createdAt,
      diagramIds: [diagram.id],
      id: projectId,
      owner: input.session,
      source,
      title: sourceArtifact.artifact.title,
      updatedAt: createdAt,
    };

    await putStudioJson(options.bucket, diagramKey(diagram.id), diagram);
    await putStudioJson(options.bucket, projectKey(project.id), project);
    await writeOwnerProjectEntry(
      options.bucket,
      input.session,
      project.id,
      createdAt,
    );

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
  };

  return {
    createFromArtifact,
    getDiagram,
    getProject,
    listProjects,
  };
}
