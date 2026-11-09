import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";

import type { CommunityEnv } from "./community.server.js";

export function getCommunityEnv(): CommunityEnv {
	return env;
}
