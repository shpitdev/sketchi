import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  DIAGRAM_AGENT_TOOL_NAMES,
  getDiagramAgentToolDescriptors,
} from "@sketchi/diagram-agent-tools";
import { describe, expect, test } from "vitest";

import {
  createSketchiMcpServer,
  getSketchiMcpTools,
  type SketchiMcpToolExecutor,
} from "./mcp-server.js";

async function createConnectedClient(input: {
  executor?: SketchiMcpToolExecutor;
}) {
  const server = createSketchiMcpServer(
    input.executor ? { executor: input.executor } : {}
  );
  const client = new Client({ name: "sketchi-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

describe("Sketchi MCP server", () => {
  test("maps the shared diagram agent catalog to MCP tools", () => {
    const tools = getSketchiMcpTools();

    expect(tools.map((tool) => tool.name)).toEqual(DIAGRAM_AGENT_TOOL_NAMES);

    for (const descriptor of getDiagramAgentToolDescriptors()) {
      const tool = tools.find((item) => item.name === descriptor.name);
      expect(tool).toBeDefined();
      expect(tool?.description).toBe(descriptor.description);
      expect(tool?.inputSchema).toEqual(descriptor.inputSchema);
      expect(tool?.annotations?.openWorldHint).toBe(true);
    }
  });

  test("lists shared Sketchi tools over the MCP protocol", async () => {
    const { client, server } = await createConnectedClient({});

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(
        DIAGRAM_AGENT_TOOL_NAMES
      );
      expect(result.tools[0]?.inputSchema.type).toBe("object");
      expect(result.tools[0]?.description?.toLowerCase()).toContain(
        "excalidraw"
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("routes tool calls to the configured executor", async () => {
    const calls: unknown[] = [];
    const { client, server } = await createConnectedClient({
      executor: (call) => {
        calls.push(call);
        return Promise.resolve({
          ok: true,
          tool: call.name,
          args: call.arguments,
        });
      },
    });

    try {
      const result = (await client.callTool({
        name: "diagram_from_prompt",
        arguments: { prompt: "Map the auth flow" },
      })) as CallToolResult;

      expect(calls).toEqual([
        {
          name: "diagram_from_prompt",
          arguments: { prompt: "Map the auth flow" },
        },
      ]);
      expect(result.structuredContent).toEqual({
        ok: true,
        tool: "diagram_from_prompt",
        args: { prompt: "Map the auth flow" },
      });
      expect(result.content[0]).toMatchObject({ type: "text" });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("returns MCP tool errors when the configured executor throws", async () => {
    const { client, server } = await createConnectedClient({
      executor: () => {
        throw new Error("executor unavailable");
      },
    });

    try {
      const result = (await client.callTool({
        name: "diagram_from_prompt",
        arguments: { prompt: "Map the auth flow" },
      })) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "executor unavailable",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("returns MCP errors for unknown tools", async () => {
    const { client, server } = await createConnectedClient({});

    try {
      const result = (await client.callTool({
        name: "unknown_tool",
      })) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: "Unknown Sketchi tool 'unknown_tool'.",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
