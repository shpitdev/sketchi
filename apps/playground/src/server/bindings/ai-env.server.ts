import "@tanstack/react-start/server-only";

import type { StudioEnv } from "./studio-env.server";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

function envString(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export function aiEnvironment(env: StudioEnv) {
  return {
    gatewayId: envString(env.SKETCHI_AI_GATEWAY_ID, DEFAULT_GATEWAY_ID),
    model: envString(env.SKETCHI_AI_MODEL, DEFAULT_MODEL),
  };
}
