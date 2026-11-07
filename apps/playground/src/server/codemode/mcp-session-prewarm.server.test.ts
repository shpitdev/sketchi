import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { prewarmPngRendererOnSessionStart, readMcpMessage } from "./mcp-session-prewarm.server";

const prewarmOn = <R>(
	request: Request,
	codeMode: { readonly prewarmPngRenderer: Effect.Effect<void, never, R> },
) =>
	Effect.flatMap(readMcpMessage(request), (message) =>
		prewarmPngRendererOnSessionStart(message, codeMode),
	);

function mcpPost(body: unknown): Request {
	return new Request("https://studio.test/mcp", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function jsonRpc(method: string, params?: unknown) {
	return { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) };
}

function prewarmProbe() {
	const prewarmed = vi.fn();
	return { codeMode: { prewarmPngRenderer: Effect.sync(prewarmed) }, prewarmed };
}

describe("MCP session prewarm", () => {
	for (const [name, body] of [
		["initialize", jsonRpc("initialize", { protocolVersion: "2025-06-18" })],
		["tools/list", jsonRpc("tools/list")],
		["a docs call", jsonRpc("tools/call", { name: "docs", arguments: { topic: "overview" } })],
		[
			"a batch that starts a session",
			[jsonRpc("notifications/initialized"), jsonRpc("tools/list")],
		],
	] as const) {
		it.effect(`prewarms the PNG renderer on ${name}`, () =>
			Effect.gen(function* () {
				const { codeMode, prewarmed } = prewarmProbe();
				yield* prewarmOn(mcpPost(body), codeMode);
				expect(prewarmed).toHaveBeenCalledTimes(1);
			}),
		);
	}

	for (const [name, request] of [
		[
			"an execute call",
			mcpPost(jsonRpc("tools/call", { name: "execute", arguments: { code: "async () => 1" } })),
		],
		["a search call", mcpPost(jsonRpc("tools/call", { name: "search", arguments: { q: "png" } }))],
		["a malformed body", mcpPost("{not json")],
		["a GET stream", new Request("https://studio.test/mcp", { method: "GET" })],
	] as const) {
		it.effect(`does not prewarm on ${name}`, () =>
			Effect.gen(function* () {
				const { codeMode, prewarmed } = prewarmProbe();
				yield* prewarmOn(request, codeMode);
				expect(prewarmed).not.toHaveBeenCalled();
			}),
		);
	}

	it.effect("leaves the request body for the MCP transport", () =>
		Effect.gen(function* () {
			const { codeMode } = prewarmProbe();
			const request = mcpPost(jsonRpc("tools/list"));
			const message = yield* readMcpMessage(request);
			yield* prewarmPngRendererOnSessionStart(message, codeMode);
			const forwarded = yield* Effect.promise(() => request.json());
			expect(forwarded).toMatchObject({ method: "tools/list" });
		}),
	);
});
