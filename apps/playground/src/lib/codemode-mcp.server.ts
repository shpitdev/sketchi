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
import {
  captureCodeModeUsageEvent,
  createCodeModeUsageContext,
  type CodeModeUsageContext,
} from "./codemode-usage-events.server";

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
  request?: Request;
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
  finalResponseText: z.string(),
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
  finalResponseText: z.string().optional(),
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
  finalResponseText: string;
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

function finalResponseTextFromResult(value: Record<string, unknown>) {
  return (
    stringValue(value.finalResponseText) ??
    (isRecord(value.artifactDelivery)
      ? stringValue(value.artifactDelivery.finalResponseText)
      : undefined)
  );
}

function jsonResult(
  value: Record<string, unknown>,
  options: { includeFinalResponseText?: boolean } = {},
) {
  const finalResponseText = options.includeFinalResponseText
    ? finalResponseTextFromResult(value)
    : undefined;
  return {
    content: [
      ...(finalResponseText
        ? [
            {
              type: "text" as const,
              text: finalResponseText,
            },
          ]
        : []),
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

function fallbackArtifactUrl(
  origin: string,
  input: { artifactId: string; format: string },
): string {
  const url = new URL(
    `/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`,
    origin,
  );
  url.searchParams.set("format", input.format);
  url.searchParams.set("raw", "true");
  return url.toString();
}

function artifactDeliveryResponseText(input: {
  artifactId: string;
  diagramId?: string;
  excalidrawUrl?: string;
  formats: readonly ArtifactDeliveryFormat[];
  pngUrl?: string;
}): string {
  return [
    "Sketchi artifact ready.",
    `Artifact ID: ${input.artifactId}`,
    ...(input.diagramId ? [`Diagram ID: ${input.diagramId}`] : []),
    `Formats: ${input.formats.map((formatRef) => formatRef.format).join(", ")}`,
    ...(input.excalidrawUrl ? [`Excalidraw URL: ${input.excalidrawUrl}`] : []),
    ...(input.pngUrl ? [`PNG URL: ${input.pngUrl}`] : []),
  ].join("\n");
}

function artifactDeliveryFrom(
  value: unknown,
  options: { origin?: string } = {},
): ArtifactDelivery | undefined {
  const artifact = acceptedArtifactContainerFrom(value);
  const artifactId = stringValue(artifact?.artifactId);
  if (!artifact || !artifactId) {
    return undefined;
  }

  const formats = artifactFormatsFrom(artifact.formats);
  if (formats.length === 0) {
    return undefined;
  }
  const formatsWithUrls = formats.map((formatRef) => ({
    ...formatRef,
    ...(formatRef.url || !options.origin
      ? {}
      : {
          url: fallbackArtifactUrl(options.origin, {
            artifactId,
            format: formatRef.format,
          }),
        }),
  }));
  const diagramId = stringValue(artifact.diagramId);
  const excalidrawUrl = urlForFormat(formatsWithUrls, "excalidraw");
  const pngUrl = urlForFormat(formatsWithUrls, "png");
  const sceneUrl = urlForFormat(formatsWithUrls, "scene");
  const finalResponseText = artifactDeliveryResponseText({
    artifactId,
    ...(diagramId ? { diagramId } : {}),
    ...(excalidrawUrl ? { excalidrawUrl } : {}),
    formats: formatsWithUrls,
    ...(pngUrl ? { pngUrl } : {}),
  });

  return {
    artifactId,
    ...(diagramId ? { diagramId } : {}),
    ...(excalidrawUrl ? { excalidrawUrl } : {}),
    finalResponseInstruction:
      "Paste artifactDelivery.finalResponseText as the final chat response and stop. Do not inspect nested inline JSON, call write_to_file/Create, create a Markdown wrapper, create a Mermaid diagram, create a local file, or create a separate Antigravity artifact after Sketchi accepts the diagram.",
    finalResponseText,
    formats: formatsWithUrls,
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
  finalResponseText?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  logs?: string[];
}> {
  const usageContext = options.request
    ? createCodeModeUsageContext(options.request)
    : undefined;
  const startedAt = Date.now();

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
            buildMindmap: (request) => runtime.buildMindmap(request),
            getArtifact: (request) => runtime.getArtifact(request),
            applyDiagramPatch: (request) => runtime.applyDiagramPatch(request),
          },
        },
      ],
    );

    const artifactDelivery = artifactDeliveryFrom(execution.result, {
      ...(options.origin ? { origin: options.origin } : {}),
    });

    if (execution.error) {
      const output = {
        ...(artifactDelivery ? { artifactDelivery } : {}),
        ...(artifactDelivery
          ? { finalResponseText: artifactDelivery.finalResponseText }
          : {}),
        ok: false,
        error: execution.error,
        logs: execution.logs ?? [],
        result: execution.result,
      };
      captureMcpExecuteUsage(env, {
        context: usageContext,
        input,
        options,
        responseBody: output,
        startedAt,
      });
      return output;
    }

    const output = {
      ...(artifactDelivery ? { artifactDelivery } : {}),
      ...(artifactDelivery
        ? { finalResponseText: artifactDelivery.finalResponseText }
        : {}),
      ok: true,
      result: execution.result,
      logs: execution.logs ?? [],
    };
    captureMcpExecuteUsage(env, {
      context: usageContext,
      input,
      options,
      responseBody: output,
      startedAt,
    });
    return output;
  } catch (error) {
    const output = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      logs: [],
    };
    captureMcpExecuteUsage(env, {
      context: usageContext,
      input,
      options,
      responseBody: output,
      startedAt,
    });
    return output;
  }
}

function captureMcpExecuteUsage(
  env: StudioEnv,
  input: {
    context: CodeModeUsageContext | undefined;
    input: unknown;
    options: CodeModeMcpOptions;
    responseBody: unknown;
    startedAt: number;
  },
): void {
  if (!input.context || !input.options.request) {
    return;
  }

  captureCodeModeUsageEvent({
    context: input.context,
    durationMs: Date.now() - input.startedAt,
    env,
    operation: "execute",
    request: input.options.request,
    requestBody: input.input,
    responseBody: input.responseBody,
    surface: "mcp",
  });
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
        "The sandbox exposes sketchi.buildFlowchart, sketchi.buildMindmap, sketchi.getArtifact, and sketchi.applyDiagramPatch.",
        "First get the semantic graph accepted, then use patch operations for deterministic visual changes.",
        "For final user-facing output, return accepted Sketchi artifact ids, format refs, and Excalidraw/PNG URLs. Do not recreate accepted diagrams as Markdown or Mermaid artifacts.",
        "When artifactDelivery is available, the first text content block is the final user-facing answer; copy it verbatim and stop.",
        "When execute returns artifactDelivery, paste artifactDelivery.finalResponseText as the final chat response and stop.",
        "Do not call write_to_file/Create, create an Antigravity artifact, or inspect nested inline JSON after artifactDelivery is present.",
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
      jsonResult(await executeSketchiCodeMode(env, input, options), {
        includeFinalResponseText: true,
      }),
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
      request,
    }),
    {
      route: "/mcp",
    },
  ) as McpHttpHandler;

  return handler(request, env, createExecutionContext());
}
