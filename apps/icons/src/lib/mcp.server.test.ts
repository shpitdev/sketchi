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
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "get_icon",
        "search_icons",
      ]);
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(
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
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
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
});
