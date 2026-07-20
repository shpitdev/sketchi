import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { EvalHarnessEnv } from "./generate-scenario";

export function getEvalHarnessBindings(): EvalHarnessEnv {
  return {
    ...(env.AI ? { AI: env.AI } : {}),
    ...(env.SKETCHI_AI_GATEWAY_ID
      ? { SKETCHI_AI_GATEWAY_ID: env.SKETCHI_AI_GATEWAY_ID }
      : {}),
    ...(env.SKETCHI_AI_MODEL ? { SKETCHI_AI_MODEL: env.SKETCHI_AI_MODEL } : {}),
  };
}
