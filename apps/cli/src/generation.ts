import {
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
  type ExcalidrawFile,
  type PatchableScene,
} from "@sketchi/diagram-agent";
import { Effect } from "effect";

import type { BuiltDiagram, StoredDiagram } from "./contracts.js";
import {
  decodeCanonicalDiagramDocument,
  documentId,
  validateStorageId,
} from "./document.js";
import { CliGenerationError } from "./errors.js";
import { DiagramStore } from "./storage.js";

export const DEFAULT_GENERATION_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GENERATE_ENDPOINT =
  "https://playground.sketchi.app/api/v1/generate";
export const SKETCHI_GENERATE_ENDPOINT_ENV = "SKETCHI_GENERATE_ENDPOINT";

export type GenerationType = "flowchart" | "mindmap" | "sequence";

export interface GenerateDiagramInput {
  readonly endpoint: string;
  readonly model: string;
  readonly prompt: string;
  readonly type: GenerationType;
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

interface EndpointErrorBody {
  readonly status?: string;
  readonly issues?: ReadonlyArray<{
    readonly message?: string;
    readonly hint?: string;
  }>;
}

function readErrorBody(text: string): EndpointErrorBody {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as EndpointErrorBody)
      : {};
  } catch {
    return {};
  }
}

function endpointIssueDetails(body: EndpointErrorBody): string[] {
  return (body.issues ?? []).flatMap((entry) => [
    ...(entry.message ? [entry.message] : []),
    ...(entry.hint ? [entry.hint] : []),
  ]);
}

function endpointFailure(status: number, text: string): CliGenerationError {
  const body = readErrorBody(text);
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

interface GenerateApiSuccess {
  readonly document: unknown;
  readonly scene: unknown;
  readonly excalidraw: unknown;
  readonly model: string;
  readonly provider: string;
}

function readSuccessBody(text: string): GenerateApiSuccess | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const body = parsed as {
    ok?: unknown;
    diagram?: {
      document?: unknown;
      scene?: unknown;
      excalidraw?: unknown;
    };
    generation?: { model?: unknown; provider?: unknown };
  };
  if (
    body.ok !== true ||
    !body.diagram ||
    body.diagram.document === undefined ||
    body.diagram.scene === undefined ||
    body.diagram.excalidraw === undefined
  ) {
    return undefined;
  }
  return {
    document: body.diagram.document,
    scene: body.diagram.scene,
    excalidraw: body.diagram.excalidraw,
    model:
      typeof body.generation?.model === "string" ? body.generation.model : "",
    provider:
      typeof body.generation?.provider === "string"
        ? body.generation.provider
        : "cloudflare-google-ai-studio",
  };
}

function decodeScene(
  value: unknown,
): Effect.Effect<PatchableScene, CliGenerationError> {
  const decoded = RenderedDiagramSceneSchema.safeParse(value);
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(malformedResponse());
}

function decodeExcalidraw(
  value: unknown,
): Effect.Effect<ExcalidrawFile, CliGenerationError> {
  const decoded = ExcalidrawFileSchema.safeParse(value);
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(malformedResponse());
}

const requestGeneration = Effect.fn("sketchi.cli.generate.request")(function* (
  input: GenerateDiagramInput,
) {
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
          type: input.type,
          model: input.model,
        }),
        signal,
      }),
    catch: () => networkFailure(),
  });
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => networkFailure(),
  });
  if (!response.ok) {
    return yield* Effect.fail(endpointFailure(response.status, text));
  }
  const success = readSuccessBody(text);
  if (!success) {
    return yield* Effect.fail(malformedResponse());
  }
  return success;
});

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
    model: response.model || input.model,
    provider: response.provider,
  } satisfies GenerateDiagramResult;
});
