import type { ScenarioPromptMessage } from "@sketchi/diagram-scenarios";

import type { DiagramGenerationUsage } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import type { DiagramGenerationRequest } from "./candidates.js";

export interface GeminiTextPart {
  text: string;
}

export interface GeminiContent {
  parts: GeminiTextPart[];
  role: "model" | "user";
}

export interface GeminiGenerateContentBody {
  contents: GeminiContent[];
  generationConfig: {
    maxOutputTokens: number;
    response_mime_type: "application/json";
    temperature: number;
  };
  system_instruction: {
    parts: GeminiTextPart[];
  };
}

interface GeminiResponsePart {
  text?: unknown;
}

interface GeminiResponseCandidate {
  content?: {
    parts?: GeminiResponsePart[];
  };
}

interface GeminiUsageMetadata {
  candidatesTokenCount?: unknown;
  promptTokenCount?: unknown;
  totalTokenCount?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiResponseCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_TEMPERATURE = 0.1;

function messageContent(
  messages: readonly ScenarioPromptMessage[],
  role: ScenarioPromptMessage["role"],
): string {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join("\n\n");
}

function numberUsage(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function stripCloudflareGoogleModelPrefix(model: string): string {
  return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

export function buildGeminiGenerateContentBody(
  request: DiagramGenerationRequest,
): GeminiGenerateContentBody {
  const prompt = buildDiagramGenerationMessages(request.scenario);
  const system = messageContent(prompt.messages, "system");
  const user = messageContent(prompt.messages, "user");

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      response_mime_type: "application/json",
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    },
    system_instruction: {
      parts: [{ text: system }],
    },
  };
}

export function extractGeminiText(response: unknown): string {
  const parsed = response as GeminiGenerateContentResponse;
  const text = parsed.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter((partText): partText is string => typeof partText === "string")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini response did not include text content.");
  }

  return text;
}

export function extractGeminiUsage(
  response: unknown,
): DiagramGenerationUsage | undefined {
  const usageMetadata = (response as GeminiGenerateContentResponse)
    .usageMetadata;

  if (!usageMetadata) {
    return undefined;
  }

  const inputTokens = numberUsage(usageMetadata.promptTokenCount);
  const outputTokens = numberUsage(usageMetadata.candidatesTokenCount);
  const totalTokens = numberUsage(usageMetadata.totalTokenCount);
  const usage: DiagramGenerationUsage = {};

  if (inputTokens !== undefined) {
    usage.inputTokens = inputTokens;
  }

  if (outputTokens !== undefined) {
    usage.outputTokens = outputTokens;
  }

  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}
