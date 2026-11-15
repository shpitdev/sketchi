import handler from "@tanstack/react-start/server-entry";

export { CodeModePngRenderer } from "./features/render/png-renderer-object.server";
export { IconDrawBudget } from "./server/icons/budget-object.server";
export { ClientRateLimit } from "./server/icons/client-rate-limit.server";

import { handleSketchiMcpRequest } from "./features/mcp/mcp.server";
import type { StudioEnv } from "./server/bindings/studio-env.server";
export { StudioMcpSession } from "./features/mcp/session.server";
export default {
	fetch(request: Request, env: StudioEnv) {
		return new URL(request.url).pathname === "/mcp"
			? handleSketchiMcpRequest(request, env)
			: handler.fetch(request);
	},
};
