import "@tanstack/react-start/server-only";

import type {
  BuildFlowchartResult,
  BuildMindmapResult,
} from "@sketchi/diagram-agent";
import {
  extractJsonObject,
  type DiagramGenerationCandidate,
  type DiagramGenerationError,
  type DiagramGenerationType,
} from "@sketchi/diagram-generation";
import { withTelemetryCorrelation } from "@sketchi/observability";
import { Effect, Result, Schema } from "effect";

import { PlaygroundCodeMode } from "../codemode/service.server";
import {
  codeModeUsageResponseHeaders,
  PlaygroundCodeModeUsage,
} from "../codemode/usage-events.server";
import { PlaygroundBindings, PlaygroundClock } from "../runtime/context.server";
import {
  flowchartDocumentInput,
  mindmapDocumentInput,
  PlaygroundGeneration,
} from "./service.server";

export const MAX_GENERATE_REQUEST_BYTES = 32 * 1024;
export const MAX_GENERATE_PROMPT_LENGTH = 8_000;

type BuildResult = BuildFlowchartResult | BuildMindmapResult;
type BuiltArtifact = Extract<BuildResult, { readonly ok: true }>["artifact"];

type GenerateFailureStatus =
  | "invalid_input"
  | "provider_failed"
  | "generation_timeout"
  | "malformed_output"
  | "invalid_generated_document"
  | "quality_failed"
  | "render_failed"
  | "export_failed"
  | "storage_failed";

interface GenerateIssue {
  readonly code: string;
  readonly severity: "error";
  readonly stage: "input" | "generation" | "build";
  readonly message: string;
  readonly hint: string;
}

interface GenerateFailure {
  readonly ok: false;
  readonly status: GenerateFailureStatus;
  readonly issues: ReadonlyArray<GenerateIssue>;
}

interface GenerateSuccess {
  readonly ok: true;
  readonly status: "generated";
  readonly diagram: {
    readonly document: {
      readonly type: DiagramGenerationType;
      readonly spec: unknown;
    };
    readonly scene: unknown;
    readonly excalidraw: unknown;
  };
  readonly generation: { readonly model: string; readonly provider: string };
}

type GenerateResult = GenerateSuccess | GenerateFailure;

const GenerateRequestSchema = Schema.Struct({
  prompt: Schema.String,
  type: Schema.optional(Schema.Literals(["flowchart", "mindmap"])),
  model: Schema.optional(Schema.String),
});
const decodeGenerateRequest = Schema.decodeUnknownResult(
  GenerateRequestSchema,
  {
    errors: "all",
  },
);

function issue(
  code: string,
  stage: GenerateIssue["stage"],
  message: string,
  hint: string,
): GenerateIssue {
  return { code, severity: "error", stage, message, hint };
}

function failure(
  status: GenerateFailureStatus,
  issues: ReadonlyArray<GenerateIssue>,
): GenerateFailure {
  return { ok: false, status, issues };
}

function generateHttpStatus(result: GenerateResult): number {
  if (result.ok) return 200;
  switch (result.status) {
    case "invalid_input":
      return 400;
    case "malformed_output":
    case "invalid_generated_document":
    case "quality_failed":
      return 422;
    case "provider_failed":
      return 502;
    case "generation_timeout":
      return 504;
    case "render_failed":
    case "export_failed":
    case "storage_failed":
      return 500;
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

async function readBoundedGenerateJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_GENERATE_REQUEST_BYTES
  ) {
    return { __tooLarge: true };
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_GENERATE_REQUEST_BYTES) {
      await reader.cancel("Generate request byte limit exceeded");
      return { __tooLarge: true };
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { __invalidJson: true };
  }
}

function generationErrorFailure(
  error: DiagramGenerationError,
): GenerateFailure {
  switch (error._tag) {
    case "DiagramGenerationConfigurationError":
    case "DiagramGenerationHttpError":
    case "DiagramGenerationTransportError":
      return failure("provider_failed", [
        issue(
          "provider_failed",
          "generation",
          "The generation provider could not complete the request.",
          "Retry once; if it persists, try a shorter or clearer prompt.",
        ),
      ]);
    case "DiagramGenerationTimeoutError":
      return failure("generation_timeout", [
        issue(
          "generation_timeout",
          "generation",
          "The generation provider did not respond in time.",
          "Retry once; if it persists, try a shorter prompt.",
        ),
      ]);
    case "DiagramGenerationResponseError":
      return failure("malformed_output", [
        issue(
          "malformed_output",
          "generation",
          "The generation provider returned an unreadable response.",
          "Retry once; if it persists, try another prompt.",
        ),
      ]);
    case "DiagramGenerationInputError":
      return failure("invalid_input", [
        issue(
          "invalid_input",
          "input",
          "The generation request could not be prepared.",
          "Send a concrete prompt describing one diagram.",
        ),
      ]);
  }
}

function malformedCandidateFailure(
  candidate: DiagramGenerationCandidate,
): GenerateFailure | undefined {
  if (candidate.diagram) return undefined;
  const canParse = (() => {
    try {
      extractJsonObject(candidate.text);
      return true;
    } catch {
      return false;
    }
  })();
  const diagnostics = candidate.diagnostics.slice(0, 8);
  return failure(
    "malformed_output",
    diagnostics.length > 0
      ? diagnostics.map((diagnostic) =>
          issue(
            "malformed_output",
            "generation",
            diagnostic,
            "Return one complete diagram JSON object that resolves this diagnostic.",
          ),
        )
      : [
          issue(
            "malformed_output",
            "generation",
            canParse
              ? "The generation provider output did not describe a valid diagram."
              : "The generation provider output did not contain one JSON object.",
            "Retry once; if it persists, try another prompt.",
          ),
        ],
  );
}

function buildFailure(
  result: Extract<BuildResult, { ok: false }>,
): GenerateFailure {
  const issues = result.issues.map((entry) =>
    issue(
      entry.code,
      "build",
      entry.message,
      entry.hint ?? "Refine the prompt and retry.",
    ),
  );
  switch (result.status) {
    case "invalid_input":
    case "invalid_flowchart":
    case "invalid_mindmap":
      return failure("invalid_generated_document", issues);
    case "quality_failed":
      return failure("quality_failed", issues);
    case "render_failed":
      return failure("render_failed", issues);
    case "export_failed":
      return failure("export_failed", issues);
    case "storage_failed":
      return failure("storage_failed", issues);
  }
}

function inlineArtifact(
  artifact: BuiltArtifact,
  format: "scene" | "excalidraw",
): unknown | undefined {
  const ref = artifact.formats.find((candidate) => candidate.format === format);
  return ref?.inline;
}

export const handleGenerateDiagramRequest = Effect.fn(
  "playground.http.generate",
)(function* (request: Request) {
  const clock = yield* PlaygroundClock;
  const codeMode = yield* PlaygroundCodeMode;
  const generation = yield* PlaygroundGeneration;
  const usage = yield* PlaygroundCodeModeUsage;
  const env = yield* PlaygroundBindings;
  const usageContext = yield* usage.createContext;
  const startedAt = yield* clock.nowMillis;

  const finish = (requestBody: unknown, result: GenerateResult) =>
    Effect.gen(function* () {
      const status = generateHttpStatus(result);
      const finishedAt = yield* clock.nowMillis;
      yield* usage.capture({
        context: usageContext,
        durationMs: finishedAt - startedAt,
        operation: "generateDiagram",
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

  const rawBody = yield* Effect.promise(() => readBoundedGenerateJson(request));
  if (
    rawBody !== null &&
    typeof rawBody === "object" &&
    "__tooLarge" in rawBody
  ) {
    return yield* finish(
      { omitted: true },
      failure("invalid_input", [
        issue(
          "request_too_large",
          "input",
          `The generate request exceeds the ${MAX_GENERATE_REQUEST_BYTES}-byte limit.`,
          "Send a shorter prompt.",
        ),
      ]),
    );
  }
  if (
    rawBody !== null &&
    typeof rawBody === "object" &&
    "__invalidJson" in rawBody
  ) {
    return yield* finish(
      {},
      failure("invalid_input", [
        issue(
          "invalid_json",
          "input",
          "The generate request body was not valid JSON.",
          "Send a JSON object with a prompt field.",
        ),
      ]),
    );
  }

  const decoded = decodeGenerateRequest(rawBody);
  if (Result.isFailure(decoded)) {
    return yield* finish(
      rawBody,
      failure("invalid_input", [
        issue(
          "invalid_input",
          "input",
          "The generate request must include a string prompt and an optional type of flowchart or mindmap.",
          'Send { "prompt": "...", "type": "flowchart" }.',
        ),
      ]),
    );
  }
  const input = decoded.success;
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > MAX_GENERATE_PROMPT_LENGTH) {
    return yield* finish(
      rawBody,
      failure("invalid_input", [
        issue(
          "invalid_input",
          "input",
          prompt
            ? `The prompt exceeds the ${MAX_GENERATE_PROMPT_LENGTH}-character limit.`
            : "The prompt must not be empty.",
          "Send a concrete prompt describing one diagram.",
        ),
      ]),
    );
  }
  const type: DiagramGenerationType = input.type ?? "flowchart";

  const candidateResult = yield* withTelemetryCorrelation(
    generation.generate({
      prompt,
      type,
      ...(input.model ? { model: input.model } : {}),
    }),
    { attemptId: usageContext.attemptId, runId: usageContext.runId },
  ).pipe(
    Effect.match({
      onFailure: (error) => ({ ok: false as const, error }),
      onSuccess: (candidate) => ({ ok: true as const, candidate }),
    }),
  );
  if (!candidateResult.ok) {
    return yield* finish(
      { prompt, type, ...(input.model ? { model: input.model } : {}) },
      generationErrorFailure(candidateResult.error),
    );
  }
  const candidate = candidateResult.candidate;
  const malformed = malformedCandidateFailure(candidate);
  if (malformed || !candidate.diagram) {
    return yield* finish(
      { prompt, type, ...(input.model ? { model: input.model } : {}) },
      malformed ??
        failure("malformed_output", [
          issue(
            "malformed_output",
            "generation",
            "The generation provider output did not describe a valid diagram.",
            "Retry once; if it persists, try another prompt.",
          ),
        ]),
    );
  }
  if (candidate.diagram.type !== type) {
    return yield* finish(
      { prompt, type, ...(input.model ? { model: input.model } : {}) },
      failure("invalid_generated_document", [
        issue(
          "invalid_generated_document",
          "generation",
          `The generation provider returned a ${candidate.diagram.type} for a ${type} request.`,
          "Retry once; if it persists, rephrase the prompt.",
        ),
      ]),
    );
  }

  const documentInput =
    candidate.diagram.type === "flowchart"
      ? flowchartDocumentInput(candidate.diagram)
      : mindmapDocumentInput(candidate.diagram);
  const spec = (documentInput as { readonly spec?: unknown } | undefined)?.spec;
  const buildOptions = {
    artifactFormats: ["scene", "excalidraw"],
    inlineArtifacts: ["scene", "excalidraw"],
  };
  const buildResult: BuildResult = yield* type === "flowchart"
    ? codeMode.buildFlowchart({ spec, options: buildOptions })
    : codeMode.buildMindmap({ spec, options: buildOptions });
  if (!buildResult.ok) {
    return yield* finish({ prompt, type, spec }, buildFailure(buildResult));
  }

  const scene = inlineArtifact(buildResult.artifact, "scene");
  const excalidraw = inlineArtifact(buildResult.artifact, "excalidraw");
  if (scene === undefined || excalidraw === undefined) {
    return yield* finish(
      { prompt, type, spec },
      failure("export_failed", [
        issue(
          "missing_inline_artifact",
          "build",
          "The generated diagram was built without the inline scene or Excalidraw artifact.",
          "Retry once; if it persists, report the prompt.",
        ),
      ]),
    );
  }

  const success: GenerateSuccess = {
    ok: true,
    status: "generated",
    diagram: {
      document: { type, spec },
      scene,
      excalidraw,
    },
    generation: {
      model: candidate.model || generation.defaultModel(env),
      provider: candidate.provider,
    },
  };
  return yield* finish({ prompt, type, spec }, success);
});
