import "@tanstack/react-start/server-only";

import type { StudioEnv } from "./studio-env.server";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

function envString(value: string | undefined, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function aiEnvironment(env: StudioEnv) {
	const model = envString(env.SKETCHI_AI_MODEL, DEFAULT_MODEL);
	return {
		gatewayId: envString(env.SKETCHI_AI_GATEWAY_ID, DEFAULT_GATEWAY_ID),
		/** For `generate` only. Studio chat stays on `model`, which only a Google provider reads. */
		generateModel: envString(env.SKETCHI_AI_GENERATE_MODEL, model),
		model,
	};
}
