import "@tanstack/react-start/server-only";

import {
  type ApplyDiagramPatchResult,
  type ArtifactFormat,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type GetArtifactResult,
  type StoredArtifactFormat,
} from "@sketchi/diagram-agent";
import {
  createExcalidrawFile,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { Effect, Schema } from "effect";

import { PlaygroundClock } from "../runtime/playground-context.server";
import { PlaygroundCodeMode } from "./codemode-service.server";
import {
  CodeModeHttpSchemas,
  decodeCodeModeHttpInput,
} from "./codemode-http-schema.server";
import {
  codeModeUsageResponseHeaders,
  PlaygroundCodeModeUsage,
} from "./codemode-usage-events.server";

export const MAX_CODE_MODE_BUILD_REQUEST_BYTES = 256 * 1024;

export class CodeModeHttpRequestError extends Schema.TaggedErrorClass<CodeModeHttpRequestError>()(
  "CodeModeHttpRequestError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

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

async function readBoundedBuildJson(
  request: Request,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; body: { omitted: true; reason: "request_too_large" } }
> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CODE_MODE_BUILD_REQUEST_BYTES
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
    if (byteLength > MAX_CODE_MODE_BUILD_REQUEST_BYTES) {
      await reader.cancel("Code Mode build request byte limit exceeded");
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

function requestTooLargeResult(diagramType: "Flowchart" | "Mindmap") {
  return {
    ok: false as const,
    status: "invalid_input" as const,
    issues: [
      {
        code: "request_too_large" as const,
        severity: "error" as const,
        stage: "input" as const,
        ref: { kind: "request" as const, path: "input" },
        message: `${diagramType} request exceeds the ${MAX_CODE_MODE_BUILD_REQUEST_BYTES}-byte limit.`,
        hint: "Send a smaller semantic diagram request.",
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

function requestRead<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      CodeModeHttpRequestError.make({
        cause,
        message: "Code Mode request body could not be read.",
      }),
  });
}

export const handleBuildFlowchartRequest = Effect.fn(
  "playground.http.buildFlowchart",
)(function* (request: Request) {
  const clock = yield* PlaygroundClock;
  const codeMode = yield* PlaygroundCodeMode;
  const usage = yield* PlaygroundCodeModeUsage;
  const usageContext = yield* usage.createContext;
  const startedAt = yield* clock.nowMillis;
  const boundedRequest = yield* requestRead(() =>
    readBoundedBuildJson(request),
  );
  if (!boundedRequest.ok) {
    const result = requestTooLargeResult("Flowchart");
    const finishedAt = yield* clock.nowMillis;
    yield* usage.capture({
      context: usageContext,
      durationMs: finishedAt - startedAt,
      operation: "buildFlowchart",
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
  const codeModeInput = yield* Effect.promise(() =>
    decodeCodeModeHttpInput(
      CodeModeHttpSchemas.buildFlowchart.input,
      requestBody,
    ),
  );
  const result = yield* withTelemetryCorrelation(
    codeMode.buildFlowchart(codeModeInput),
    {
      attemptId: usageContext.attemptId,
      runId: usageContext.runId,
    },
  );
  const status = buildStatus(result);
  const finishedAt = yield* clock.nowMillis;
  yield* usage.capture({
    context: usageContext,
    durationMs: finishedAt - startedAt,
    operation: "buildFlowchart",
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
});

export const handleBuildMindmapRequest = Effect.fn(
  "playground.http.buildMindmap",
)(function* (request: Request) {
  const clock = yield* PlaygroundClock;
  const codeMode = yield* PlaygroundCodeMode;
  const usage = yield* PlaygroundCodeModeUsage;
  const usageContext = yield* usage.createContext;
  const startedAt = yield* clock.nowMillis;
  const boundedRequest = yield* requestRead(() =>
    readBoundedBuildJson(request),
  );
  if (!boundedRequest.ok) {
    const result = requestTooLargeResult("Mindmap");
    const finishedAt = yield* clock.nowMillis;
    yield* usage.capture({
      context: usageContext,
      durationMs: finishedAt - startedAt,
      operation: "buildMindmap",
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
  const codeModeInput = yield* Effect.promise(() =>
    decodeCodeModeHttpInput(
      CodeModeHttpSchemas.buildMindmap.input,
      requestBody,
    ),
  );
  const result = yield* withTelemetryCorrelation(
    codeMode.buildMindmap(codeModeInput),
    {
      attemptId: usageContext.attemptId,
      runId: usageContext.runId,
    },
  );
  const status = mindmapBuildStatus(result);
  const finishedAt = yield* clock.nowMillis;
  yield* usage.capture({
    context: usageContext,
    durationMs: finishedAt - startedAt,
    operation: "buildMindmap",
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
});

export const handleGetArtifactRequest = Effect.fn(
  "playground.http.getArtifact",
)(function* (request: Request, artifactId: string) {
  const codeMode = yield* PlaygroundCodeMode;
  const input = yield* Effect.promise(() =>
    decodeCodeModeHttpInput(CodeModeHttpSchemas.getArtifact.input, {
      artifactId,
      format: formatFromUrl(request),
      inline: rawFromUrl(request) ? false : inlineFromUrl(request),
    }),
  );
  const result = yield* codeMode.getArtifact(input);

  if (!result.ok || !rawFromUrl(request)) {
    return jsonResponse(result, getStatus(result));
  }

  const readResult = yield* codeMode
    .readStoredArtifact(artifactId, result.format)
    .pipe(
      Effect.match({
        onFailure: (error) => ({ error, ok: false as const }),
        onSuccess: (artifact) => ({ artifact, ok: true as const }),
      }),
    );
  if (!readResult.ok) {
    return jsonResponse(
      {
        ok: false,
        status: "storage_failed",
        issues: [
          {
            code: "storage_read_failed",
            severity: "error",
            stage: "storage",
            message: readResult.error.message,
            hint: "Retry retrieval or rebuild the artifact.",
          },
        ],
      },
      500,
    );
  }

  if (!readResult.artifact) {
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
  const artifact = readResult.artifact;

  return yield* Effect.try({
    try: () => rawArtifactResponse({ artifact, artifactId }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        jsonResponse(
          {
            ok: false,
            status: "storage_failed",
            issues: [
              {
                code: "storage_read_failed",
                severity: "error",
                stage: "storage",
                message:
                  error instanceof Error
                    ? error.message
                    : "Artifact read failed.",
                hint: "Retry retrieval or rebuild the artifact.",
              },
            ],
          },
          500,
        ),
      ),
    ),
  );
});

export const handlePatchArtifactRequest = Effect.fn(
  "playground.http.patchArtifact",
)(function* (request: Request, artifactId: string) {
  const clock = yield* PlaygroundClock;
  const codeMode = yield* PlaygroundCodeMode;
  const usage = yield* PlaygroundCodeModeUsage;
  const usageContext = yield* usage.createContext;
  const startedAt = yield* clock.nowMillis;
  const body = yield* requestRead(() => readJson(request));
  const routeInput = isRecord(body)
    ? {
        ...body,
        source: body.source ?? { artifactId },
      }
    : {
        source: { artifactId },
        operations: [],
      };
  const input = yield* Effect.promise(() =>
    decodeCodeModeHttpInput(
      CodeModeHttpSchemas.applyDiagramPatch.input,
      routeInput,
    ),
  );
  const result = yield* withTelemetryCorrelation(
    codeMode.applyDiagramPatch(input),
    {
      artifactId,
      attemptId: usageContext.attemptId,
      runId: usageContext.runId,
    },
  );
  const status = patchStatus(result);
  const finishedAt = yield* clock.nowMillis;

  yield* usage.capture({
    context: usageContext,
    durationMs: finishedAt - startedAt,
    operation: "applyDiagramPatch",
    requestBody: routeInput,
    responseBody: result,
    statusCode: status,
    surface: "api",
  });

  return jsonResponse(
    result,
    status,
    codeModeUsageResponseHeaders(usageContext),
  );
});
