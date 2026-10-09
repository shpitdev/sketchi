import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { EvalHarnessEnv } from "./generate-scenario";

export function getEvalHarnessBindings(): EvalHarnessEnv {
  return env;
}
