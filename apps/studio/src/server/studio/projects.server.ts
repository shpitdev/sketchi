import "@tanstack/react-start/server-only";

import { RenderedDiagramSceneSchema } from "@sketchi/diagram-agent";
import {
  createStudioProjectsServer,
  isStudioObjectBucket,
  MemoryStudioObjectBucket,
  type StudioObjectBucket,
  type StudioProjectsServer,
  type StudioSourceArtifacts,
} from "@sketchi/studio-projects/server";

import type { StudioEnv } from "../../lib/agent.server";
import { createStudioCodeModeRuntime } from "../../lib/codemode-api.server";

const localStudioBucket = new MemoryStudioObjectBucket();

function studioBucketForEnv(env: StudioEnv): StudioObjectBucket {
  const bucket = env.SKETCHI_ARTIFACTS ?? localStudioBucket;

  if (isStudioObjectBucket(bucket)) {
    return bucket;
  }

  const unavailable = () =>
    new Error(
      "Studio persistence requires an object bucket with list support.",
    );

  return {
    async get() {
      throw unavailable();
    },
    async list() {
      throw unavailable();
    },
    async put() {
      throw unavailable();
    },
  };
}

function sourceArtifactsForRequest(
  env: StudioEnv,
  request: Request,
): StudioSourceArtifacts {
  return {
    async load(artifactId) {
      const artifact = await createStudioCodeModeRuntime(env, {
        origin: new URL(request.url).origin,
      }).getArtifact({ artifactId, format: "scene", inline: true });

      if (!artifact.ok) {
        return {
          code: artifact.status,
          message: `Playground artifact "${artifactId}" is not available for Studio persistence.`,
          ok: false,
          status: artifact.status === "storage_failed" ? 500 : 404,
        };
      }

      const scene = RenderedDiagramSceneSchema.safeParse(artifact.inline);
      if (!scene.success) {
        return {
          code: "invalid_scene",
          message: `Playground artifact "${artifactId}" does not include a renderable scene.`,
          ok: false,
          status: 422,
        };
      }

      return {
        artifact: {
          diagramId: artifact.diagramId,
          title: scene.data.title,
        },
        ok: true,
      };
    },
  };
}

export function createStudioProjectsAppServer(
  env: StudioEnv,
  request: Request,
): StudioProjectsServer {
  return createStudioProjectsServer({
    bucket: studioBucketForEnv(env),
    sourceArtifacts: sourceArtifactsForRequest(env, request),
  });
}

export function handleListStudioProjectsRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  return createStudioProjectsAppServer(env, request).handleListProjectsRequest(
    request,
  );
}

export function handleCreateStudioProjectFromArtifactRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  return createStudioProjectsAppServer(
    env,
    request,
  ).handleCreateFromArtifactRequest(request);
}

export function handleGetStudioProjectRequest(
  env: StudioEnv,
  request: Request,
  projectId: string,
): Promise<Response> {
  return createStudioProjectsAppServer(env, request).handleGetProjectRequest(
    request,
    projectId,
  );
}

export function handleGetStudioDiagramRequest(
  env: StudioEnv,
  request: Request,
  diagramId: string,
): Promise<Response> {
  return createStudioProjectsAppServer(env, request).handleGetDiagramRequest(
    request,
    diagramId,
  );
}
