import handler from "@tanstack/react-start/server-entry";

export { CodeModePngRenderer } from "./features/render/png-renderer-object.server";
export { IconDrawBudget } from "./server/icons/budget-object.server";
export { ClientRateLimit } from "./server/icons/client-rate-limit.server";

import { handleSketchiMcpRequest } from "./features/mcp/mcp.server";
import type { StudioEnv } from "./server/bindings/studio-env.server";
export { StudioMcpSession } from "./features/mcp/session.server";

/** The diagrams HTTP API: builds, edits, canvases, artifacts and generation. */
function isDiagramsApi(pathname: string): boolean {
	return pathname.startsWith("/api/v1/") && pathname !== "/api/v1/icons/draw";
}

async function serveDiagramsApi(request: Request): Promise<Response> {
	const [{ getPlaygroundRequestBoundary }, http, { runPlaygroundEffect }] = await Promise.all([
		import("./server/bindings/cloudflare-bindings.server"),
		import("./features/build/http.server"),
		import("./server/runtime/runtime.server"),
	]);
	return runPlaygroundEffect(http.serveDiagramsApi(request), getPlaygroundRequestBoundary(request));
}

export default {
	fetch(request: Request, env: StudioEnv) {
		const { pathname } = new URL(request.url);
		if (pathname === "/mcp") return handleSketchiMcpRequest(request, env);
		if (isDiagramsApi(pathname)) return serveDiagramsApi(request);
		return handler.fetch(request);
	},
};
