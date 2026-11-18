// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { McpClient, McpProtocol } from "effect/ai";
import { FetchHttpClient } from "effect/http";
import { serveStatelessMcp } from "@sketchi/cloudflare/mcp-http";
import { handleIconMcpRequest } from "../src/features/mcp/mcp.server";

type Assets = (url: URL) => Promise<Response>;

/** An unchanged 2025-11-25 client of the Worker's /mcp boundary at `origin`. */
const clientFor = (origin: string, assets: Assets) =>
	Layer.build(
		McpClient.layerHttp({
			name: "icons-policy",
			version: "1",
			protocol: McpProtocol.v2025_11_25,
			url: `${origin}/mcp`,
		}).pipe(
			Layer.provide(FetchHttpClient.layer),
			Layer.provide(
				Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
					handleIconMcpRequest(
						new Request(input, init),
						{ ASSETS: { fetch: (url) => assets(new URL(url instanceof Request ? url.url : url)) } },
						() => {},
					)) as typeof fetch),
			),
		),
	).pipe(
		Effect.map(Context.get(McpClient.McpClient)),
		Effect.map((client) => ({
			listTools: client.listTools,
			callTool: ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) =>
				Effect.flatMap(client.listTools(), (tools) =>
					client.callTool({ tool: tools.find((tool) => tool.name === name)!, arguments: args }),
				),
		})),
	);
const svg: Assets = async (url) => new Response(`<svg data-origin="${url.origin}" />`);

describe("icons MCP tools", () => {
	it.effect("ranks aliases, trims real inputs and delivers raw SVG with isolated source URLs", () =>
		Effect.gen(function* () {
			const one = yield* clientFor("https://one.test", svg);
			const two = yield* clientFor("https://two.test", svg);
			expect((yield* one.listTools()).map((tool) => tool.name).sort()).toEqual([
				"get_icon",
				"search_icons",
			]);
			const search = yield* one.callTool({
				name: "search_icons",
				arguments: { q: " k8s ", limit: 1 },
			});
			expect(search.structuredContent).toMatchObject({
				query: "k8s",
				count: 1,
				results: [{ slug: "kubernetes" }],
			});
			const results = yield* Effect.all(
				[one, two].map((client) =>
					client.callTool({ name: "get_icon", arguments: { slug: " kubernetes " } }),
				),
				{ concurrency: 2 },
			);
			for (const [index, result] of results.entries()) {
				const origin = index === 0 ? "https://one.test" : "https://two.test";
				expect(result.content[0]).toEqual({
					type: "text",
					text: `<svg data-origin="${origin}" />`,
				});
				expect(result.structuredContent).toMatchObject({
					slug: "kubernetes",
					svgUrl: `${origin}/api/icons/kubernetes.svg`,
				});
			}
		}).pipe(Effect.scoped),
	);

	it.effect("keeps actionable input, missing-icon and source failure details", () =>
		Effect.gen(function* () {
			const client = yield* clientFor(
				"https://icons.test",
				async () => new Response(null, { status: 503 }),
			);
			const invalid = yield* client.callTool({ name: "search_icons", arguments: { limit: 101 } });
			expect(invalid).toMatchObject({
				isError: true,
				content: [{ text: expect.stringContaining("limit") }],
			});
			const missing = yield* client.callTool({ name: "get_icon", arguments: { slug: "missing" } });
			expect(missing).toMatchObject({
				isError: true,
				content: [{ text: expect.stringContaining("missing") }],
			});
			const failed = yield* client.callTool({
				name: "get_icon",
				arguments: { slug: "kubernetes" },
			});
			expect(failed).toMatchObject({
				isError: true,
				content: [{ text: expect.stringContaining("503") }],
			});
		}).pipe(Effect.scoped),
	);

	it.effect(
		"releases each request's handler once, whether its body ends, is cancelled or fails",
		() =>
			Effect.gen(function* () {
				const initialize = () =>
					new Request("https://icons.test/mcp", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
					});
				const serve = (body: UnderlyingDefaultSource<Uint8Array>) =>
					Effect.gen(function* () {
						let disposed = 0;
						const pending: Promise<unknown>[] = [];
						const response = yield* serveStatelessMcp(
							initialize(),
							() => ({
								fetch: async () => new Response(new ReadableStream(body)),
								dispose: async () => {
									disposed += 1;
								},
							}),
							(promise) => pending.push(promise),
						);
						return { response, disposed: () => Promise.all(pending).then(() => disposed) };
					});
				const ended = yield* serve({ start: (controller) => controller.close() });
				yield* Effect.promise(() => ended.response.text());
				expect(yield* Effect.promise(ended.disposed)).toBe(1);
				const cancelled = yield* serve({ pull: () => new Promise(() => {}) });
				yield* Effect.promise(() => cancelled.response.body!.cancel());
				expect(yield* Effect.promise(cancelled.disposed)).toBe(1);
				const failed = yield* serve({ pull: (controller) => controller.error(new Error("lost")) });
				yield* Effect.promise(() =>
					failed.response.text().then(
						() => "read",
						() => "failed",
					),
				).pipe(Effect.map((outcome) => expect(outcome).toBe("failed")));
				expect(yield* Effect.promise(failed.disposed)).toBe(1);
			}),
	);
});
