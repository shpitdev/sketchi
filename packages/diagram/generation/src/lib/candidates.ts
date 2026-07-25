import {
  type FlowchartDiagram,
  FlowchartDiagramSchema,
  type MindmapDiagram,
  MindmapDiagramSchema,
  SKETCHI_DIAGRAM_STYLE,
  parseFlowchartDiagram,
  parseMindmapDiagram,
} from "@sketchi/diagram-core";
import { Schema } from "effect";

import { DiagramGenerationPrompt } from "./messages.js";

export const diagramGenerationProviderIds: readonly [
  "fixture",
  "cloudflare-google-ai-studio",
  "google-ai-studio",
] = ["fixture", "cloudflare-google-ai-studio", "google-ai-studio"];

export const DiagramGenerationProviderIdSchema = Schema.Literals(
  diagramGenerationProviderIds,
);
export type DiagramGenerationProviderId =
  typeof DiagramGenerationProviderIdSchema.Type;

export const DiagramGenerationCacheModeSchema = Schema.Literals([
  "default",
  "fresh",
]);
export type DiagramGenerationCacheMode =
  typeof DiagramGenerationCacheModeSchema.Type;

export class DiagramGenerationUsage extends Schema.Class<DiagramGenerationUsage>(
  "DiagramGenerationUsage",
)({
  inputTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
  outputTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
  totalTokens: Schema.optional(Schema.Number).pipe(Schema.mutableKey),
}) {}

export class DiagramGenerationCandidate extends Schema.Class<DiagramGenerationCandidate>(
  "DiagramGenerationCandidate",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  diagnostics: Schema.Array(Schema.String).pipe(Schema.mutable),
  diagram: Schema.optional(
    Schema.Union([FlowchartDiagramSchema, MindmapDiagramSchema]),
  ),
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  model: Schema.String,
  provider: DiagramGenerationProviderIdSchema,
  raw: Schema.optional(Schema.Unknown),
  text: Schema.String,
  usage: Schema.optional(DiagramGenerationUsage),
}) {}

export class DiagramGenerationCandidateSummary extends Schema.Class<DiagramGenerationCandidateSummary>(
  "DiagramGenerationCandidateSummary",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  diagnostics: Schema.Array(Schema.String).pipe(Schema.mutable),
  diagramValid: Schema.Boolean,
  durationMs: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  model: Schema.String,
  provider: DiagramGenerationProviderIdSchema,
  text: Schema.String,
  usage: Schema.optional(DiagramGenerationUsage),
}) {}

export class DiagramGenerationScenarioOutput extends Schema.Class<DiagramGenerationScenarioOutput>(
  "DiagramGenerationScenarioOutput",
)({
  candidates: Schema.Array(DiagramGenerationCandidateSummary).pipe(
    Schema.mutable,
  ),
  model: Schema.String,
  scenarioId: Schema.String,
}) {}

export class DiagramGenerationRequest extends Schema.Class<DiagramGenerationRequest>(
  "DiagramGenerationRequest",
)({
  cacheMode: Schema.optional(DiagramGenerationCacheModeSchema),
  maxOutputTokens: Schema.optional(Schema.Number),
  model: Schema.String,
  prompt: DiagramGenerationPrompt,
  temperature: Schema.optional(Schema.Number),
}) {}

export function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Model output did not contain a JSON object.");
    }

    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }
}

function objectValue(value: unknown, key: string): unknown {
  return isUnknownRecord(value) ? value[key] : undefined;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withSketchiDiagramStyle(input: unknown): unknown {
  return isUnknownRecord(input)
    ? { ...input, style: { ...SKETCHI_DIAGRAM_STYLE } }
    : input;
}

function firstString(values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

export function responseErrorDiagnostic(raw: unknown): string | undefined {
  const error = objectValue(raw, "error");
  const errors = objectValue(raw, "errors");
  const text = objectValue(raw, "text");
  const nestedErrorMessage = objectValue(error, "message");
  const firstErrorMessage = Array.isArray(errors)
    ? objectValue(errors[0], "message")
    : undefined;
  const message = firstString([
    objectValue(raw, "message"),
    nestedErrorMessage,
    firstErrorMessage,
    typeof error === "string" ? error : undefined,
    typeof text === "string" ? text : undefined,
  ]);

  if (!message) {
    return undefined;
  }

  return message.length > 280 ? `${message.slice(0, 277)}...` : message;
}

export function parseGeneratedFlowchart(text: string): FlowchartDiagram {
  return parseFlowchartDiagram(
    withSketchiDiagramStyle(extractJsonObject(text)),
  );
}

export function parseGeneratedDiagram(
  text: string,
): FlowchartDiagram | MindmapDiagram {
  const input = withSketchiDiagramStyle(extractJsonObject(text));
  if (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    input.type === "mindmap"
  ) {
    return parseMindmapDiagram(input);
  }
  return parseFlowchartDiagram(input);
}

export function candidateFromText(
  input: Omit<DiagramGenerationCandidate, "diagnostics" | "text"> & {
    diagnostics?: string[];
    text: string;
  },
): DiagramGenerationCandidate {
  const diagnostics = [...(input.diagnostics ?? [])];

  if (input.error) {
    return {
      ...input,
      diagnostics,
    };
  }

  try {
    return {
      ...input,
      diagnostics,
      diagram: parseGeneratedDiagram(input.text),
    };
  } catch (error) {
    diagnostics.push(
      error instanceof Error
        ? error.message
        : "Generated diagram parse failed.",
    );

    return {
      ...input,
      diagnostics,
      error:
        error instanceof Error
          ? error.message
          : "Generated diagram parse failed.",
    };
  }
}

export function summarizeGenerationCandidate(
  candidate: DiagramGenerationCandidate,
): DiagramGenerationCandidateSummary {
  return {
    diagnostics: candidate.diagnostics,
    diagramValid: Boolean(candidate.diagram) && !candidate.error,
    model: candidate.model,
    provider: candidate.provider,
    text: candidate.text,
    ...(candidate.cacheMode ? { cacheMode: candidate.cacheMode } : {}),
    ...(candidate.durationMs !== undefined
      ? { durationMs: candidate.durationMs }
      : {}),
    ...(candidate.error ? { error: candidate.error } : {}),
    ...(candidate.usage ? { usage: candidate.usage } : {}),
  };
}
