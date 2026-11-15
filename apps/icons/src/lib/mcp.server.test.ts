// @vitest-environment node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createIconMcpServer } from "./mcp.server";

describe("Sketchi Icons MCP", () => {
	it("exposes ranked search_icons and raw-first get_icon contracts", async () => {
		const server = createIconMcpServer({
			origin: "https://icons.sketchi.app",
			sourceLoader: async () => '<svg id="kubernetes" />',
		});
		const client = new Client({ name: "icons-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			const tools = await client.listTools();
			expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["get_icon", "search_icons"]);
			expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
			expect(tools.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(
				true,
			);

			const search = await client.callTool({
				arguments: { limit: 5, q: "k8s" },
				name: "search_icons",
			});
			expect(search.structuredContent).toMatchObject({
				results: [{ slug: "kubernetes" }],
			});

			const get = await client.callTool({
				arguments: { slug: "kubernetes" },
				name: "get_icon",
			});
			const content = Array.isArray(get.content) ? get.content : [];
			expect(content[0]).toEqual({
				text: '<svg id="kubernetes" />',
				type: "text",
			});
			expect(get.structuredContent).toMatchObject({
				colorMode: "multicolor",
				slug: "kubernetes",
				svgUrl: "https://icons.sketchi.app/api/icons/kubernetes.svg",
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("returns tool errors for invalid limits and missing icons", async () => {
		const server = createIconMcpServer({ sourceLoader: async () => "<svg />" });
		const client = new Client({ name: "icons-errors-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			const invalid = await client.callTool({
				arguments: { limit: 101 },
				name: "search_icons",
			});
			expect(invalid.isError).toBe(true);
			const missing = await client.callTool({
				arguments: { slug: "missing" },
				name: "get_icon",
			});
			expect(missing.isError).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});
	it("preserves permissive optional inputs, trimming, defaults and exact argument errors", async () => {
		const server = createIconMcpServer({ sourceLoader: async () => "<svg />" });
		const client = new Client({ name: "icons-inputs-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			const defaults = await client.callTool({ name: "search_icons" });
			expect(defaults.structuredContent).toMatchObject({ query: "", collection: null, count: 50 });
			for (const input of [
				{ q: 42, collection: false, extra: "ignored" },
				{ q: "  ", collection: " " },
			]) {
				expect(await client.callTool({ name: "search_icons", arguments: input })).toEqual(defaults);
			}
			const trimmed = await client.callTool({
				name: "search_icons",
				arguments: { q: "  k8s  ", limit: 1, extra: true },
			});
			expect(trimmed.structuredContent).toMatchObject({
				query: "k8s",
				count: 1,
				results: [{ slug: "kubernetes" }],
			});
			const icon = await client.callTool({
				name: "get_icon",
				arguments: { slug: " kubernetes ", extra: true },
			});
			expect(icon.structuredContent).toMatchObject({ slug: "kubernetes" });
			for (const limit of [null, "5", 0, 1.5, 101]) {
				expect(await client.callTool({ name: "search_icons", arguments: { limit } })).toEqual({
					isError: true,
					content: [{ type: "text", text: "limit must be an integer from 1 to 100." }],
				});
			}
			for (const slug of [null, 1, "  "]) {
				expect(await client.callTool({ name: "get_icon", arguments: { slug } })).toEqual({
					isError: true,
					content: [{ type: "text", text: "slug is required." }],
				});
			}
			expect(await client.callTool({ name: "unknown", arguments: {} })).toEqual({
				isError: true,
				content: [{ type: "text", text: "Tool unknown was not found." }],
			});
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("retains source failure details as protocol errors", async () => {
		const server = createIconMcpServer({
			sourceLoader: async () => {
				throw new Error("source unavailable");
			},
		});
		const client = new Client({ name: "icons-source-failure-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			await expect(
				client.callTool({ name: "get_icon", arguments: { slug: "kubernetes" } }),
			).rejects.toThrow("source unavailable");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("propagates SDK cancellation to the active source request", async () => {
		const started = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const server = createIconMcpServer({
			sourceLoader: (request) =>
				new Promise<string>((_resolve, reject) => {
					const abort = () => {
						aborted.resolve();
						reject(new Error("source cancelled"));
					};
					request.signal.addEventListener("abort", abort, { once: true });
					if (request.signal.aborted) abort();
					started.resolve();
				}),
		});
		const client = new Client({ name: "icons-cancel-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const controller = new AbortController();
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			const call = client.callTool(
				{ name: "get_icon", arguments: { slug: "kubernetes" } },
				undefined,
				{ signal: controller.signal },
			);
			const rejected = call.catch((error: unknown) => error);
			await started.promise;
			controller.abort();
			expect(await rejected).toBeInstanceOf(Error);
			await aborted.promise;
		} finally {
			controller.abort();
			await client.close();
			await server.close();
		}
	});
});
