import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { appUrl, envLabel } from "../app-url";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  compatibility: "strict",
  headers: {
    "HTTP-Referer": appUrl,
    "X-Title": `sketchi (${envLabel})`,
  },
});

interface OpenRouterModelOptions {
  modelId: string;
  profileId?: string;
  traceId?: string;
  userId?: string;
}

function buildMetadata({
  traceId,
  profileId,
}: {
  traceId?: string;
  profileId?: string;
}): Record<string, string> {
  const metadata: Record<string, string> = {
    env: envLabel,
    appUrl,
  };

  if (traceId) {
    metadata.traceId = traceId;
  }

  if (profileId) {
    metadata.profileId = profileId;
  }

  return metadata;
}

export function createOpenRouterChatModel({
  modelId,
  traceId,
  profileId,
  userId,
}: OpenRouterModelOptions): LanguageModel {
  const metadata = buildMetadata({ traceId, profileId });
  const extraBody: Record<string, unknown> = {
    metadata,
  };

  if (traceId) {
    extraBody.session_id = traceId;
  }

  return openrouter.chat(modelId, {
    user: userId,
    extraBody,
  });
}
