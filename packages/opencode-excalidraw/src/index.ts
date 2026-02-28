import { type Plugin, tool } from "@opencode-ai/plugin";

import { applySketchiDiagramAgentConfig } from "./lib/agent-config";
import {
  appendSketchiDiagramSystemPrompt,
  shouldInjectSketchiDiagramSystemHints,
} from "./lib/agent-hints";
import { fetchJson, shareElements } from "./lib/api";
import { extractShareLink, readExcalidrawFile } from "./lib/excalidraw";
import { gradeDiagram } from "./lib/grade";
import { buildDefaultPngPath, resolveOutputPath, writePng } from "./lib/output";
import { closeBrowser, renderElementsToPng } from "./lib/render";
import { resolveExcalidrawFromShareUrl } from "./lib/resolve-share-url";
import { createToolTraceId } from "./lib/trace";

const DEFAULT_API_BASE = "https://sketchi.app";
const DEFAULT_OAUTH_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEVICE_FLOW_POLLING_SAFETY_MARGIN_MS = 1000;
const TRAILING_SLASH_PATTERN = /\/$/;
const GRADE_CALL_STATE_LIMIT = 2048;
const SKETCHI_SESSION_CACHE_LIMIT = 2048;
const DEFAULT_THREAD_RUN_TIMEOUT_MS = 180_000;
const SKIP_PNG_RENDER = process.env.SKETCHI_SKIP_PNG_RENDER === "1";
const gradeCallStateByMessage = new Map<string, "running" | "completed">();
const sketchiSessionByOpenCodeSession = new Map<string, string>();

type RunStatus =
  | "sending"
  | "running"
  | "applying"
  | "persisted"
  | "stopped"
  | "error";

interface ThreadRunResponse {
  appState?: Record<string, unknown>;
  assistantMessage: string | null;
  elapsedMs: number;
  elements?: Record<string, unknown>[];
  latestSceneVersion: number | null;
  promptMessageId: string;
  reasoningSummary: string | null;
  runError: string | null;
  runStatus: RunStatus;
  sessionId: string;
  shareLink?: { url: string; shareId: string; encryptionKey: string };
  status: "persisted" | "error" | "stopped" | "timeout";
  threadId: string | null;
  traceId: string;
}

interface SessionSeedResponse {
  latestSceneVersion: number;
  savedAt?: number;
  sessionId: string;
  status: "success" | "conflict";
  threadId: string | null;
  traceId: string;
}

interface ExcalidrawSceneSeed {
  appState: Record<string, unknown>;
  elements: Record<string, unknown>[];
}

function toBearerHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed;
  }

  return `Bearer ${trimmed}`;
}

function resolveAuthorizationHeaderFromAuth(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") {
    return null;
  }

  const value = auth as {
    type?: unknown;
    access?: unknown;
    refresh?: unknown;
  };

  if (value.type === "oauth") {
    if (typeof value.access === "string") {
      const header = toBearerHeaderValue(value.access);
      if (header) {
        return header;
      }
    }
    if (typeof value.refresh === "string") {
      const header = toBearerHeaderValue(value.refresh);
      if (header) {
        return header;
      }
    }
  }

  return null;
}

function createRequestHeaders(input: {
  traceId: string;
  authorizationHeader: string | null;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-trace-id": input.traceId,
    ...(input.authorizationHeader
      ? { Authorization: input.authorizationHeader }
      : {}),
  };
}

function gradeCallKey(sessionID: string, messageID?: string): string {
  return `${sessionID}:${messageID ?? "unknown"}`;
}

function reserveGradeCall(key: string): void {
  if (gradeCallStateByMessage.has(key)) {
    throw new Error(
      "diagram_grade allows only one image per message. Start a new message for each additional diagram_grade call."
    );
  }

  while (gradeCallStateByMessage.size >= GRADE_CALL_STATE_LIMIT) {
    const oldestKey = gradeCallStateByMessage.keys().next().value;
    if (!oldestKey) {
      break;
    }
    gradeCallStateByMessage.delete(oldestKey);
  }

  gradeCallStateByMessage.set(key, "running");
}

function completeGradeCall(key: string): void {
  if (gradeCallStateByMessage.get(key) === "running") {
    gradeCallStateByMessage.set(key, "completed");
  }
}

function normalizeApiBase(value: string): string {
  return value.replace(TRAILING_SLASH_PATTERN, "");
}

function extractMessageText(
  parts: Array<{ type: string; text?: string }>
): string {
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      textParts.push(part.text);
    }
  }
  return textParts.join("\n");
}

function normalizeIdentifierPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) {
    return "unknown";
  }
  return normalized.slice(0, 20);
}

function hashPromptForId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 4_294_967_295;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

function buildPromptMessageId(input: {
  messageID?: string;
  prompt: string;
  sessionID: string;
  toolName: "from" | "tweak" | "restructure";
}): string {
  const sessionPart = normalizeIdentifierPart(input.sessionID);
  const messagePart = normalizeIdentifierPart(input.messageID ?? "unknown");
  const promptHash = hashPromptForId(input.prompt);
  return `prompt_${input.toolName}_${sessionPart}_${messagePart}_${promptHash}`;
}

function cacheSketchiSession(
  opencodeSessionID: string,
  sketchiSessionID: string
): void {
  while (sketchiSessionByOpenCodeSession.size >= SKETCHI_SESSION_CACHE_LIMIT) {
    const oldestKey = sketchiSessionByOpenCodeSession.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sketchiSessionByOpenCodeSession.delete(oldestKey);
  }

  sketchiSessionByOpenCodeSession.set(opencodeSessionID, sketchiSessionID);
}

function resolveSessionCandidate(input: {
  explicitSessionId?: string;
  opencodeSessionID: string;
}): string | undefined {
  if (input.explicitSessionId) {
    return input.explicitSessionId;
  }
  return sketchiSessionByOpenCodeSession.get(input.opencodeSessionID);
}

function createStudioUrl(apiBase: string, sessionId: string): string {
  return `${apiBase}/diagrams/${sessionId}`;
}

async function runThreadPrompt(input: {
  abort?: AbortSignal;
  apiBase: string;
  authorizationHeader: string | null;
  pollIntervalMs?: number;
  prompt: string;
  promptMessageId: string;
  sessionId?: string;
  timeoutMs?: number;
  traceId: string;
}): Promise<ThreadRunResponse> {
  const runTimeoutMs = input.timeoutMs ?? DEFAULT_THREAD_RUN_TIMEOUT_MS;
  const requestTimeoutMs = Math.max(runTimeoutMs + 15_000, 90_000);

  return await fetchJson<ThreadRunResponse>(
    `${input.apiBase}/api/diagrams/thread-run`,
    {
      method: "POST",
      headers: createRequestHeaders({
        traceId: input.traceId,
        authorizationHeader: input.authorizationHeader,
      }),
      body: JSON.stringify({
        prompt: input.prompt,
        sessionId: input.sessionId,
        promptMessageId: input.promptMessageId,
        timeoutMs: input.timeoutMs,
        pollIntervalMs: input.pollIntervalMs,
        traceId: input.traceId,
      }),
    },
    input.abort,
    requestTimeoutMs
  );
}

async function seedSessionFromScene(input: {
  abort?: AbortSignal;
  apiBase: string;
  authorizationHeader: string | null;
  scene: ExcalidrawSceneSeed;
  sessionId?: string;
  traceId: string;
}): Promise<SessionSeedResponse> {
  return await fetchJson<SessionSeedResponse>(
    `${input.apiBase}/api/diagrams/session-seed`,
    {
      method: "POST",
      headers: createRequestHeaders({
        traceId: input.traceId,
        authorizationHeader: input.authorizationHeader,
      }),
      body: JSON.stringify({
        sessionId: input.sessionId,
        elements: input.scene.elements,
        appState: input.scene.appState,
        traceId: input.traceId,
      }),
    },
    input.abort
  );
}

async function resolveSceneSeed(input: {
  abort?: AbortSignal;
  apiBase: string;
  authorizationHeader: string | null;
  directory: string;
  excalidraw?: {
    elements: Record<string, unknown>[];
    appState?: Record<string, unknown>;
  };
  excalidrawPath?: string;
  shareUrl?: string;
  traceId: string;
}): Promise<ExcalidrawSceneSeed | null> {
  if (input.excalidraw) {
    return {
      elements: input.excalidraw.elements,
      appState: input.excalidraw.appState ?? {},
    };
  }

  if (input.excalidrawPath) {
    const parsed = await readExcalidrawFile(
      input.excalidrawPath,
      input.directory
    );
    return {
      elements: parsed.elements,
      appState: parsed.appState ?? {},
    };
  }

  if (input.shareUrl) {
    const parsed = await resolveExcalidrawFromShareUrl({
      shareUrl: input.shareUrl,
      apiBase: input.apiBase,
      traceId: input.traceId,
      authorizationHeader: input.authorizationHeader,
      abort: input.abort,
    });
    return {
      elements: parsed.elements,
      appState: parsed.appState ?? {},
    };
  }

  return null;
}

interface DeviceStartResponse {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUrl: string;
}

type DeviceTokenResponse =
  | {
      status: "authorization_pending";
      interval: number;
    }
  | {
      status: "slow_down";
      interval: number;
    }
  | {
      status: "success";
      accessToken: string;
      accessTokenExpiresAt?: number;
    }
  | {
      status: "expired_token" | "invalid_grant";
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const SketchiPlugin: Plugin = (input) => {
  const apiBase = normalizeApiBase(
    process.env.SKETCHI_API_URL ?? DEFAULT_API_BASE
  );
  const envAuthorizationHeader =
    toBearerHeaderValue(process.env.SKETCHI_ACCESS_TOKEN ?? "") ||
    toBearerHeaderValue(process.env.SKETCHI_BEARER_TOKEN ?? "") ||
    null;

  let getAuthorizationHeader = async () => envAuthorizationHeader;

  return Promise.resolve({
    tool: {
      diagram_from_prompt: tool({
        description:
          "Generate or continue an Excalidraw diagram from a prompt with durable Sketchi session/thread continuity, returning share link + local PNG. Prefer this over Mermaid text when diagram tools are available.",
        args: {
          prompt: tool.schema.string().describe("What to diagram"),
          sessionId: tool.schema
            .string()
            .optional()
            .describe(
              "Optional existing Sketchi diagram session ID to continue"
            ),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const authorizationHeader = await getAuthorizationHeader();

          const promptMessageId = buildPromptMessageId({
            toolName: "from",
            sessionID: context.sessionID,
            messageID: context.messageID,
            prompt: args.prompt,
          });

          const sessionCandidate = resolveSessionCandidate({
            explicitSessionId: args.sessionId,
            opencodeSessionID: context.sessionID,
          });

          const runResult = await runThreadPrompt({
            apiBase,
            authorizationHeader,
            traceId,
            sessionId: sessionCandidate,
            prompt: args.prompt,
            promptMessageId,
            abort: context.abort,
            timeoutMs: DEFAULT_THREAD_RUN_TIMEOUT_MS,
          });

          if (runResult.status !== "persisted") {
            throw new Error(
              runResult.runError ??
                `Diagram run ended with ${runResult.status} (${runResult.runStatus}).`
            );
          }

          if (!runResult.shareLink?.url) {
            throw new Error("Missing shareLink in thread-run response.");
          }

          cacheSketchiSession(context.sessionID, runResult.sessionId);

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-generate", context.directory);

          try {
            if (SKIP_PNG_RENDER) {
              return JSON.stringify(
                {
                  sessionId: runResult.sessionId,
                  threadId: runResult.threadId,
                  studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                  promptMessageId: runResult.promptMessageId,
                  assistantMessage: runResult.assistantMessage,
                  reasoningSummary: runResult.reasoningSummary,
                  shareLink: runResult.shareLink,
                  pngSkipped: true,
                  stats: {
                    traceId: runResult.traceId,
                    runStatus: runResult.runStatus,
                    elapsedMs: runResult.elapsedMs,
                    latestSceneVersion: runResult.latestSceneVersion,
                  },
                },
                null,
                2
              );
            }

            const elements = runResult.elements?.length
              ? runResult.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: runResult.shareLink.url,
                    apiBase,
                    traceId,
                    authorizationHeader,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                sessionId: runResult.sessionId,
                threadId: runResult.threadId,
                studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                promptMessageId: runResult.promptMessageId,
                assistantMessage: runResult.assistantMessage,
                reasoningSummary: runResult.reasoningSummary,
                shareLink: runResult.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: {
                  traceId: runResult.traceId,
                  runStatus: runResult.runStatus,
                  elapsedMs: runResult.elapsedMs,
                  latestSceneVersion: runResult.latestSceneVersion,
                },
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_tweak: tool({
        description:
          "Apply a tactical tweak to a durable Sketchi session/thread (text/colors/minor edits) and return share link + local PNG. Prefer this over Mermaid rewrites for small edits.",
        args: {
          sessionId: tool.schema
            .string()
            .optional()
            .describe(
              "Optional existing Sketchi diagram session ID to continue"
            ),
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to tweak"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          request: tool.schema.string().describe("Tweak request to apply"),
          options: tool.schema
            .object({
              maxSteps: tool.schema.number().optional(),
              timeoutMs: tool.schema.number().optional(),
              preferExplicitEdits: tool.schema.boolean().optional(),
            })
            .optional()
            .describe("Optional tweak options (server-side)"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const serverTimeoutMs = args.options?.timeoutMs ?? 60_000;
          const traceId = createToolTraceId();
          const authorizationHeader = await getAuthorizationHeader();
          const promptMessageId = buildPromptMessageId({
            toolName: "tweak",
            sessionID: context.sessionID,
            messageID: context.messageID,
            prompt: args.request,
          });

          let workingSessionId = resolveSessionCandidate({
            explicitSessionId: args.sessionId,
            opencodeSessionID: context.sessionID,
          });

          const sceneSeed = await resolveSceneSeed({
            apiBase,
            authorizationHeader,
            traceId,
            shareUrl: args.shareUrl,
            excalidraw: args.excalidraw,
            excalidrawPath: args.excalidrawPath,
            directory: context.directory,
            abort: context.abort,
          });

          if (sceneSeed) {
            const seeded = await seedSessionFromScene({
              apiBase,
              authorizationHeader,
              traceId,
              sessionId: workingSessionId,
              scene: sceneSeed,
              abort: context.abort,
            });
            workingSessionId = seeded.sessionId;
          }

          if (!workingSessionId) {
            throw new Error(
              "Provide sessionId, shareUrl, or excalidraw input."
            );
          }

          const runResult = await runThreadPrompt({
            apiBase,
            authorizationHeader,
            traceId,
            sessionId: workingSessionId,
            prompt: `Tactical tweak request:\\n${args.request}`,
            promptMessageId,
            abort: context.abort,
            timeoutMs: Math.max(serverTimeoutMs, DEFAULT_THREAD_RUN_TIMEOUT_MS),
          });

          if (runResult.status !== "persisted") {
            throw new Error(
              runResult.runError ??
                `Diagram tweak ended with ${runResult.status} (${runResult.runStatus}).`
            );
          }

          if (!runResult.shareLink?.url) {
            throw new Error("Missing shareLink in tweak response.");
          }

          cacheSketchiSession(context.sessionID, runResult.sessionId);

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-tweak", context.directory);

          try {
            if (SKIP_PNG_RENDER) {
              return JSON.stringify(
                {
                  sessionId: runResult.sessionId,
                  threadId: runResult.threadId,
                  studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                  promptMessageId: runResult.promptMessageId,
                  assistantMessage: runResult.assistantMessage,
                  reasoningSummary: runResult.reasoningSummary,
                  shareLink: runResult.shareLink,
                  pngSkipped: true,
                  stats: {
                    traceId: runResult.traceId,
                    runStatus: runResult.runStatus,
                    elapsedMs: runResult.elapsedMs,
                    latestSceneVersion: runResult.latestSceneVersion,
                  },
                },
                null,
                2
              );
            }

            const elements = runResult.elements?.length
              ? runResult.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: runResult.shareLink.url,
                    apiBase,
                    traceId,
                    authorizationHeader,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                sessionId: runResult.sessionId,
                threadId: runResult.threadId,
                studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                promptMessageId: runResult.promptMessageId,
                assistantMessage: runResult.assistantMessage,
                reasoningSummary: runResult.reasoningSummary,
                shareLink: runResult.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: {
                  traceId: runResult.traceId,
                  runStatus: runResult.runStatus,
                  elapsedMs: runResult.elapsedMs,
                  latestSceneVersion: runResult.latestSceneVersion,
                },
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_restructure: tool({
        description:
          "Restructure a durable Sketchi session/thread for structural edits and return share link + local PNG.",
        args: {
          sessionId: tool.schema
            .string()
            .optional()
            .describe(
              "Optional existing Sketchi diagram session ID to continue"
            ),
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to restructure"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          prompt: tool.schema
            .string()
            .describe("Structural request (what the new diagram should be)"),
          options: tool.schema
            .object({
              profileId: tool.schema.string().optional(),
              timeoutMs: tool.schema.number().optional(),
              maxSteps: tool.schema.number().optional(),
            })
            .optional()
            .describe("Optional restructure options (client + server)"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const serverTimeoutMs = args.options?.timeoutMs ?? 240_000;
          const traceId = createToolTraceId();
          const authorizationHeader = await getAuthorizationHeader();
          const promptMessageId = buildPromptMessageId({
            toolName: "restructure",
            sessionID: context.sessionID,
            messageID: context.messageID,
            prompt: args.prompt,
          });

          let workingSessionId = resolveSessionCandidate({
            explicitSessionId: args.sessionId,
            opencodeSessionID: context.sessionID,
          });

          const sceneSeed = await resolveSceneSeed({
            apiBase,
            authorizationHeader,
            traceId,
            shareUrl: args.shareUrl,
            excalidraw: args.excalidraw,
            excalidrawPath: args.excalidrawPath,
            directory: context.directory,
            abort: context.abort,
          });

          if (sceneSeed) {
            const seeded = await seedSessionFromScene({
              apiBase,
              authorizationHeader,
              traceId,
              sessionId: workingSessionId,
              scene: sceneSeed,
              abort: context.abort,
            });
            workingSessionId = seeded.sessionId;
          }

          if (!workingSessionId) {
            throw new Error(
              "Provide sessionId, shareUrl, or excalidraw input."
            );
          }

          const runResult = await runThreadPrompt({
            apiBase,
            authorizationHeader,
            traceId,
            sessionId: workingSessionId,
            prompt: `Structural restructure request:\\n${args.prompt}`,
            promptMessageId,
            abort: context.abort,
            timeoutMs: Math.max(serverTimeoutMs, DEFAULT_THREAD_RUN_TIMEOUT_MS),
          });

          if (runResult.status !== "persisted") {
            throw new Error(
              runResult.runError ??
                `Diagram restructure ended with ${runResult.status} (${runResult.runStatus}).`
            );
          }

          if (!runResult.shareLink?.url) {
            throw new Error("Missing shareLink in restructure response.");
          }

          cacheSketchiSession(context.sessionID, runResult.sessionId);

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-restructure", context.directory);

          try {
            if (SKIP_PNG_RENDER) {
              return JSON.stringify(
                {
                  sessionId: runResult.sessionId,
                  threadId: runResult.threadId,
                  studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                  promptMessageId: runResult.promptMessageId,
                  assistantMessage: runResult.assistantMessage,
                  reasoningSummary: runResult.reasoningSummary,
                  shareLink: runResult.shareLink,
                  pngSkipped: true,
                  stats: {
                    traceId: runResult.traceId,
                    runStatus: runResult.runStatus,
                    elapsedMs: runResult.elapsedMs,
                    latestSceneVersion: runResult.latestSceneVersion,
                  },
                },
                null,
                2
              );
            }

            const elements = runResult.elements?.length
              ? runResult.elements
              : (
                  await resolveExcalidrawFromShareUrl({
                    shareUrl: runResult.shareLink.url,
                    apiBase,
                    traceId,
                    authorizationHeader,
                    abort: context.abort,
                  })
                ).elements;
            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                sessionId: runResult.sessionId,
                threadId: runResult.threadId,
                studioUrl: createStudioUrl(apiBase, runResult.sessionId),
                promptMessageId: runResult.promptMessageId,
                assistantMessage: runResult.assistantMessage,
                reasoningSummary: runResult.reasoningSummary,
                shareLink: runResult.shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
                stats: {
                  traceId: runResult.traceId,
                  runStatus: runResult.runStatus,
                  elapsedMs: runResult.elapsedMs,
                  latestSceneVersion: runResult.latestSceneVersion,
                },
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_to_png: tool({
        description:
          "Render a PNG locally from an Excalidraw share link or file. Use this for diagram exports instead of code-block diagrams.",
        args: {
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to render"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional PNG output path"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const authorizationHeader = await getAuthorizationHeader();
          const excalidraw =
            args.excalidraw ??
            (args.excalidrawPath
              ? await readExcalidrawFile(args.excalidrawPath, context.directory)
              : undefined);

          if (!(args.shareUrl || excalidraw)) {
            throw new Error("Provide shareUrl or excalidraw input");
          }

          const outputPath = args.outputPath
            ? resolveOutputPath(args.outputPath, context.directory)
            : buildDefaultPngPath("diagram-to-png", context.directory);

          try {
            let shareLink:
              | { url: string; shareId?: string; encryptionKey?: string }
              | undefined;
            let elements: Record<string, unknown>[] = [];

            if (args.shareUrl) {
              shareLink = extractShareLink(args.shareUrl);
              const resolved = await resolveExcalidrawFromShareUrl({
                shareUrl: args.shareUrl,
                apiBase,
                traceId,
                authorizationHeader,
                abort: context.abort,
              });
              elements = resolved.elements;
            } else if (excalidraw) {
              const shared = await shareElements(
                apiBase,
                {
                  elements: excalidraw.elements,
                  appState: excalidraw.appState,
                },
                context.abort,
                undefined,
                traceId,
                authorizationHeader
              );
              shareLink = shared;
              elements = excalidraw.elements;
            }

            if (SKIP_PNG_RENDER) {
              return JSON.stringify(
                {
                  shareLink,
                  pngSkipped: true,
                },
                null,
                2
              );
            }

            const pngResult = await renderElementsToPng(elements, {
              scale: args.scale,
              padding: args.padding,
              background: args.background,
            });

            const pngPath = await writePng(outputPath, pngResult.png);

            return JSON.stringify(
              {
                shareLink,
                pngPath,
                pngBytes: pngResult.png.length,
                pngDurationMs: pngResult.durationMs,
              },
              null,
              2
            );
          } finally {
            await closeBrowser();
          }
        },
      }),
      diagram_grade: tool({
        description:
          "Grade an Excalidraw diagram for type, layout, directionality, visual quality, accuracy, and completeness.",
        args: {
          prompt: tool.schema
            .string()
            .describe("Original prompt or requirement for the diagram"),
          expectedDiagramType: tool.schema
            .string()
            .optional()
            .describe("Expected diagram type (optional)"),
          shareUrl: tool.schema
            .string()
            .optional()
            .describe("Excalidraw share URL to grade"),
          excalidrawPath: tool.schema
            .string()
            .optional()
            .describe("Path to .excalidraw JSON file"),
          excalidraw: tool.schema
            .object({
              elements: tool.schema.array(tool.schema.any()),
              appState: tool.schema.object({}).passthrough().optional(),
            })
            .optional()
            .describe("Excalidraw JSON blob"),
          pngPath: tool.schema
            .string()
            .optional()
            .describe("Optional existing PNG path to grade"),
          outputPath: tool.schema
            .string()
            .optional()
            .describe("Optional path to write PNG (if generated)"),
          scale: tool.schema
            .number()
            .optional()
            .describe("PNG export scale factor"),
          padding: tool.schema
            .number()
            .optional()
            .describe("PNG export padding in pixels"),
          background: tool.schema
            .boolean()
            .optional()
            .describe("Include white background in PNG"),
        },
        async execute(args, context) {
          const traceId = createToolTraceId();
          const callKey = gradeCallKey(context.sessionID, context.messageID);
          reserveGradeCall(callKey);

          const excalidraw = args.excalidraw
            ? {
                elements: args.excalidraw.elements,
                appState: args.excalidraw.appState ?? {},
              }
            : undefined;

          try {
            const result = await gradeDiagram(
              input.client,
              {
                sessionID: context.sessionID,
                agent: context.agent,
                messageID: context.messageID,
              },
              {
                prompt: args.prompt,
                expectedDiagramType: args.expectedDiagramType,
                shareUrl: args.shareUrl,
                excalidrawPath: args.excalidrawPath,
                excalidraw,
                pngPath: args.pngPath,
                outputPath: args.outputPath,
                renderOptions: {
                  scale: args.scale,
                  padding: args.padding,
                  background: args.background,
                },
                apiBase,
                baseDir: context.directory,
                abort: context.abort,
                traceId,
              }
            );

            return JSON.stringify(result, null, 2);
          } finally {
            completeGradeCall(callKey);
          }
        },
      }),
    },
    auth: {
      provider: "sketchi",
      loader(getAuth) {
        getAuthorizationHeader = async () => {
          const auth = await getAuth();
          return (
            resolveAuthorizationHeaderFromAuth(auth) ?? envAuthorizationHeader
          );
        };
        return Promise.resolve({});
      },
      methods: [
        {
          type: "oauth",
          label: "Sign in with Sketchi (device flow)",
          async authorize() {
            const started = await fetchJson<DeviceStartResponse>(
              `${apiBase}/api/auth/device/start`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({}),
              }
            );

            const startedAt = Date.now();
            const expiresAt = startedAt + Math.max(1, started.expiresIn) * 1000;
            const defaultIntervalMs = Math.max(1, started.interval) * 1000;

            return {
              method: "auto" as const,
              url: started.verificationUrl,
              instructions: `Enter code: ${started.userCode}`,
              callback: async () => {
                let intervalMs = defaultIntervalMs;

                while (Date.now() < expiresAt) {
                  await sleep(
                    intervalMs + DEVICE_FLOW_POLLING_SAFETY_MARGIN_MS
                  );

                  const pollResult = await fetchJson<DeviceTokenResponse>(
                    `${apiBase}/api/auth/device/token`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        deviceCode: started.deviceCode,
                      }),
                    }
                  ).catch(() => ({ status: "invalid_grant" as const }));

                  if (pollResult.status === "authorization_pending") {
                    continue;
                  }

                  if (pollResult.status === "slow_down") {
                    intervalMs = Math.max(
                      intervalMs + 5000,
                      Math.max(1, pollResult.interval) * 1000
                    );
                    continue;
                  }

                  if (pollResult.status !== "success") {
                    return {
                      type: "failed" as const,
                    };
                  }

                  return {
                    type: "success" as const,
                    refresh: pollResult.accessToken,
                    access: pollResult.accessToken,
                    expires:
                      pollResult.accessTokenExpiresAt ??
                      Date.now() + DEFAULT_OAUTH_TOKEN_TTL_MS,
                    provider: "sketchi",
                  };
                }

                return {
                  type: "failed" as const,
                };
              },
            };
          },
        },
      ],
    },
    config: (config) => {
      applySketchiDiagramAgentConfig(config);
      return Promise.resolve();
    },
    "chat.message": (_input, output) => {
      const messageText = extractMessageText(
        output.parts as Array<{ type: string; text?: string }>
      );

      if (!shouldInjectSketchiDiagramSystemHints(messageText)) {
        return Promise.resolve();
      }

      output.message.system = appendSketchiDiagramSystemPrompt(
        output.message.system
      );
      return Promise.resolve();
    },
  });
};

export default SketchiPlugin;
