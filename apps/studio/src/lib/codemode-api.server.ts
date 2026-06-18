import "@tanstack/react-start/server-only";

import {
  createCodeModeRuntime,
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
  type ApplyDiagramPatchResult,
  type BuildFlowchartResult,
  type CodeModeArtifactStore,
  type GetArtifactResult,
} from "@sketchi/diagram-agent";

import type { StudioEnv } from "./agent.server";

const localArtifactStore = createMemoryArtifactStore();

function artifactStoreForEnv(env: StudioEnv): CodeModeArtifactStore {
  return env.SKETCHI_ARTIFACTS
    ? createObjectBucketArtifactStore(env.SKETCHI_ARTIFACTS, {
        prefix: "codemode",
      })
    : localArtifactStore;
}

export function createStudioCodeModeRuntime(env: StudioEnv) {
  return createCodeModeRuntime({
    store: artifactStoreForEnv(env),
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildStatus(result: BuildFlowchartResult): number {
  if (result.ok) {
    return 200;
  }
  switch (result.status) {
    case "invalid_input":
      return 400;
    case "invalid_flowchart":
    case "quality_failed":
      return 422;
    case "render_failed":
    case "export_failed":
    case "storage_failed":
      return 500;
  }
}

function getStatus(result: GetArtifactResult): number {
  if (result.ok) {
    return 200;
  }
  switch (result.status) {
    case "invalid_input":
      return 400;
    case "not_found":
    case "format_unavailable":
      return 404;
    case "expired":
      return 410;
    case "storage_failed":
      return 500;
  }
}

function patchStatus(result: ApplyDiagramPatchResult): number {
  if (result.ok) {
    return 200;
  }
  switch (result.status) {
    case "invalid_input":
      return 400;
    case "source_unavailable":
    case "target_not_found":
      return 404;
    case "unsupported_operation":
    case "connectivity_changed":
      return 422;
    case "render_failed":
    case "export_failed":
    case "storage_failed":
      return 500;
  }
}

function formatFromUrl(request: Request): string | undefined {
  return new URL(request.url).searchParams.get("format") ?? undefined;
}

function inlineFromUrl(request: Request): boolean | undefined {
  const value = new URL(request.url).searchParams.get("inline");
  if (value === null) {
    return undefined;
  }
  return value !== "false";
}

export async function handleBuildFlowchartRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const result = await createStudioCodeModeRuntime(env).buildFlowchart(
    await readJson(request),
  );
  return jsonResponse(result, buildStatus(result));
}

export async function handleGetArtifactRequest(
  env: StudioEnv,
  request: Request,
  artifactId: string,
): Promise<Response> {
  const result = await createStudioCodeModeRuntime(env).getArtifact({
    artifactId,
    format: formatFromUrl(request),
    inline: inlineFromUrl(request),
  });

  return jsonResponse(result, getStatus(result));
}

export async function handlePatchArtifactRequest(
  env: StudioEnv,
  request: Request,
  artifactId: string,
): Promise<Response> {
  const body = await readJson(request);
  const input = isRecord(body)
    ? {
        ...body,
        source: body.source ?? { artifactId },
      }
    : {
        source: { artifactId },
        operations: [],
      };
  const result = await createStudioCodeModeRuntime(env).applyDiagramPatch(input);

  return jsonResponse(result, patchStatus(result));
}
