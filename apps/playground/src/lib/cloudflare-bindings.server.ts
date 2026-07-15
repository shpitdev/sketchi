import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { PlaygroundEnv } from "./generate-scenario";

export function getPlaygroundBindings(): PlaygroundEnv {
  return env as unknown as PlaygroundEnv;
}
