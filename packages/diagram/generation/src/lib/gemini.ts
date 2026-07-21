import { Schema } from "effect";

import type { DiagramGenerationUsage } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import type { DiagramGenerationMessage } from "./messages.js";
import type { DiagramGenerationRequest } from "./candidates.js";

export class GeminiTextPart extends Schema.Class<GeminiTextPart>(
  "GeminiTextPart",
)({ text: Schema.String }) {}

export class GeminiContent extends Schema.Class<GeminiContent>("GeminiContent")(
  {
    parts: Schema.Array(GeminiTextPart).pipe(Schema.mutable),
    role: Schema.Literals(["model", "user"]),
  },
) {}

export class GeminiGenerationConfig extends Schema.Class<GeminiGenerationConfig>(
  "GeminiGenerationConfig",
)({
  maxOutputTokens: Schema.Number,
  response_mime_type: Schema.Literal("application/json"),
  temperature: Schema.Number,
}) {}

export class GeminiSystemInstruction extends Schema.Class<GeminiSystemInstruction>(
  "GeminiSystemInstruction",
)({ parts: Schema.Array(GeminiTextPart).pipe(Schema.mutable) }) {}

export class GeminiGenerateContentBody extends Schema.Class<GeminiGenerateContentBody>(
  "GeminiGenerateContentBody",
)({
  contents: Schema.Array(GeminiContent).pipe(Schema.mutable),
  generationConfig: GeminiGenerationConfig,
  system_instruction: GeminiSystemInstruction,
}) {}

const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const DEFAULT_TEMPERATURE = 0.1;

function messageContent(
  messages: readonly DiagramGenerationMessage[],
  role: DiagramGenerationMessage["role"],
): string {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.content)
    .join("\n\n");
}

function numberUsage(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown, key: string): unknown {
  return isUnknownRecord(value) ? value[key] : undefined;
}

export function stripGoogleModelPrefix(model: string): string {
  return model.replace(/^google-ai-studio\//, "").replace(/^google\//, "");
}

export function buildGeminiGenerateContentBody(
  request: DiagramGenerationRequest,
): GeminiGenerateContentBody {
  const prompt = buildDiagramGenerationMessages(request.prompt);
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
  const candidates = objectValue(response, "candidates");
  const text = (Array.isArray(candidates) ? candidates : [])
    .flatMap((candidate) => {
      const parts = objectValue(objectValue(candidate, "content"), "parts");
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => objectValue(part, "text"))
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
  const usageMetadata = objectValue(response, "usageMetadata");

  if (!isUnknownRecord(usageMetadata)) {
    return undefined;
  }

  const inputTokens = numberUsage(usageMetadata["promptTokenCount"]);
  const outputTokens = numberUsage(usageMetadata["candidatesTokenCount"]);
  const totalTokens = numberUsage(usageMetadata["totalTokenCount"]);
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
