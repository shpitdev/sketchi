import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import { createIconSourceLoader } from "./icon-catalog.server.js";

export function getIconSourceLoader() {
  return createIconSourceLoader(env.ASSETS);
}
