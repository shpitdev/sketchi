import "@tanstack/react-start/server-only";

import { env, waitUntil } from "cloudflare:workers";

import type { EvalHarnessEnv } from "./generate-scenario";

export { waitUntil };

export function getEvalHarnessBindings(): EvalHarnessEnv {
	return env;
}
