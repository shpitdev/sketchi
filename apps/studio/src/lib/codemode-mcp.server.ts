import "@tanstack/react-start/server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { StudioEnv } from "./agent.server";
import { createStudioCodeModeRuntime } from "./codemode-api.server";
import {
  CodeModeDocsRequestSchema,
  CodeModeDocsResultSchema,
  CodeModeSearchRequestSchema,
  CodeModeSearchResultSchema,
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
  origin?: string;
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

const ExecuteArtifactDeliverySchema = z.object({
  artifactId: z.string(),
  diagramId: z.string().optional(),
  excalidrawUrl: z.string().optional(),
  finalResponseInstruction: z.string(),
  formats: z.array(
    z.object({
      expiresAt: z.string().optional(),
      format: z.string(),
      mimeType: z.string().optional(),
      sizeBytes: z.number().optional(),
      url: z.string().optional(),
    }),
  ),
  pngUrl: z.string().optional(),
  sceneUrl: z.string().optional(),
});

const ExecuteResultSchema = z.object({
  artifactDelivery: ExecuteArtifactDeliverySchema.optional(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  logs: z.array(z.string()).optional(),
});

interface ArtifactDelivery {
  artifactId: string;
  diagramId?: string;
  excalidrawUrl?: string;
  finalResponseInstruction: string;
  formats: ArtifactDeliveryFormat[];
  pngUrl?: string;
  sceneUrl?: string;
}

interface ArtifactDeliveryFormat {
  expiresAt?: string;
  format: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
}

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

function jsonResult(value: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function artifactFormatsFrom(value: unknown): ArtifactDeliveryFormat[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).flatMap((formatRef) => {
    const format = stringValue(formatRef.format);
    if (!format) {
      return [];
    }
    const expiresAt = stringValue(formatRef.expiresAt);
    const mimeType = stringValue(formatRef.mimeType);
    const sizeBytes = numberValue(formatRef.sizeBytes);
    const url = stringValue(formatRef.url);

    return [
      {
        ...(expiresAt ? { expiresAt } : {}),
        format,
        ...(mimeType ? { mimeType } : {}),
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
        ...(url ? { url } : {}),
      },
    ];
  });
}

function acceptedArtifactContainerFrom(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.ok === true && isRecord(value.artifact)) {
    return value.artifact;
  }

  if (
    value.ok === true &&
    stringValue(value.artifactId) &&
    Array.isArray(value.formats)
  ) {
    return value;
  }

  return (
    acceptedArtifactContainerFrom(value.result) ??
    acceptedArtifactContainerFrom(value.patched) ??
    acceptedArtifactContainerFrom(value.built) ??
    acceptedArtifactContainerFrom(value.artifact)
  );
}

function urlForFormat(
  formats: readonly ArtifactDeliveryFormat[],
  format: string,
): string | undefined {
  return formats.find((formatRef) => formatRef.format === format)?.url;
}

function artifactDeliveryFrom(value: unknown): ArtifactDelivery | undefined {
  const artifact = acceptedArtifactContainerFrom(value);
  const artifactId = stringValue(artifact?.artifactId);
  if (!artifact || !artifactId) {
    return undefined;
  }

  const formats = artifactFormatsFrom(artifact.formats);
  if (formats.length === 0) {
    return undefined;
  }
  const diagramId = stringValue(artifact.diagramId);
  const excalidrawUrl = urlForFormat(formats, "excalidraw");
  const pngUrl = urlForFormat(formats, "png");
  const sceneUrl = urlForFormat(formats, "scene");

  return {
    artifactId,
    ...(diagramId ? { diagramId } : {}),
    ...(excalidrawUrl ? { excalidrawUrl } : {}),
    finalResponseInstruction:
      "Return this Sketchi artifact delivery object directly to the user. Do not create a Markdown wrapper, Mermaid diagram, local file, or separate Antigravity artifact after Sketchi accepts the diagram.",
    formats,
    ...(pngUrl ? { pngUrl } : {}),
    ...(sceneUrl ? { sceneUrl } : {}),
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
  artifactDelivery?: ArtifactDelivery;
  ok: boolean;
  result?: unknown;
  error?: string;
  logs?: string[];
}> {
  try {
    const parsed = ExecuteRequestSchema.parse(input);
    const runtime = createStudioCodeModeRuntime(env, {
      ...(options.origin ? { origin: options.origin } : {}),
    });
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

    const artifactDelivery = artifactDeliveryFrom(execution.result);

    if (execution.error) {
      return {
        ...(artifactDelivery ? { artifactDelivery } : {}),
        ok: false,
        error: execution.error,
        logs: execution.logs ?? [],
        result: execution.result,
      };
    }

    return {
      ...(artifactDelivery ? { artifactDelivery } : {}),
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
      outputSchema: CodeModeDocsResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    (input) => jsonResult(getCodeModeDocs(input)),
  );

  server.registerTool(
    "search",
    {
      title: "Search Sketchi Code Mode docs",
      description:
        "Search Sketchi Code Mode operations, schemas, examples, non-goals, and repair hints.",
      inputSchema: CodeModeSearchRequestSchema,
      outputSchema: CodeModeSearchResultSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    (input) => jsonResult(searchCodeModeDocs(input)),
  );

  server.registerTool(
    "execute",
    {
      title: "Execute Sketchi Code Mode",
      description: [
        "Run an async JavaScript arrow function for an external agent harness.",
        "Write JavaScript only: no TypeScript syntax, annotations, interfaces, generics, imports, or named wrapper functions.",
        "Use the canonical shape: async () => { const result = await sketchi.buildFlowchart(...); return result; }",
        "Code fences and trailing expression semicolons are normalized before execution.",
        "The sandbox exposes only sketchi.buildFlowchart, sketchi.getArtifact, and sketchi.applyDiagramPatch.",
        "First get the semantic graph accepted, then use patch operations for deterministic visual changes.",
        "For final user-facing output, return accepted Sketchi artifact ids, format refs, and Excalidraw/PNG URLs. Do not recreate accepted diagrams as Markdown or Mermaid artifacts.",
        "When execute returns artifactDelivery, that object is the recommended final response payload for external harnesses.",
        "",
        SKETCHI_CODE_MODE_TYPES,
      ].join("\n"),
      inputSchema: ExecuteRequestSchema,
      outputSchema: ExecuteResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      jsonResult(await executeSketchiCodeMode(env, input, options)),
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
  const handler = createMcpHandler(
    createSketchiMcpServer(env, {
      ...options,
      origin: new URL(request.url).origin,
    }),
    {
      route: "/mcp",
    },
  ) as McpHttpHandler;

  return handler(request, env, createExecutionContext());
}
