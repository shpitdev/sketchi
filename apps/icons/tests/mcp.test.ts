// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpProtocol, McpServer, McpTest } from "effect/ai";
import { IconSource } from "../src/lib/api.server";
import type { IconSourceLoader } from "../src/lib/catalog.server";
import { IconMcpRegistrations } from "../src/lib/mcp.server";

const clientFor = (origin: string, sourceLoader: IconSourceLoader) =>
	McpTest.makeClient(
		IconMcpRegistrations.pipe(
			Layer.provide(
				McpServer.middleware<{ provides: IconSource }>()((effect) =>
					Effect.provideService(effect, IconSource, { origin, sourceLoader }),
				).layer,
			),
		),
		{ name: "icons-policy", version: "1", protocols: [McpProtocol.v2025_11_25] },
	);

describe("icons MCP tools", () => {
	it.effect("ranks aliases, trims real inputs and delivers raw SVG with isolated source URLs", () =>
		Effect.gen(function* () {
			const load: IconSourceLoader = async (request) =>
				`<svg data-origin="${new URL(request.url).origin}" />`;
			const one = yield* clientFor("https://one.test", load);
			const two = yield* clientFor("https://two.test", load);
			expect((yield* one.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
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
		}),
	);

	it.effect("keeps actionable input, missing-icon and source failure details", () =>
		Effect.gen(function* () {
			const client = yield* clientFor("https://icons.test", async () => {
				throw new Error("Source returned HTTP 503.");
			});
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
		}),
	);
});
