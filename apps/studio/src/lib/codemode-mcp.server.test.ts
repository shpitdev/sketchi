import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vitest";

import {
  createSketchiMcpServer,
  executeSketchiCodeMode,
  handleSketchiMcpRequest,
  normalizeSketchiExecuteCode,
  type CodeModeMcpOptions,
  type SketchiCodeModeExecutor,
  type SketchiCodeModeProvider,
} from "./codemode-mcp.server";

const CIRCLE_TO_DIAMOND_CODE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Harness MCP proof flow",
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "choice", label: "Continue?", kind: "decision" },
        { id: "yes", label: "Continue", kind: "end" },
        { id: "no", label: "Stop", kind: "end" },
      ],
      edges: [
        { source: "start", target: "choice" },
        { source: "choice", target: "yes", label: "yes" },
        { source: "choice", target: "no", label: "no" },
      ],
      layout: { direction: "LR" },
    },
  });

  if (!built.ok) return built;

  const patched = await sketchi.applyDiagramPatch({
    source: { artifactId: built.artifact.artifactId },
    operations: [
      { op: "setShape", selector: { nodeIds: ["start"] }, shape: "circle" },
      { op: "setShape", selector: { nodeIds: ["choice"] }, shape: "diamond" },
      {
        op: "setStyle",
        selector: { nodeIds: ["choice"] },
        style: { strokeColor: "#7c3aed", fillColor: "#ede9fe" },
      },
    ],
    options: {
      artifactFormats: ["scene", "excalidraw"],
      inlineArtifacts: ["excalidraw"],
    },
  });

  if (!patched.ok) return patched;

  return sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "excalidraw",
    inline: true,
  });
}`;

function createInProcessExecutor(): SketchiCodeModeExecutor {
  return {
    async execute(code: string, providers: SketchiCodeModeProvider[]) {
      const namespaces = Object.fromEntries(
        providers.map((provider) => [provider.name, provider.fns]),
      );
      const names = Object.keys(namespaces);
      const values = Object.values(namespaces);
      const logs: string[] = [];
      const sandboxConsole = {
        log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      };

      try {
        const source = code.trim().replace(/;+\s*$/, "");
        const run = new Function(
          ...names,
          "console",
          `"use strict"; return (${source})();`,
        );
        return {
          result: await run(...values, sandboxConsole),
          logs,
        };
      } catch (error) {
        return {
          result: null,
          error: error instanceof Error ? error.message : String(error),
          logs,
        };
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredContent(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.structuredContent)) {
    throw new Error("MCP response did not include structured content.");
  }

  return response.structuredContent;
}

function createMcpFetch(options: CodeModeMcpOptions): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return handleSketchiMcpRequest({}, request, options);
  };
}

describe("Sketchi Code Mode MCP server", () => {
  it("normalizes common LLM execute input wrappers", () => {
    expect(normalizeSketchiExecuteCode("async () => { return 1; };")).toBe(
      "async () => { return 1; }",
    );
    expect(
      normalizeSketchiExecuteCode("```js\nasync () => { return 1; };\n```"),
    ).toBe("async () => { return 1; }");
  });

  it("exposes docs, search, and execute tools through the MCP protocol", async () => {
    const client = new Client({
      name: "sketchi-codemode-test-client",
      version: "0.0.0",
    });
    const server = createSketchiMcpServer(
      {},
      { executor: createInProcessExecutor() },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expect(client.ping()).resolves.toEqual({});

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "docs",
        "execute",
        "search",
      ]);
      const executeTool = tools.tools.find((tool) => tool.name === "execute");
      expect(executeTool?.inputSchema).toMatchObject({
        properties: {
          code: { type: "string" },
        },
        required: ["code"],
        type: "object",
      });
      expect(executeTool?.description).toContain("Write JavaScript only");
      expect(executeTool?.description).toContain("async () =>");
      expect(executeTool?.description).toContain("artifactDelivery");
      expect(executeTool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
      expect(
        tools.tools.find((tool) => tool.name === "docs")?.outputSchema,
      ).toBeDefined();
      expect(
        tools.tools.find((tool) => tool.name === "search")?.outputSchema,
      ).toBeDefined();
      expect(
        tools.tools.find((tool) => tool.name === "execute")?.outputSchema,
      ).toBeDefined();

      const docs = structuredContent(
        await client.callTool({
          name: "docs",
          arguments: { topic: "agentSequence" },
        }),
      );
      expect(docs).toMatchObject({
        topic: "agentSequence",
      });
      expect(JSON.stringify(docs)).toContain("buildFlowchart");

      const search = structuredContent(
        await client.callTool({
          name: "search",
          arguments: { query: "managed convex threads" },
        }),
      );
      expect(JSON.stringify(search)).toContain("managed-thread-non-goal");

      const execute = structuredContent(
        await client.callTool({
          name: "execute",
          arguments: { code: CIRCLE_TO_DIAMOND_CODE },
        }),
      );
      expect(execute).toMatchObject({
        ok: true,
        result: {
          ok: true,
          format: "excalidraw",
          inline: {
            type: "excalidraw",
            version: 2,
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves docs, search, and execute over the streamable HTTP MCP route", async () => {
    const client = new Client({
      name: "sketchi-codemode-http-test-client",
      version: "0.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://studio.test/mcp"),
      {
        fetch: createMcpFetch({ executor: createInProcessExecutor() }),
      },
    );

    try {
      await client.connect(transport as unknown as Transport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "docs",
        "execute",
        "search",
      ]);

      const docs = structuredContent(
        await client.callTool({
          name: "docs",
          arguments: { topic: "execute" },
        }),
      );
      expect(JSON.stringify(docs)).toContain("sketchi.applyDiagramPatch");

      const execute = structuredContent(
        await client.callTool({
          name: "execute",
          arguments: { code: CIRCLE_TO_DIAMOND_CODE },
        }),
      );
      expect(execute).toMatchObject({
        ok: true,
        result: {
          ok: true,
          format: "excalidraw",
          inline: {
            type: "excalidraw",
            version: 2,
          },
          url: expect.stringContaining("https://studio.test/api/v1/artifacts/"),
        },
      });
    } finally {
      await client.close();
    }
  });

  it("returns structured execute errors instead of throwing tool failures", async () => {
    await expect(
      executeSketchiCodeMode({}, {}, { executor: createInProcessExecutor() }),
    ).resolves.toMatchObject({
      ok: false,
      logs: [],
    });

    const result = await executeSketchiCodeMode(
      {},
      {
        code: `async () => {
          throw new Error("generated code failed");
        }`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toEqual({
      ok: false,
      error: "generated code failed",
      logs: [],
      result: null,
    });
  });

  it("accepts execute code with a trailing arrow-function semicolon", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: `${CIRCLE_TO_DIAMOND_CODE};`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        ok: true,
        format: "excalidraw",
      },
    });
  });

  it("adds artifactDelivery when generated code returns an accepted artifact bundle", async () => {
    const result = await executeSketchiCodeMode(
      {},
      {
        code: `async () => ({
          ok: true,
          status: "accepted",
          artifact: {
            artifactId: "artifact_delivery",
            diagramId: "diagram_delivery",
            formats: [
              {
                format: "scene",
                mimeType: "application/vnd.sketchi.scene+json",
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true"
              },
              {
                format: "excalidraw",
                mimeType: "application/vnd.excalidraw+json",
                sizeBytes: 1234,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true"
              },
              {
                format: "png",
                mimeType: "image/png",
                sizeBytes: 5678,
                url: "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true"
              }
            ]
          }
        })`,
      },
      { executor: createInProcessExecutor() },
    );

    expect(result).toMatchObject({
      artifactDelivery: {
        artifactId: "artifact_delivery",
        diagramId: "diagram_delivery",
        excalidrawUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=excalidraw&raw=true",
        formats: [
          {
            format: "scene",
          },
          {
            format: "excalidraw",
            mimeType: "application/vnd.excalidraw+json",
            sizeBytes: 1234,
          },
          {
            format: "png",
            mimeType: "image/png",
            sizeBytes: 5678,
          },
        ],
        pngUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=png&raw=true",
        sceneUrl:
          "https://studio.test/api/v1/artifacts/artifact_delivery?format=scene&raw=true",
      },
      ok: true,
    });
    expect(result.artifactDelivery?.finalResponseInstruction).toContain(
      "Do not create a Markdown wrapper",
    );
  });
});
