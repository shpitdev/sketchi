import "@tanstack/react-start/server-only";

import {
  type ArtifactFormat,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type BuildSequenceDiagramResult,
  type CreateCanvasResult,
  type StoredArtifactFormat,
} from "@sketchi/diagram-agent";
import {
  createExcalidrawFile,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { Context, Effect, Schema } from "effect";

import { readBoundedJson } from "../runtime/request-body.server";
import {
  PlaygroundBindings,
  PlaygroundClock,
  PlaygroundIds,
  PlaygroundRequestMetadata,
} from "../runtime/context.server";
import { PlaygroundCodeMode } from "./service.server";
import { resultHttpStatus } from "../runtime/http-status.server";
import {
  codeModeUsageResponseHeaders,
  PlaygroundCodeModeUsage,
} from "./usage-events.server";

export const MAX_CODE_MODE_BUILD_REQUEST_BYTES = 256 * 1024;

export class CodeModeHttpRequestError extends Schema.TaggedError<CodeModeHttpRequestError>()(
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

function requestTooLargeResult(
  diagramType:
    "Canvas" | "Flowchart" | "Mindmap" | "Sequence diagram" | "Artifact patch",
) {
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

type BuildResult =
  | BuildFlowchartResult
  | BuildMindmapResult
  | BuildSequenceDiagramResult
  | CreateCanvasResult;

type BuildOperation =
  "buildFlowchart" | "buildMindmap" | "buildSequenceDiagram" | "createCanvas";

function makeBuildHandler({
  operation,
  label,
  run,
}: {
  readonly operation: BuildOperation;
  readonly label: "Flowchart" | "Mindmap" | "Sequence diagram" | "Canvas";
  readonly run: (
    codeMode: Context.Service.Shape<typeof PlaygroundCodeMode>,
    input: unknown,
  ) => Effect.Effect<
    BuildResult,
    never,
    PlaygroundBindings | PlaygroundIds | PlaygroundRequestMetadata
  >;
}) {
  return Effect.fn(`playground.http.${operation}`)(function* (
    request: Request,
  ) {
    const clock = yield* PlaygroundClock;
    const codeMode = yield* PlaygroundCodeMode;
    const usage = yield* PlaygroundCodeModeUsage;
    const usageContext = yield* usage.createContext;
    const startedAt = yield* clock.nowMillis;
    const bounded = yield* readBoundedJson(
      request,
      MAX_CODE_MODE_BUILD_REQUEST_BYTES,
    );
    if (bounded._tag === "InvalidJson") {
      return yield* CodeModeHttpRequestError.make({
        cause: undefined,
        message: "The request body was not valid JSON.",
      });
    }
    const tooLarge = bounded._tag === "TooLarge";
    const requestBody =
      bounded._tag === "Body"
        ? bounded.body
        : { omitted: true, reason: "request_too_large" };
    const result = tooLarge
      ? requestTooLargeResult(label)
      : yield* withTelemetryCorrelation(run(codeMode, requestBody), {
          attemptId: usageContext.attemptId,
          runId: usageContext.runId,
        });
    const status = tooLarge ? 413 : resultHttpStatus(result);
    const finishedAt = yield* clock.nowMillis;
    yield* usage.capture({
      context: usageContext,
      durationMs: finishedAt - startedAt,
      operation,
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
}

export const handleBuildFlowchartRequest = makeBuildHandler({
  operation: "buildFlowchart",
  label: "Flowchart",
  run: (codeMode, input) => codeMode.buildFlowchart(input),
});
export const handleBuildMindmapRequest = makeBuildHandler({
  operation: "buildMindmap",
  label: "Mindmap",
  run: (codeMode, input) => codeMode.buildMindmap(input),
});
export const handleBuildSequenceDiagramRequest = makeBuildHandler({
  operation: "buildSequenceDiagram",
  label: "Sequence diagram",
  run: (codeMode, input) => codeMode.buildSequenceDiagram(input),
});
export const handleCreateCanvasRequest = makeBuildHandler({
  operation: "createCanvas",
  label: "Canvas",
  run: (codeMode, input) => codeMode.createCanvas(input),
});

export const handleGetArtifactRequest = Effect.fn(
  "playground.http.getArtifact",
)(function* (request: Request, artifactId: string) {
  const codeMode = yield* PlaygroundCodeMode;
  const format = formatFromUrl(request);
  const raw = rawFromUrl(request);
  const inline = raw ? false : inlineFromUrl(request);
  const input = {
    artifactId,
    ...(format === undefined ? {} : { format }),
    ...(inline === undefined ? {} : { inline }),
  };
  const result = yield* codeMode.getArtifact(input);

  if (!result.ok || !raw) {
    return jsonResponse(result, resultHttpStatus(result));
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
  const bounded = yield* readBoundedJson(
    request,
    MAX_CODE_MODE_BUILD_REQUEST_BYTES,
  );
  if (bounded._tag === "InvalidJson") {
    return yield* CodeModeHttpRequestError.make({
      cause: undefined,
      message: "The request body was not valid JSON.",
    });
  }
  if (bounded._tag === "TooLarge") {
    const result = requestTooLargeResult("Artifact patch");
    const finishedAt = yield* clock.nowMillis;
    yield* usage.capture({
      context: usageContext,
      durationMs: finishedAt - startedAt,
      operation: "applyDiagramPatch",
      requestBody: { omitted: true, reason: "request_too_large" },
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
  const body = bounded.body;
  const routeInput = isRecord(body)
    ? {
        ...body,
        source: body.source ?? { artifactId },
      }
    : {
        source: { artifactId },
        operations: [],
      };
  const result = yield* withTelemetryCorrelation(
    codeMode.applyDiagramPatch(routeInput),
    {
      artifactId,
      attemptId: usageContext.attemptId,
      runId: usageContext.runId,
    },
  );
  const status = resultHttpStatus(result);
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
