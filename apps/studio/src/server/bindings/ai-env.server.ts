import "@tanstack/react-start/server-only";

import type { StudioEnv } from "./studio-env.server";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_STUDIO_MODEL = "openai/gpt-6-luna";
const DEFAULT_GENERATE_MODEL = "anthropic/claude-haiku-5-5";

function envString(value: string | undefined, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function aiEnvironment(env: StudioEnv) {
	return {
		gatewayId: envString(env.SKETCHI_AI_GATEWAY_ID, DEFAULT_GATEWAY_ID),
		/** `generate` and the CLI, on Anthropic. */
		generateModel: envString(env.SKETCHI_AI_GENERATE_MODEL, DEFAULT_GENERATE_MODEL),
		/** Studio chat, on OpenAI's Responses API. */
		studioModel: envString(env.SKETCHI_STUDIO_MODEL, DEFAULT_STUDIO_MODEL),
	};
}
