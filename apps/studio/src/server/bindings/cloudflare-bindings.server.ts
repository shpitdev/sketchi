import "@tanstack/react-start/server-only";

import { env, waitUntil } from "cloudflare:workers";

import type { PlaygroundRequestBoundary } from "../runtime/runtime.server";

export function getPlaygroundRequestBoundary(request: Request): PlaygroundRequestBoundary {
	return {
		env,
		request,
		platform: {
			waitUntilPromise: waitUntil,
		},
	};
}
