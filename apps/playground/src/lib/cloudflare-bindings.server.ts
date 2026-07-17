import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { StudioEnv } from "./agent.server";

export function getStudioBindings(): StudioEnv {
  return env as unknown as StudioEnv;
}
