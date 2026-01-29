import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

const DEFAULT_PROD_URL = "https://sketchi.app";
const DEFAULT_DEV_URL = "http://localhost:3001";

const resolvedEnv = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev";
let envLabel = resolvedEnv;
if (resolvedEnv === "production") {
  envLabel = "prod";
} else if (resolvedEnv === "development") {
  envLabel = "dev";
}

const appUrl = (() => {
  const explicit = process.env.SKETCHI_APP_URL ?? process.env.APP_URL;
  if (explicit) {
    return explicit;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return envLabel === "prod" ? DEFAULT_PROD_URL : DEFAULT_DEV_URL;
})();

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
  traceId?: string;
  profileId?: string;
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
