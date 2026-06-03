import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DiagramAgentToolName } from "@sketchi/diagram-agent-tools";
import {
  type DiagramPngExportInput,
  type DiagramPngExportResult,
  exportDiagramToPng,
  type RenderOptions,
} from "@sketchi/diagram-exporter";

import type { SketchiMcpToolCall } from "./mcp-server.js";

const DEFAULT_API_BASE = "https://www.sketchi.app";
const DEFAULT_THREAD_RUN_TIMEOUT_MS = 180_000;
const TRAILING_SLASH_PATTERN = /\/$/u;

type FetchLike = typeof fetch;
type ExportDiagramToPng = (
  input: DiagramPngExportInput
) => Promise<DiagramPngExportResult>;

interface ThreadRunResponse extends Record<string, unknown> {
  runError: string | null;
  runStatus: string;
  sessionId: string;
  shareLink?: { url: string; shareId: string; encryptionKey: string };
  status: "persisted" | "error" | "stopped" | "timeout";
}

interface SessionSeedResponse extends Record<string, unknown> {
  sessionId: string;
  status: "success" | "conflict";
}

interface ExcalidrawSceneInput {
  appState?: Record<string, unknown>;
  elements: Record<string, unknown>[];
  files?: Record<string, unknown> | undefined;
}

export interface SketchiHttpExecutorOptions {
  allowUnsafeOutputPath?: boolean;
  apiBase?: string;
  authorizationToken?: string;
  baseDir?: string;
  exportDiagramToPng?: ExportDiagramToPng;
  fetch?: FetchLike;
  skipPngRender?: boolean;
  traceIdFactory?: () => string;
}

interface SketchiHttpExecutorRuntime {
  allowUnsafeOutputPath: boolean;
  apiBase: string;
  authorizationHeader: string | null;
  baseDir: string;
  exportDiagramToPngImpl: ExportDiagramToPng;
  fetchImpl: FetchLike;
  skipPngRender: boolean;
  traceIdFactory: () => string;
}

function normalizeApiBase(value = DEFAULT_API_BASE): string {
  const withoutTrailingSlash = value.trim().replace(TRAILING_SLASH_PATTERN, "");

  try {
    const parsed = new URL(withoutTrailingSlash);
    if (parsed.hostname === "sketchi.app") {
      parsed.hostname = "www.sketchi.app";
    }
    return parsed.toString().replace(TRAILING_SLASH_PATTERN, "");
  } catch {
    return withoutTrailingSlash;
  }
}

function toBearerHeaderValue(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed
    : `Bearer ${trimmed}`;
}

function requireString(
  args: Record<string, unknown>,
  key: string,
  toolName: DiagramAgentToolName
): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} requires a non-empty '${key}' argument.`);
  }
  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string
): number | undefined {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asExcalidrawScene(value: unknown): ExcalidrawSceneInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const scene = value as {
    appState?: unknown;
    elements?: unknown;
    files?: unknown;
  };

  if (!Array.isArray(scene.elements)) {
    return undefined;
  }

  return {
    elements: scene.elements as Record<string, unknown>[],
    appState:
      scene.appState && typeof scene.appState === "object"
        ? (scene.appState as Record<string, unknown>)
        : {},
    files:
      scene.files && typeof scene.files === "object"
        ? (scene.files as Record<string, unknown>)
        : undefined,
  };
}

function createTraceId(): string {
  return `sketchi-mcp-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function isEnabledEnvFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = 60_000
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${text}`);
    }
    if (!text) {
      throw new Error("Empty response body");
    }

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function createJsonHeaders(input: {
  authorizationHeader: string | null;
  traceId: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-trace-id": input.traceId,
    ...(input.authorizationHeader
      ? { Authorization: input.authorizationHeader }
      : {}),
  };
}

function formatToolResult(result: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function formatToolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function buildRenderOptions(args: Record<string, unknown>): RenderOptions {
  const renderOptions: RenderOptions = {};
  const scale = optionalNumber(args, "scale");
  const padding = optionalNumber(args, "padding");
  const background = optionalBoolean(args, "background");
  const backgroundColor = optionalString(args, "backgroundColor");

  if (scale !== undefined) {
    renderOptions.scale = scale;
  }
  if (padding !== undefined) {
    renderOptions.padding = padding;
  }
  if (background !== undefined) {
    renderOptions.background = background;
  }
  if (backgroundColor !== undefined) {
    renderOptions.backgroundColor = backgroundColor;
  }

  return renderOptions;
}

function toPngExportScene(
  scene: ExcalidrawSceneInput | undefined
): DiagramPngExportInput["excalidraw"] {
  if (!scene) {
    return undefined;
  }

  return {
    elements: scene.elements,
    appState: scene.appState ?? {},
    ...(scene.files ? { files: scene.files } : {}),
  };
}

function resolveTimeoutMs(args: Record<string, unknown>): number | undefined {
  const topLevelTimeoutMs = optionalNumber(args, "timeoutMs");
  if (topLevelTimeoutMs !== undefined) {
    return topLevelTimeoutMs;
  }

  const options = args.options;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return undefined;
  }

  return optionalNumber(options as Record<string, unknown>, "timeoutMs");
}

async function executePngExportTool(input: {
  call: SketchiMcpToolCall;
  runtime: SketchiHttpExecutorRuntime;
  sessionId?: string | undefined;
  traceId: string;
}): Promise<CallToolResult> {
  try {
    const excalidraw = toPngExportScene(
      asExcalidrawScene(input.call.arguments.excalidraw)
    );
    const excalidrawPath = optionalString(
      input.call.arguments,
      "excalidrawPath"
    );
    const outputPath = optionalString(input.call.arguments, "outputPath");
    const shareUrl = optionalString(input.call.arguments, "shareUrl");
    const result = await input.runtime.exportDiagramToPngImpl({
      apiBase: input.runtime.apiBase,
      authorizationHeader: input.runtime.authorizationHeader,
      baseDir: input.runtime.baseDir,
      allowUnsafeOutputPath: input.runtime.allowUnsafeOutputPath,
      renderOptions: buildRenderOptions(input.call.arguments),
      sessionId: input.sessionId ?? input.traceId,
      skipRender: input.runtime.skipPngRender,
      traceId: input.traceId,
      ...(excalidraw ? { excalidraw } : {}),
      ...(excalidrawPath ? { excalidrawPath } : {}),
      ...(outputPath ? { outputPath } : {}),
      ...(shareUrl ? { shareUrl } : {}),
    });
    return formatToolResult(result as unknown as Record<string, unknown>);
  } catch (error) {
    return formatToolError(toErrorMessage(error));
  }
}

async function runThreadPrompt(input: {
  apiBase: string;
  authorizationHeader: string | null;
  fetchImpl: FetchLike;
  prompt: string;
  sessionId?: string | undefined;
  timeoutMs?: number | undefined;
  traceId: string;
}): Promise<ThreadRunResponse> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_THREAD_RUN_TIMEOUT_MS;

  return await fetchJson<ThreadRunResponse>(
    input.fetchImpl,
    `${input.apiBase}/api/diagrams/thread-run`,
    {
      method: "POST",
      headers: createJsonHeaders(input),
      body: JSON.stringify({
        prompt: input.prompt,
        sessionId: input.sessionId,
        timeoutMs,
        traceId: input.traceId,
      }),
    },
    Math.max(timeoutMs + 15_000, 90_000)
  );
}

async function seedSessionFromScene(input: {
  apiBase: string;
  authorizationHeader: string | null;
  fetchImpl: FetchLike;
  scene: ExcalidrawSceneInput;
  sessionId?: string | undefined;
  traceId: string;
}): Promise<SessionSeedResponse> {
  return await fetchJson<SessionSeedResponse>(
    input.fetchImpl,
    `${input.apiBase}/api/diagrams/session-seed`,
    {
      method: "POST",
      headers: createJsonHeaders(input),
      body: JSON.stringify({
        sessionId: input.sessionId,
        elements: input.scene.elements,
        appState: input.scene.appState ?? {},
        files: input.scene.files,
        traceId: input.traceId,
      }),
    }
  );
}

async function executeThreadBackedTool(input: {
  apiBase: string;
  authorizationHeader: string | null;
  call: SketchiMcpToolCall;
  fetchImpl: FetchLike;
  prompt: string;
  scene?: ExcalidrawSceneInput | undefined;
  sessionId?: string | undefined;
  timeoutMs?: number | undefined;
  traceId: string;
}): Promise<CallToolResult> {
  let sessionId = input.sessionId;

  if (input.scene) {
    const seeded = await seedSessionFromScene({
      apiBase: input.apiBase,
      authorizationHeader: input.authorizationHeader,
      fetchImpl: input.fetchImpl,
      scene: input.scene,
      sessionId,
      traceId: input.traceId,
    });
    sessionId = seeded.sessionId;
  }

  if (
    (input.call.name === "diagram_tweak" ||
      input.call.name === "diagram_restructure") &&
    !sessionId
  ) {
    return formatToolError(
      `${input.call.name} requires sessionId or inline excalidraw scene input for the generic HTTP executor.`
    );
  }

  const result = await runThreadPrompt({
    apiBase: input.apiBase,
    authorizationHeader: input.authorizationHeader,
    fetchImpl: input.fetchImpl,
    prompt: input.prompt,
    sessionId,
    timeoutMs: input.timeoutMs,
    traceId: input.traceId,
  });

  if (result.status !== "persisted") {
    return formatToolError(
      result.runError ??
        `${input.call.name} ended with ${result.status} (${result.runStatus}).`
    );
  }

  return formatToolResult(result);
}

function createSketchiHttpExecutorRuntime(
  options: SketchiHttpExecutorOptions
): SketchiHttpExecutorRuntime {
  const apiBase = normalizeApiBase(
    options.apiBase ?? process.env.SKETCHI_API_URL
  );
  const authorizationHeader = toBearerHeaderValue(
    options.authorizationToken ??
      process.env.SKETCHI_ACCESS_TOKEN ??
      process.env.SKETCHI_BEARER_TOKEN
  );
  const fetchImpl = options.fetch ?? fetch;
  const exportDiagramToPngImpl =
    options.exportDiagramToPng ?? exportDiagramToPng;
  const traceIdFactory = options.traceIdFactory ?? createTraceId;
  const baseDir = options.baseDir ?? process.cwd();
  const allowUnsafeOutputPath =
    options.allowUnsafeOutputPath ??
    isEnabledEnvFlag(process.env.SKETCHI_ALLOW_UNSAFE_OUTPUT_PATH);
  const skipPngRender =
    options.skipPngRender ??
    isEnabledEnvFlag(process.env.SKETCHI_SKIP_PNG_RENDER);

  return {
    allowUnsafeOutputPath,
    apiBase,
    authorizationHeader,
    baseDir,
    exportDiagramToPngImpl,
    fetchImpl,
    skipPngRender,
    traceIdFactory,
  };
}

async function executeSketchiHttpTool(
  call: SketchiMcpToolCall,
  runtime: SketchiHttpExecutorRuntime
): Promise<CallToolResult> {
  const traceId = runtime.traceIdFactory();
  const sessionId = optionalString(call.arguments, "sessionId");
  const timeoutMs = resolveTimeoutMs(call.arguments);

  switch (call.name) {
    case "diagram_from_prompt": {
      const prompt = requireString(call.arguments, "prompt", call.name);
      return await executeThreadBackedTool({
        apiBase: runtime.apiBase,
        authorizationHeader: runtime.authorizationHeader,
        call,
        fetchImpl: runtime.fetchImpl,
        prompt,
        sessionId,
        timeoutMs,
        traceId,
      });
    }
    case "diagram_tweak": {
      const request = requireString(call.arguments, "request", call.name);
      return await executeThreadBackedTool({
        apiBase: runtime.apiBase,
        authorizationHeader: runtime.authorizationHeader,
        call,
        fetchImpl: runtime.fetchImpl,
        prompt: `Tactical tweak request:\n${request}`,
        scene: asExcalidrawScene(call.arguments.excalidraw),
        sessionId,
        timeoutMs,
        traceId,
      });
    }
    case "diagram_restructure": {
      const prompt = requireString(call.arguments, "prompt", call.name);
      return await executeThreadBackedTool({
        apiBase: runtime.apiBase,
        authorizationHeader: runtime.authorizationHeader,
        call,
        fetchImpl: runtime.fetchImpl,
        prompt: `Structural restructure request:\n${prompt}`,
        scene: asExcalidrawScene(call.arguments.excalidraw),
        sessionId,
        timeoutMs,
        traceId,
      });
    }
    case "diagram_to_png": {
      return await executePngExportTool({
        call,
        runtime,
        sessionId,
        traceId,
      });
    }
    case "diagram_grade":
      return formatToolError(
        "diagram_grade needs a host LLM/grading client. Use a custom SketchiMcpToolExecutor or the OpenCode plugin until the generic MCP grader is wired."
      );
    default:
      return formatToolError(`Unsupported Sketchi tool '${call.name}'.`);
  }
}

export function createSketchiHttpToolExecutor(
  options: SketchiHttpExecutorOptions = {}
): (call: SketchiMcpToolCall) => Promise<CallToolResult> {
  const runtime = createSketchiHttpExecutorRuntime(options);
  return async (call) => await executeSketchiHttpTool(call, runtime);
}
