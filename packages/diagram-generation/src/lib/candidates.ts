import {
  type FlowchartDiagram,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import type { DiagramScenario } from "@sketchi/diagram-scenarios";
import { z } from "zod";

export const diagramGenerationProviderIds = [
  "fixture",
  "cloudflare-google-ai-studio",
] as const;

export const DiagramGenerationProviderIdSchema = z.enum(
  diagramGenerationProviderIds,
);

export type DiagramGenerationProviderId = z.infer<
  typeof DiagramGenerationProviderIdSchema
>;

export interface DiagramGenerationUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type DiagramGenerationCacheMode = "default" | "fresh";

export interface DiagramGenerationCandidate {
  cacheMode?: DiagramGenerationCacheMode;
  diagnostics: string[];
  diagram?: FlowchartDiagram;
  durationMs?: number;
  error?: string;
  model: string;
  provider: DiagramGenerationProviderId;
  raw?: unknown;
  text: string;
  usage?: DiagramGenerationUsage;
}

export interface DiagramGenerationCandidateSummary {
  cacheMode?: DiagramGenerationCacheMode;
  diagnostics: string[];
  diagramValid: boolean;
  durationMs?: number;
  error?: string;
  model: string;
  provider: DiagramGenerationProviderId;
  text: string;
  usage?: DiagramGenerationUsage;
}

export interface DiagramGenerationRequest {
  cacheMode?: DiagramGenerationCacheMode;
  maxOutputTokens?: number;
  model: string;
  scenario: DiagramScenario;
  temperature?: number;
}

export interface DiagramGenerationClient {
  generate(
    request: DiagramGenerationRequest,
  ): Promise<DiagramGenerationCandidate>;
  provider: DiagramGenerationProviderId;
}

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
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
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
  return parseFlowchartDiagram(extractJsonObject(text));
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
      diagram: parseGeneratedFlowchart(input.text),
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

export async function timeGenerationCandidate(
  generate: () => Promise<DiagramGenerationCandidate>,
): Promise<DiagramGenerationCandidate> {
  const startedAt = performance.now();
  const candidate = await generate();

  return {
    ...candidate,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
