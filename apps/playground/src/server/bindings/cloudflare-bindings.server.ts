import "@tanstack/react-start/server-only";

import { env, waitUntil } from "cloudflare:workers";

import type { PlaygroundRequestBoundary } from "../runtime/playground-runtime.server";
import type { StudioEnv } from "./studio-env.server";

export function getPlaygroundRequestBoundary(
  request: Request,
): PlaygroundRequestBoundary {
  return {
    env: env as unknown as StudioEnv,
    request,
    platform: {
      waitUntilPromise: waitUntil,
    },
  };
}
