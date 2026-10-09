import {
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
  type ExcalidrawFile,
  type PatchableScene,
} from "@sketchi/diagram-agent";
import { Effect, Schema, Result } from "effect";

import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import {
  decodeCanonicalDiagramDocument,
  documentId,
  validateStorageId,
} from "./document.js";
import { CliGenerationError } from "./errors.js";
import { DiagramStore } from "./storage.js";
import {
  API_REQUEST_TIMEOUT,
  MAX_API_RESPONSE_BYTES,
  readBoundedText,
} from "./response-body.js";

export const DEFAULT_GENERATION_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GENERATE_ENDPOINT =
  "https://playground.sketchi.app/api/v1/generate";
export const SKETCHI_GENERATE_ENDPOINT_ENV = "SKETCHI_GENERATE_ENDPOINT";

export type GenerationType = "flowchart" | "mindmap" | "sequence";
export type RequestedGenerationType =
  | GenerationType
  | "architecture"
  | "er"
  | "state-machine"
  | "swimlane";

export interface GenerateDiagramInput {
  readonly endpoint: string;
  readonly model: string;
  readonly prompt: string;
  readonly type?: RequestedGenerationType;
}

export interface GenerateDiagramResult {
  readonly diagram: StoredDiagram;
  readonly model: string;
  readonly provider: string;
}

/**
 * Resolve the default generate endpoint: the production Sketchi generate API,
 * overridable only for preview or local testing through the environment.
 */
export function resolveGenerateEndpoint(): string {
  return (
    process.env[SKETCHI_GENERATE_ENDPOINT_ENV]?.trim() ||
    DEFAULT_GENERATE_ENDPOINT
  );
}

function networkFailure(): CliGenerationError {
  return CliGenerationError.make({
    code: "provider_failure",
    message: "The Sketchi generate API could not be reached.",
    hint: "Check your network connection and retry. create/show/edit/list/export/restore remain offline; share and pull are separate explicit network commands.",
    details: ["transport"],
  });
}

function malformedResponse(): CliGenerationError {
  return CliGenerationError.make({
    code: "malformed_output",
    message: "The Sketchi generate API returned an unreadable response.",
    hint: "Retry once; if it persists, report the prompt without secrets.",
    details: [],
  });
}

function invalidGeneratedDocument(): CliGenerationError {
  return CliGenerationError.make({
    code: "invalid_generated_document",
    message:
      "The generated diagram failed Sketchi schema or semantic validation.",
    hint: "Refine the prompt with concrete diagram content, then retry.",
    details: [],
  });
}

const EndpointErrorBody = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        message: Schema.optionalKey(Schema.String),
        hint: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

const decodeErrorBody = Schema.decodeUnknownEffect(
  Schema.fromJsonString(EndpointErrorBody),
);

function endpointIssueDetails(body: typeof EndpointErrorBody.Type): string[] {
  return (body.issues ?? []).flatMap((entry) => [
    ...(entry.message ? [entry.message] : []),
    ...(entry.hint ? [entry.hint] : []),
  ]);
}

function endpointFailure(
  status: number,
  body: typeof EndpointErrorBody.Type,
): CliGenerationError {
  const firstIssue = body.issues?.[0];
  const details = [
    `http_status:${String(status)}`,
    ...endpointIssueDetails(body),
  ];

  switch (body.status) {
    case "generation_timeout":
      return CliGenerationError.make({
        code: "generation_timeout",
        message: firstIssue?.message ?? "The generate API timed out.",
        hint:
          firstIssue?.hint ??
          "Retry once; if it persists, try a shorter prompt.",
        details,
      });
    case "malformed_output":
      return CliGenerationError.make({
        code: "malformed_output",
        message:
          firstIssue?.message ??
          "The generate API returned unreadable model output.",
        hint:
          firstIssue?.hint ?? "Retry once; if it persists, try another prompt.",
        details,
      });
    case "invalid_input":
    case "invalid_generated_document":
    case "quality_failed":
      return CliGenerationError.make({
        code: "invalid_generated_document",
        message:
          firstIssue?.message ??
          "The generated diagram failed Sketchi validation.",
        hint:
          firstIssue?.hint ??
          "Refine the prompt with concrete content, then retry.",
        details,
      });
    case "unsupported_diagram_type":
      return CliGenerationError.make({
        code: "unsupported_diagram_type",
        message:
          firstIssue?.message ??
          "Sketchi does not natively support the requested diagram type.",
        hint:
          firstIssue?.hint ??
          "Request a flowchart, mindmap, or sequence diagram instead.",
        details,
      });
    default:
      return CliGenerationError.make({
        code: "provider_failure",
        message:
          firstIssue?.message ??
          `The Sketchi generate API responded with HTTP ${String(status)}.`,
        hint:
          firstIssue?.hint ??
          "Retry once; if it persists, report the prompt without secrets.",
        details,
      });
  }
}

const PresentValue = Schema.Unknown.check(
  Schema.makeFilter((value) => value !== undefined),
);

const GenerateApiSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  diagram: Schema.Struct({
    document: PresentValue,
    scene: PresentValue,
    excalidraw: PresentValue,
  }),
  generation: Schema.Struct({
    model: Schema.NonEmptyString,
    provider: Schema.NonEmptyString,
  }),
});

const decodeSuccessBody = Schema.decodeUnknownEffect(
  Schema.fromJsonString(GenerateApiSuccess),
);

function timeoutFailure(): CliGenerationError {
  return CliGenerationError.make({
    code: "generation_timeout",
    message: "The Sketchi generate API request timed out.",
    hint: "Retry once; if it persists, try a shorter prompt.",
    details: [],
  });
}

function decodeScene(
  value: unknown,
): Effect.Effect<PatchableScene, CliGenerationError> {
  const decoded = Schema.decodeUnknownResult(RenderedDiagramSceneSchema, {
    errors: "all",
    reportInput: true,
  })(value);
  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success)
    : Effect.fail(malformedResponse());
}

function decodeExcalidraw(
  value: unknown,
): Effect.Effect<ExcalidrawFile, CliGenerationError> {
  const decoded = Schema.decodeUnknownResult(ExcalidrawFileSchema, {
    errors: "all",
    reportInput: true,
  })(value);
  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success)
    : Effect.fail(malformedResponse());
}

const requestGeneration = Effect.fn("sketchi.cli.generate.request")(
  function* (input: GenerateDiagramInput) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        globalThis.fetch(input.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-sketchi-client": "sketchi-cli",
          },
          body: JSON.stringify({
            prompt: input.prompt,
            ...(input.type ? { type: input.type } : {}),
            model: input.model,
          }),
          signal,
        }),
      catch: () => networkFailure(),
    });
    const text = yield* readBoundedText(
      response,
      MAX_API_RESPONSE_BYTES,
      malformedResponse,
      networkFailure,
    );
    if (!response.ok) {
      const body = yield* decodeErrorBody(text).pipe(
        Effect.mapError(malformedResponse),
      );
      return yield* endpointFailure(response.status, body);
    }
    const success = yield* decodeSuccessBody(text).pipe(
      Effect.mapError(malformedResponse),
    );
    return { ...success.diagram, ...success.generation };
  },
  Effect.timeoutOrElse({
    duration: API_REQUEST_TIMEOUT,
    orElse: () => Effect.fail(timeoutFailure()),
  }),
);

export const generateDiagram = Effect.fn("sketchi.cli.generate")(function* (
  input: GenerateDiagramInput,
) {
  const store = yield* DiagramStore;
  const response = yield* requestGeneration(input);

  const document = yield* decodeCanonicalDiagramDocument(
    response.document,
  ).pipe(Effect.mapError(() => invalidGeneratedDocument()));
  const id = yield* validateStorageId(documentId(document)).pipe(
    Effect.mapError(() => invalidGeneratedDocument()),
  );
  const scene = yield* decodeScene(response.scene);
  const excalidraw = yield* decodeExcalidraw(response.excalidraw);

  const built: BuiltDiagram = {
    id,
    type: document.type,
    title: document.spec.title,
    document,
    scene,
    excalidraw,
  };
  const diagram = yield* store.create(built);

  return {
    diagram,
    model: response.model,
    provider: response.provider,
  } satisfies GenerateDiagramResult;
});
