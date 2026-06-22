import "@tanstack/react-start/server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { StudioEnv } from "./agent.server";
import { createStudioCodeModeRuntime } from "./codemode-api.server";
import {
  CodeModeDocsRequestSchema,
  CodeModeSearchRequestSchema,
  getCodeModeDocs,
  searchCodeModeDocs,
  SKETCHI_CODE_MODE_TYPES,
  SKETCHI_CODE_MODE_VERSION,
} from "./codemode-mcp-docs.server";

export interface SketchiCodeModeProvider {
  name: string;
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
  prelude?: string;
}

export interface SketchiCodeModeExecutor {
  execute(
    code: string,
    providers: SketchiCodeModeProvider[],
  ): Promise<{
    result: unknown;
    error?: string;
    logs?: string[];
  }>;
}

export interface CodeModeMcpOptions {
  executor?: SketchiCodeModeExecutor;
}

interface MinimalExecutionContext {
  passThroughOnException(): void;
  props: Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
}

type McpHttpHandler = (
  request: Request,
  env: unknown,
  ctx: MinimalExecutionContext,
) => Promise<Response>;

const ExecuteRequestSchema = z.object({
  code: z.string().min(1),
});

function stripCodeFence(code: string): string {
  const match = code.match(
    /^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/,
  );
  return match?.[1] ?? code;
}

export function normalizeSketchiExecuteCode(code: string): string {
  return stripCodeFence(code.trim())
    .trim()
    .replace(/;+\s*$/, "");
}

function jsonTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function createDefaultCodeModeExecutor(
  env: StudioEnv,
): Promise<SketchiCodeModeExecutor> {
  if (!env.LOADER) {
    throw new Error(
      "Code Mode Worker Loader binding is not configured (env.LOADER).",
    );
  }

  const { DynamicWorkerExecutor } = (await import(
    "@cloudflare/codemode"
  )) as unknown as {
    DynamicWorkerExecutor: new (options: {
      loader: unknown;
      timeout?: number;
      globalOutbound?: unknown;
    }) => SketchiCodeModeExecutor;
  };

  return new DynamicWorkerExecutor({
    loader: env.LOADER,
    globalOutbound: null,
    timeout: 30_000,
  });
}

async function executorFor(
  env: StudioEnv,
  options: CodeModeMcpOptions,
): Promise<SketchiCodeModeExecutor> {
  return options.executor ?? createDefaultCodeModeExecutor(env);
}

export async function executeSketchiCodeMode(
  env: StudioEnv,
  input: unknown,
  options: CodeModeMcpOptions = {},
): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  logs?: string[];
}> {
  try {
    const parsed = ExecuteRequestSchema.parse(input);
    const runtime = createStudioCodeModeRuntime(env);
    const executor = await executorFor(env, options);
    const execution = await executor.execute(
      normalizeSketchiExecuteCode(parsed.code),
      [
        {
          name: "sketchi",
          fns: {
            buildFlowchart: (request) => runtime.buildFlowchart(request),
            getArtifact: (request) => runtime.getArtifact(request),
            applyDiagramPatch: (request) => runtime.applyDiagramPatch(request),
          },
        },
      ],
    );

    if (execution.error) {
      return {
        ok: false,
        error: execution.error,
        logs: execution.logs ?? [],
        result: execution.result,
      };
    }

    return {
      ok: true,
      result: execution.result,
      logs: execution.logs ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    };
  }
}

export function createSketchiMcpServer(
  env: StudioEnv,
  options: CodeModeMcpOptions = {},
): McpServer {
  const server = new McpServer({
    name: "sketchi-code-mode",
    version: SKETCHI_CODE_MODE_VERSION,
  });

  server.registerTool(
    "docs",
    {
      title: "Sketchi Code Mode docs",
      description:
        "Read the harness-first Sketchi Code Mode MCP contract and usage guidance.",
      inputSchema: CodeModeDocsRequestSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    (input) => jsonTextResult(getCodeModeDocs(input)),
  );

  server.registerTool(
    "search",
    {
      title: "Search Sketchi Code Mode docs",
      description:
        "Search Sketchi Code Mode operations, schemas, examples, non-goals, and repair hints.",
      inputSchema: CodeModeSearchRequestSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    (input) => jsonTextResult(searchCodeModeDocs(input)),
  );

  server.registerTool(
    "execute",
    {
      title: "Execute Sketchi Code Mode",
      description: [
        "Run an async JavaScript arrow function for an external agent harness.",
        "Code fences and trailing expression semicolons are normalized before execution.",
        "The sandbox exposes only sketchi.buildFlowchart, sketchi.getArtifact, and sketchi.applyDiagramPatch.",
        "First get the semantic graph accepted, then use patch operations for deterministic visual changes.",
        "",
        SKETCHI_CODE_MODE_TYPES,
      ].join("\n"),
      inputSchema: ExecuteRequestSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) =>
      jsonTextResult(await executeSketchiCodeMode(env, input, options)),
  );

  return server;
}

function createExecutionContext(): MinimalExecutionContext {
  return {
    passThroughOnException() {},
    props: {},
    waitUntil() {},
  };
}

export async function handleSketchiMcpRequest(
  env: StudioEnv,
  request: Request,
  options: CodeModeMcpOptions = {},
): Promise<Response> {
  const { createMcpHandler } = await import("agents/mcp");
  const handler = createMcpHandler(createSketchiMcpServer(env, options), {
    route: "/mcp",
  }) as McpHttpHandler;

  return handler(request, env, createExecutionContext());
}
