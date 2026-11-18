import "@tanstack/react-start/server-only";

import { env, waitUntil } from "cloudflare:workers";

import type { StudioRequestBoundary } from "./runtime.server";

export function getStudioRequestBoundary(request: Request): StudioRequestBoundary {
	return {
		env,
		request,
		platform: {
			waitUntilPromise: waitUntil,
		},
	};
}
