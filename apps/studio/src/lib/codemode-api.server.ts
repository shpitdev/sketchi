import "@tanstack/react-start/server-only";

import {
  createCodeModeRuntime,
  createMemoryArtifactStore,
  createObjectBucketArtifactStore,
  type ApplyDiagramPatchResult,
  type ArtifactFormat,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type CodeModeArtifactStore,
  type GetArtifactResult,
  type StoredArtifactFormat,
} from "@sketchi/diagram-agent";
import {
  createExcalidrawFile,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";

import type { StudioEnv } from "./agent.server";
import { createCloudflareBrowserRunArtifactRenderer } from "./codemode-browser-renderer.server";
import {
  captureCodeModeUsageEvent,
  codeModeUsageResponseHeaders,
  createCodeModeUsageContext,
} from "./codemode-usage-events.server";

const localArtifactStore = createMemoryArtifactStore();
const DEFAULT_RENDER_ASSET_ORIGIN =
  "https://sketchi-studio.dimethyl.workers.dev";
export const MAX_MINDMAP_REQUEST_BYTES = 256 * 1024;

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

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");

  return Response.json(body, {
    status,
    headers,
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function readBoundedMindmapJson(
  request: Request,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; body: { omitted: true; reason: "request_too_large" } }
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_MINDMAP_REQUEST_BYTES
  ) {
    return {
      ok: false,
      body: { omitted: true, reason: "request_too_large" },
    };
  }

  if (!request.body) return { ok: true, body: {} };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_MINDMAP_REQUEST_BYTES) {
      await reader.cancel("mindmap request byte limit exceeded");
      return {
        ok: false,
        body: { omitted: true, reason: "request_too_large" },
      };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: true, body: {} };
  }
}

function mindmapTooLargeResult() {
  return {
    ok: false as const,
    status: "invalid_input" as const,
    issues: [
      {
        code: "request_too_large" as const,
        severity: "error" as const,
        stage: "input" as const,
        ref: { kind: "request" as const, path: "input" },
        message: `Mindmap request exceeds the ${MAX_MINDMAP_REQUEST_BYTES}-byte limit.`,
        hint: "Send a smaller semantic topic hierarchy.",
      },
    ],
  };
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

function mindmapBuildStatus(result: BuildMindmapResult): number {
  if (result.ok) return 200;
  switch (result.status) {
    case "invalid_input":
      return 400;
    case "invalid_mindmap":
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

function isExcalidrawElement(
  value: unknown,
): value is ExcalidrawScene["elements"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string"
  );
}

function isExcalidrawSceneData(value: unknown): value is ExcalidrawScene {
  return (
    isRecord(value) &&
    isRecord(value.appState) &&
    Array.isArray(value.elements) &&
    value.elements.every(isExcalidrawElement)
  );
}

function isExcalidrawFileData(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "excalidraw" &&
    value.version === 2 &&
    typeof value.source === "string" &&
    isRecord(value.files)
  );
}

function dataForRawArtifact(artifact: StoredArtifactFormat): unknown {
  if (
    artifact.format === "excalidraw" &&
    !isExcalidrawFileData(artifact.data) &&
    isExcalidrawSceneData(artifact.data)
  ) {
    return createExcalidrawFile(artifact.data);
  }

  return artifact.data;
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

  return JSON.stringify(dataForRawArtifact(artifact));
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
  const usageContext = createCodeModeUsageContext(request);
  const startedAt = Date.now();
  const requestBody = await readJson(request);
  const result = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).buildFlowchart(requestBody);
  const status = buildStatus(result);

  captureCodeModeUsageEvent({
    context: usageContext,
    durationMs: Date.now() - startedAt,
    env,
    operation: "buildFlowchart",
    request,
    requestBody,
    responseBody: result,
    statusCode: status,
    surface: "api",
  });

  return jsonResponse(
    result,
    status,
    codeModeUsageResponseHeaders(usageContext),
  );
}

export async function handleBuildMindmapRequest(
  env: StudioEnv,
  request: Request,
): Promise<Response> {
  const usageContext = createCodeModeUsageContext(request);
  const startedAt = Date.now();
  const boundedRequest = await readBoundedMindmapJson(request);
  if (!boundedRequest.ok) {
    const result = mindmapTooLargeResult();
    captureCodeModeUsageEvent({
      context: usageContext,
      durationMs: Date.now() - startedAt,
      env,
      operation: "buildMindmap",
      request,
      requestBody: boundedRequest.body,
      responseBody: result,
      statusCode: 413,
      surface: "api",
    });
    return jsonResponse(
      result,
      413,
      codeModeUsageResponseHeaders(usageContext),
    );
  }
  const requestBody = boundedRequest.body;
  const result = await createStudioCodeModeRuntime(env, {
    origin: new URL(request.url).origin,
  }).buildMindmap(requestBody);
  const status = mindmapBuildStatus(result);
  captureCodeModeUsageEvent({
    context: usageContext,
    durationMs: Date.now() - startedAt,
    env,
    operation: "buildMindmap",
    request,
    requestBody,
    responseBody: result,
    statusCode: status,
    surface: "api",
  });
  return jsonResponse(
    result,
    status,
    codeModeUsageResponseHeaders(usageContext),
  );
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
  const usageContext = createCodeModeUsageContext(request);
  const startedAt = Date.now();
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
  const status = patchStatus(result);

  captureCodeModeUsageEvent({
    context: usageContext,
    durationMs: Date.now() - startedAt,
    env,
    operation: "applyDiagramPatch",
    request,
    requestBody: input,
    responseBody: result,
    statusCode: status,
    surface: "api",
  });

  return jsonResponse(
    result,
    status,
    codeModeUsageResponseHeaders(usageContext),
  );
}
