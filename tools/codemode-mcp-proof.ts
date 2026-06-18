import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createSketchiMcpServer,
  type SketchiCodeModeExecutor,
  type SketchiCodeModeProvider,
} from "../apps/studio/src/lib/codemode-mcp.server";

const CODE = `async () => {
  const built = await sketchi.buildFlowchart({
    spec: {
      title: "Harness proof flow",
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
    options: { inlineArtifacts: ["scene"] },
  });

  if (!patched.ok) return patched;

  return sketchi.getArtifact({
    artifactId: patched.artifact.artifactId,
    format: "scene",
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

function parseTextJson(response: { content: Array<unknown> }): unknown {
  const item = response.content.find(
    (value): value is { type: "text"; text: string } =>
      isRecord(value) &&
      value.type === "text" &&
      typeof value.text === "string",
  );

  if (!item) {
    throw new Error("MCP response did not include text content.");
  }

  return JSON.parse(item.text);
}

function elementCountFrom(result: Record<string, unknown>): number | null {
  const inline = result.inline;
  if (isRecord(inline) && Array.isArray(inline.elements)) {
    return inline.elements.length;
  }
  return null;
}

async function main() {
  const client = new Client({
    name: "sketchi-codemode-proof",
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

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    if (toolNames.join(",") !== "docs,execute,search") {
      throw new Error(`Unexpected MCP tools: ${toolNames.join(", ")}`);
    }

    const docs = parseTextJson(
      await client.callTool({
        name: "docs",
        arguments: { topic: "execute" },
      }),
    );
    const search = parseTextJson(
      await client.callTool({
        name: "search",
        arguments: { query: "circle purple decision diamond" },
      }),
    );
    const execute = parseTextJson(
      await client.callTool({
        name: "execute",
        arguments: { code: CODE },
      }),
    );

    if (
      !isRecord(execute) ||
      execute.ok !== true ||
      !isRecord(execute.result)
    ) {
      throw new Error("Code Mode execute did not return an accepted result.");
    }

    if (execute.result.ok !== true || execute.result.format !== "scene") {
      throw new Error("Code Mode execute did not return an inline scene.");
    }

    const outputDir = join(process.cwd(), ".memory", "codemode-mcp-proof");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(
      outputDir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );

    const evidence = {
      generatedAt: new Date().toISOString(),
      toolNames,
      docs,
      search,
      execute: {
        ok: execute.ok,
        logs: execute.logs,
        result: {
          artifactId: execute.result.artifactId,
          diagramId: execute.result.diagramId,
          elementCount: elementCountFrom(execute.result),
          format: execute.result.format,
          ok: execute.result.ok,
        },
      },
    };

    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(
      `Code Mode MCP proof passed: tools=${toolNames.join(", ")} evidence=${outputPath}`,
    );
  } finally {
    await client.close();
    await server.close();
  }
}

await main();
