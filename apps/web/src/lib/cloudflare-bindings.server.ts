import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { WebSurfaceEnv } from "./surface-urls";

export function getWebBindings(): WebSurfaceEnv {
  return env as unknown as WebSurfaceEnv;
}
