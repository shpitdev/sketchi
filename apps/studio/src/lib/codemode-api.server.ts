import "@tanstack/react-start/server-only";

import {
  createCodeModeRuntime,
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
  type ApplyDiagramPatchResult,
  type ArtifactFormat,
  type BuildFlowchartResult,
  type CodeModeArtifactStore,
  type GetArtifactResult,
  type StoredArtifactFormat,
} from "@sketchi/diagram-agent";

import type { StudioEnv } from "./agent.server";
import { createCloudflareBrowserRunArtifactRenderer } from "./codemode-browser-renderer.server";

const localArtifactStore = createMemoryArtifactStore();
const DEFAULT_RENDER_ASSET_ORIGIN =
  "https://sketchi-studio.dimethyl.workers.dev";

export interface StudioCodeModeRuntimeOptions {
  origin?: string;
}

function artifactStoreForEnv(env: StudioEnv): CodeModeArtifactStore {
  return env.SKETCHI_ARTIFACTS
    ? createObjectBucketArtifactStore(env.SKETCHI_ARTIFACTS, {
        prefix: "codemode",
      })
    : localArtifactStore;
}

export function createStudioCodeModeRuntime(
  env: StudioEnv,
  options: StudioCodeModeRuntimeOptions = {},
) {
  const renderer = rendererForEnv(env, options);
  const origin = options.origin;
  return createCodeModeRuntime({
    ...(origin ? { artifactUrl: (input) => artifactUrl(origin, input) } : {}),
    ...(renderer ? { renderer } : {}),
    store: artifactStoreForEnv(env),
  });
}

function artifactUrl(
  origin: string,
  input: { artifactId: string; format: ArtifactFormat },
): string {
  const url = new URL(
    `/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`,
    origin,
  );
  url.searchParams.set("format", input.format);
  url.searchParams.set("raw", "true");
  return url.toString();
}

function rendererForEnv(env: StudioEnv, options: StudioCodeModeRuntimeOptions) {
  if (!env.BROWSER) {
    return undefined;
  }

  return createCloudflareBrowserRunArtifactRenderer(env.BROWSER, {
    assetOrigin: renderAssetOrigin(env, options),
  });
}

function renderAssetOrigin(
  env: StudioEnv,
  options: StudioCodeModeRuntimeOptions,
): string {
  if (env.SKETCHI_RENDER_ASSET_ORIGIN) {
    return env.SKETCHI_RENDER_ASSET_ORIGIN;
  }

  if (options.origin && !isLocalOrigin(options.origin)) {
    return options.origin;
  }

  return DEFAULT_RENDER_ASSET_ORIGIN;
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
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

function rawFromUrl(request: Request): boolean {
  const value = new URL(request.url).searchParams.get("raw");
  return value === "true" || value === "1";
}

function inlineFromUrl(request: Request): boolean | undefined {
  const value = new URL(request.url).searchParams.get("inline");
  if (value === null) {
    return undefined;
  }
  return value !== "false";
}

function extensionForFormat(
  format: ArtifactFormat,
): "excalidraw" | "json" | "png" {
  if (format === "png") {
    return "png";
  }
  return format === "excalidraw" ? "excalidraw" : "json";
}

function bodyForRawArtifact(artifact: StoredArtifactFormat): BodyInit {
  if (artifact.format === "png") {
    if (artifact.data instanceof ArrayBuffer) {
      return artifact.data;
    }
    if (artifact.data instanceof Uint8Array) {
      return toArrayBuffer(artifact.data);
    }
    throw new Error("PNG artifact data is not binary.");
  }

  return JSON.stringify(artifact.data);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function rawArtifactResponse(input: {
  artifact: StoredArtifactFormat;
  artifactId: string;
}): Response {
  const extension = extensionForFormat(input.artifact.format);
  return new Response(bodyForRawArtifact(input.artifact), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${input.artifactId}.${extension}"`,
      "Content-Type": input.artifact.mimeType,
    },
  });
}

export async function handleBuildFlowchartRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const result = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).buildFlowchart(await readJson(request));
  return jsonResponse(result, buildStatus(result));
}

export async function handleGetArtifactRequest(
  env: StudioEnv,
  request: Request,
  artifactId: string,
): Promise<Response> {
  const runtime = createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  });
  const result = await runtime.getArtifact({
    artifactId,
    format: formatFromUrl(request),
    inline: rawFromUrl(request) ? false : inlineFromUrl(request),
  });

  if (!result.ok || !rawFromUrl(request)) {
    return jsonResponse(result, getStatus(result));
  }

  let artifact: StoredArtifactFormat | null;
  try {
    artifact = await artifactStoreForEnv(env).read(artifactId, result.format);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        status: "storage_failed",
        issues: [
          {
            code: "storage_read_failed",
            severity: "error",
            stage: "storage",
            message:
              error instanceof Error ? error.message : "Artifact read failed.",
            hint: "Retry retrieval or rebuild the artifact.",
          },
        ],
      },
      500,
    );
  }

  if (!artifact) {
    return jsonResponse(
      {
        ok: false,
        status: "format_unavailable",
        issues: [
          {
            code: "patch_source_unavailable",
            severity: "error",
            stage: "storage",
            ref: { kind: "artifact", id: artifactId },
            message: `Artifact "${artifactId}" format "${result.format}" could not be read.`,
            hint: "Retry retrieval or rebuild the artifact.",
          },
        ],
      },
      404,
    );
  }

  try {
    return rawArtifactResponse({ artifact, artifactId });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        status: "storage_failed",
        issues: [
          {
            code: "storage_read_failed",
            severity: "error",
            stage: "storage",
            message:
              error instanceof Error ? error.message : "Artifact read failed.",
            hint: "Retry retrieval or rebuild the artifact.",
          },
        ],
      },
      500,
    );
  }
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
  const result = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).applyDiagramPatch(input);

  return jsonResponse(result, patchStatus(result));
}
