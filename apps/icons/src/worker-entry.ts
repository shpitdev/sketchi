import { String } from "effect";

import handler from "@tanstack/react-start/server-entry";

import { makeIconsHttpHandler } from "./lib/http.server.js";

import { handleIconMcpRequest, type IconsMcpEnv } from "./lib/mcp.server.js";
export { IconsMcpSession } from "./lib/mcp-session.server.js";

export { ClientRateLimit } from "./lib/client-rate-limit.server";

const api = makeIconsHttpHandler();
export default {
	fetch(
		request: Request,
		env: IconsMcpEnv,
		execution: { readonly waitUntil: (promise: Promise<unknown>) => void },
	) {
		const path = new URL(request.url).pathname;
		if (path === "/mcp") return handleIconMcpRequest(request, env);
		return path === "/api/icons" ||
			String.startsWith("/api/icons/")(path) ||
			path === "/api/community" ||
			String.startsWith("/api/community/")(path) ||
			path === "/api/openapi.json"
			? api.fetch(request, env, execution)
			: handler.fetch(request);
	},
};
