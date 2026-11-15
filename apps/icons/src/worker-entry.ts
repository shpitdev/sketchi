import { String } from "effect";

import handler from "@tanstack/react-start/server-entry";

import { makeIconsHttpHandler, type IconsHttpEnv } from "./lib/http.server.js";

export { ClientRateLimit } from "./lib/client-rate-limit.server";

const api = makeIconsHttpHandler();
export default {
	fetch(
		request: Request,
		env: IconsHttpEnv,
		execution: { readonly waitUntil: (promise: Promise<unknown>) => void },
	) {
		const path = new URL(request.url).pathname;
		return path === "/api/icons" ||
			String.startsWith("/api/icons/")(path) ||
			path === "/api/community" ||
			String.startsWith("/api/community/")(path) ||
			path === "/api/openapi.json"
			? api.fetch(request, env, execution)
			: handler.fetch(request);
	},
};
