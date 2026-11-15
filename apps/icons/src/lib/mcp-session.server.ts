import { Clock, Effect } from "effect";
import { DurableObject } from "cloudflare:workers";
import {
	expiredMcpSession,
	MCP_SESSION_HEADER,
	MCP_SESSION_IDLE_MS,
} from "@sketchi/cloudflare/mcp-session";
import { makeIconMcpHandler, type IconsMcpEnv } from "./mcp.server.js";

/** One object, one native session scope. Eviction invalidates its opaque session. */
export class IconsMcpSession extends DurableObject<IconsMcpEnv> {
	#server: ReturnType<typeof makeIconMcpHandler> | undefined;
	#origin: string | null = null;

	// @effect-diagnostics-next-line asyncFunction:off -- Native DO fetch owns binding I/O; McpServer owns the request effect and cancellation.
	async fetch(request: Request): Promise<Response> {
		if (!this.#server) {
			if (request.headers.has(MCP_SESSION_HEADER)) return expiredMcpSession();
			this.#origin = request.headers.get("origin");
			this.#server = makeIconMcpHandler(this.#origin);
		}
		if (request.headers.get("origin") !== this.#origin)
			return new Response("Session Origin mismatch.", { status: 403 });
		await this.ctx.storage.setAlarm(Effect.runSync(Clock.currentTimeMillis) + MCP_SESSION_IDLE_MS);
		const response = await this.#server.fetch(request, this.env, (promise) =>
			this.ctx.waitUntil(promise),
		);
		if (request.method === "DELETE" && response.status === 204) await this.alarm();
		return response;
	}

	// @effect-diagnostics-next-line asyncFunction:off -- Native alarm callback awaits native session disposal before deleting its durable state.
	async alarm(): Promise<void> {
		const server = this.#server;
		this.#server = undefined;
		await server?.dispose();
		await this.ctx.storage.deleteAll();
	}
}
