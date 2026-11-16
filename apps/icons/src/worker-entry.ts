import { String } from "effect";

import handler from "@tanstack/react-start/server-entry";

import { type IconsHttpEnv, makeIconsHttpHandler } from "./http.server";

import { handleIconMcpRequest, type IconsMcpEnv } from "./features/mcp/mcp.server";
export { IconsMcpSession } from "./features/mcp/session.server";

export { ClientRateLimit } from "./features/community/client-rate-limit.server";

const api = makeIconsHttpHandler();
export default {
	fetch(
		request: Request,
		env: IconsHttpEnv & IconsMcpEnv,
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
