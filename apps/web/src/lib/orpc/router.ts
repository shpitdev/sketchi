import { ORPCError, os } from "@orpc/server";
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { captureException, withScope } from "@sentry/nextjs";
import { api } from "@sketchi/backend/convex/_generated/api";
import { createTraceId, normalizeTraceId } from "@sketchi/shared";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  (() => {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL for oRPC router");
  })();

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ", 2);
  if (!(scheme && token)) {
    return null;
  }

  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface OrpcContext {
  accessToken: string | null;
  convex: ConvexHttpClient;
  traceId: string;
}

export function createOrpcContext(
  request: Request,
  options?: {
    traceIdOverride?: string;
    bearerTokenOverride?: string | null;
  }
): OrpcContext {
  const headerTraceId = normalizeTraceId(request.headers.get("x-trace-id"));
  const traceId = options?.traceIdOverride ?? headerTraceId ?? createTraceId();

  const bearerToken =
    options?.bearerTokenOverride ??
    parseBearerToken(request.headers.get("authorization"));
  const accessToken = bearerToken;

  const convex = new ConvexHttpClient(convexUrl);
  if (accessToken) {
    convex.setAuth(accessToken);
  }

  return {
    convex,
    traceId,
    accessToken,
  };
}

const orpc = os.$context<OrpcContext>();

type PublicErrorReason =
  | "UNAUTHORIZED"
  | "AI_NO_OUTPUT"
  | "AI_PROVIDER_ERROR"
  | "AI_PARSE_ERROR"
  | "AI_VALIDATION_FAILED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

function classifyError(error: unknown): {
  reason: PublicErrorReason;
  message: string;
  name?: string;
} {
  if (error instanceof Error) {
    const message = error.message;
    const name = error.name;
    const lower = message.toLowerCase();

    if (lower.includes("no output generated")) {
      return { reason: "AI_NO_OUTPUT", message, name };
    }
    if (lower.includes("unauthorized") || lower.includes("forbidden")) {
      return { reason: "UNAUTHORIZED", message, name };
    }
    if (
      lower.includes("failed to process successful response") ||
      lower.includes("invalid json") ||
      lower.includes("json parse")
    ) {
      return { reason: "AI_PARSE_ERROR", message, name };
    }
    if (lower.includes("validation failed after")) {
      return { reason: "AI_VALIDATION_FAILED", message, name };
    }
    if (
      lower.includes("provider returned error") ||
      lower.includes("openrouter") ||
      lower.includes("cloudflare") ||
      lower.includes("502") ||
      lower.includes("503") ||
      lower.includes("504") ||
      lower.includes("timeout") ||
      lower.includes("rate limit") ||
      lower.includes("429")
    ) {
      return { reason: "AI_PROVIDER_ERROR", message, name };
    }

    if (
      lower.includes("excalidraw") ||
      lower.includes("json.excalidraw.com") ||
      lower.includes("export.excalidraw.com") ||
      lower.includes("link.excalidraw.com") ||
      lower.includes("app.excalidraw.com") ||
      lower.includes("firestore.googleapis.com") ||
      lower.includes("export fetch failed") ||
      lower.includes("readonly fetch failed") ||
      lower.includes("failed to fetch")
    ) {
      return { reason: "UPSTREAM_ERROR", message, name };
    }

    return { reason: "UNKNOWN", message, name };
  }

  return { reason: "UNKNOWN", message: String(error) };
}

function throwInternalError(params: {
  traceId: string;
  stage: string;
  action: string;
  error: unknown;
  hint?: string;
}): never {
  const { reason, message, name } = classifyError(params.error);

  if (reason === "UNAUTHORIZED") {
    throw new ORPCError("UNAUTHORIZED", {
      message: `${params.action} requires authentication. traceId=${params.traceId}`,
      data: {
        traceId: params.traceId,
        stage: params.stage,
        action: params.action,
      },
    });
  }

  withScope((scope) => {
    scope.setTag("traceId", params.traceId);
    scope.setTag("orpc.route", params.action);
    scope.setTag("orpc.stage", params.stage);
    scope.setTag("orpc.reason", reason);
    scope.setContext("orpc.error", {
      traceId: params.traceId,
      stage: params.stage,
      action: params.action,
      reason,
    });
    captureException(params.error);
  });
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: `${params.action} failed (${reason}). traceId=${params.traceId}`,
    data: {
      traceId: params.traceId,
      stage: params.stage,
      action: params.action,
      reason,
      errorName: name,
      errorMessage: message.slice(0, 600),
      hint: params.hint,
    },
  });
}

const DEFAULT_THREAD_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_THREAD_RUN_POLL_INTERVAL_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createPromptMessageId(): string {
  return `prompt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function getAssistantMessageForPrompt(
  messages: Array<{
    promptMessageId: string | null;
    role: "user" | "assistant" | "tool";
    messageType: "chat" | "tool";
    content: string;
    reasoningSummary: string | null;
  }>,
  promptMessageId: string
): { content: string; reasoningSummary: string | null } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (
      message.promptMessageId === promptMessageId &&
      message.role === "assistant" &&
      message.messageType === "chat"
    ) {
      return {
        content: message.content,
        reasoningSummary: message.reasoningSummary,
      };
    }
  }
  return null;
}

function isTerminalRunStatus(
  status: "sending" | "running" | "applying" | "persisted" | "stopped" | "error"
): boolean {
  return status === "persisted" || status === "stopped" || status === "error";
}

async function ensureSessionForThreadRun(input: {
  context: OrpcContext;
  sessionId?: string;
}): Promise<{ sessionId: string; threadId: string | null }> {
  if (input.sessionId) {
    const ensured = await input.context.convex.mutation(
      api.diagramSessions.ensureThread,
      { sessionId: input.sessionId }
    );
    return {
      sessionId: input.sessionId,
      threadId: ensured.threadId,
    };
  }

  const created = await input.context.convex.mutation(
    api.diagramSessions.create,
    {}
  );
  return {
    sessionId: created.sessionId,
    threadId: created.threadId,
  };
}

async function waitForTerminalThreadRun(input: {
  context: OrpcContext;
  pollIntervalMs: number;
  promptMessageId: string;
  sessionId: string;
  timeoutMs: number;
}): Promise<{
  run: {
    status:
      | "sending"
      | "running"
      | "applying"
      | "persisted"
      | "stopped"
      | "error";
    error: string | null;
    appliedSceneVersion: number | null;
  } | null;
  timedOut: boolean;
}> {
  const deadline = Date.now() + input.timeoutMs;
  let run = await input.context.convex.query(api.diagramThreads.getRun, {
    sessionId: input.sessionId,
    promptMessageId: input.promptMessageId,
  });

  while (!(run && isTerminalRunStatus(run.status))) {
    if (Date.now() >= deadline) {
      return {
        run,
        timedOut: true,
      };
    }

    await sleep(input.pollIntervalMs);
    run = await input.context.convex.query(api.diagramThreads.getRun, {
      sessionId: input.sessionId,
      promptMessageId: input.promptMessageId,
    });
  }

  return {
    run,
    timedOut: false,
  };
}

async function executeThreadRun(input: {
  context: OrpcContext;
  pollIntervalMs: number;
  prompt: string;
  promptMessageId: string;
  sessionId?: string;
  startedAt: number;
  timeoutMs: number;
  traceId: string;
}) {
  const session = await ensureSessionForThreadRun({
    context: input.context,
    sessionId: input.sessionId,
  });
  const enqueueResult = await input.context.convex.mutation(
    api.diagramThreads.enqueuePrompt,
    {
      sessionId: session.sessionId,
      prompt: input.prompt,
      promptMessageId: input.promptMessageId,
      traceId: input.traceId,
    }
  );

  const terminal = await waitForTerminalThreadRun({
    context: input.context,
    sessionId: session.sessionId,
    promptMessageId: input.promptMessageId,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  if (terminal.timedOut) {
    return {
      status: "timeout" as const,
      sessionId: session.sessionId,
      threadId: enqueueResult.threadId,
      promptMessageId: input.promptMessageId,
      runStatus: terminal.run?.status ?? "sending",
      traceId: input.traceId,
      elapsedMs: Date.now() - input.startedAt,
      runError: terminal.run?.error ?? null,
      assistantMessage: null,
      reasoningSummary: null,
      latestSceneVersion: terminal.run?.appliedSceneVersion ?? null,
    };
  }

  if (!terminal.run) {
    throw new Error("Run disappeared before completion.");
  }

  const thread = await input.context.convex.query(
    api.diagramThreads.listBySession,
    {
      sessionId: session.sessionId,
    }
  );
  const assistantMessage = thread
    ? getAssistantMessageForPrompt(
        thread.messages as Array<{
          promptMessageId: string | null;
          role: "user" | "assistant" | "tool";
          messageType: "chat" | "tool";
          content: string;
          reasoningSummary: string | null;
        }>,
        input.promptMessageId
      )
    : null;

  if (terminal.run.status !== "persisted") {
    return {
      status: (terminal.run.status === "stopped" ? "stopped" : "error") as
        | "stopped"
        | "error",
      sessionId: session.sessionId,
      threadId: enqueueResult.threadId,
      promptMessageId: input.promptMessageId,
      runStatus: terminal.run.status,
      traceId: input.traceId,
      elapsedMs: Date.now() - input.startedAt,
      runError: terminal.run.error ?? null,
      assistantMessage: assistantMessage?.content ?? null,
      reasoningSummary: assistantMessage?.reasoningSummary ?? null,
      latestSceneVersion: terminal.run.appliedSceneVersion ?? null,
    };
  }

  const persistedSession = await input.context.convex.query(
    api.diagramSessions.get,
    {
      sessionId: session.sessionId,
    }
  );
  if (!persistedSession?.latestScene) {
    throw new Error("Run persisted without a saved scene.");
  }

  const shareLink = await input.context.convex.action(
    api.diagrams.shareDiagram,
    {
      elements: persistedSession.latestScene.elements as unknown[],
      appState: persistedSession.latestScene.appState as Record<
        string,
        unknown
      >,
      traceId: input.traceId,
    }
  );

  return {
    status: "persisted" as const,
    sessionId: session.sessionId,
    threadId: persistedSession.threadId ?? enqueueResult.threadId,
    promptMessageId: input.promptMessageId,
    runStatus: terminal.run.status,
    traceId: input.traceId,
    elapsedMs: Date.now() - input.startedAt,
    runError: terminal.run.error ?? null,
    assistantMessage: assistantMessage?.content ?? null,
    reasoningSummary: assistantMessage?.reasoningSummary ?? null,
    latestSceneVersion: persistedSession.latestSceneVersion,
    shareLink,
    elements: persistedSession.latestScene.elements as unknown[],
    appState: persistedSession.latestScene.appState as Record<string, unknown>,
  };
}

const shareLinkSchema = z.object({
  url: z.string().url(),
  shareId: z.string(),
  encryptionKey: z.string(),
});

const exampleShareUrl =
  "https://excalidraw.com/#json=exampleShareId,exampleKey";

const exampleIntermediate = {
  nodes: [
    { id: "node-1", label: "Start" },
    { id: "node-2", label: "Finish" },
  ],
  edges: [{ fromId: "node-1", toId: "node-2", label: "next" }],
  graphOptions: { diagramType: "flowchart" },
};

const exampleElements = [
  {
    id: "node-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 120,
    height: 60,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: { type: 3 },
    seed: 101,
    version: 1,
    versionNonce: 30_101,
    isDeleted: false,
    boundElements: null,
    updated: 1_725_000_000_000,
    link: null,
    locked: false,
  },
];

const generateInputSchema = z
  .object({
    prompt: z.string().min(1).max(10_000).optional(),
    profileId: z.string().optional(),
    intermediate: z.any().optional(),
    traceId: z.string().optional(),
  })
  .refine((value) => Boolean(value.prompt || value.intermediate), {
    message: "prompt or intermediate is required",
  });

JSON_SCHEMA_REGISTRY.add(generateInputSchema, {
  examples: [
    { prompt: "Create a flowchart for user onboarding." },
    { intermediate: exampleIntermediate },
  ],
});

const generateOutputSchema = z.object({
  status: z.literal("success"),
  intermediate: z.any(),
  diagram: z.any(),
  elements: z.array(z.any()),
  shareLink: shareLinkSchema,
  stats: z.object({
    traceId: z.string(),
    iterations: z.number(),
    tokens: z.number(),
    durationMs: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
    shapeCount: z.number(),
    arrowCount: z.number(),
  }),
});

const tweakOutputSchema = z.object({
  status: z.enum(["success", "failed"]),
  reason: z.string().optional(),
  elements: z.array(z.any()).optional(),
  appState: z.record(z.string(), z.any()).optional(),
  changes: z
    .object({
      diff: z.any().optional(),
      addedIds: z.array(z.string()).optional(),
      removedIds: z.array(z.string()).optional(),
      modifiedIds: z.array(z.string()).optional(),
    })
    .optional(),
  issues: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        elementId: z.string().optional(),
      })
    )
    .optional(),
  stats: z.object({
    strategy: z.literal("tweak"),
    iterations: z.number(),
    tokens: z.number(),
    durationMs: z.number(),
    traceId: z.string(),
  }),
  shareLink: shareLinkSchema.optional(),
});

const restructureOutputSchema = z.object({
  status: z.enum(["success", "failed"]),
  reason: z.string().optional(),
  elements: z.array(z.any()).optional(),
  appState: z.record(z.string(), z.any()).optional(),
  issues: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        elementId: z.string().optional(),
      })
    )
    .optional(),
  stats: z.object({
    strategy: z.literal("restructure"),
    traceId: z.string(),
    iterations: z.number(),
    tokens: z.number(),
    durationMs: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
    shapeCount: z.number(),
    arrowCount: z.number(),
  }),
  shareLink: shareLinkSchema.optional(),
});

const parseOutputSchema = z.object({
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()),
  source: z.enum([
    "excalidraw-share",
    "excalidraw-plus-link",
    "excalidraw-plus-readonly",
  ]),
  permission: z.enum(["read-only", "view-and-edit", "unknown"]),
  metadata: z.any(),
  intermediate: z.any(),
  stats: z.object({
    elementCount: z.number(),
    nodeCount: z.number(),
    edgeCount: z.number(),
    traceId: z.string(),
  }),
});

const tweakInputSchema = z.object({
  shareUrl: z.string().url(),
  request: z.string().min(1),
  traceId: z.string().optional(),
  options: z
    .object({
      maxSteps: z.number().optional(),
      timeoutMs: z.number().optional(),
      preferExplicitEdits: z.boolean().optional(),
    })
    .optional(),
});

JSON_SCHEMA_REGISTRY.add(tweakInputSchema, {
  examples: [
    {
      shareUrl: exampleShareUrl,
      request: "Rename node-1 to 'Start' and update label colors.",
    },
  ],
});

const restructureInputSchema = z.object({
  shareUrl: z.string().url(),
  prompt: z.string().min(1),
  traceId: z.string().optional(),
  options: z
    .object({
      profileId: z.string().optional(),
      timeoutMs: z.number().optional(),
      maxSteps: z.number().optional(),
    })
    .optional(),
});

JSON_SCHEMA_REGISTRY.add(restructureInputSchema, {
  examples: [
    {
      shareUrl: exampleShareUrl,
      prompt:
        "Restructure this into a 3-step flow with an explicit QA decision branch.",
      options: { timeoutMs: 240_000 },
    },
  ],
});

const parseInputSchema = z.object({
  shareUrl: z.string().url(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(parseInputSchema, {
  examples: [{ shareUrl: exampleShareUrl }],
});

const shareInputSchema = z.object({
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()).optional(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(shareInputSchema, {
  examples: [{ elements: exampleElements, appState: {} }],
});

const threadRunInputSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  sessionId: z.string().optional(),
  promptMessageId: z.string().optional(),
  timeoutMs: z.number().int().min(5000).max(300_000).optional(),
  pollIntervalMs: z.number().int().min(200).max(5000).optional(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(threadRunInputSchema, {
  examples: [
    {
      prompt: "Create a flowchart for user onboarding.",
    },
    {
      sessionId: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      prompt: "Add fraud-check branch before approval",
      promptMessageId: "prompt_opencode_session_message_1234abcd",
    },
  ],
});

const threadRunOutputSchema = z.object({
  status: z.enum(["persisted", "error", "stopped", "timeout"]),
  sessionId: z.string(),
  threadId: z.string().nullable(),
  promptMessageId: z.string(),
  runStatus: z.enum([
    "sending",
    "running",
    "applying",
    "persisted",
    "stopped",
    "error",
  ]),
  traceId: z.string(),
  elapsedMs: z.number(),
  runError: z.string().nullable(),
  assistantMessage: z.string().nullable(),
  reasoningSummary: z.string().nullable(),
  latestSceneVersion: z.number().nullable(),
  shareLink: shareLinkSchema.optional(),
  elements: z.array(z.any()).optional(),
  appState: z.record(z.string(), z.any()).optional(),
});

const seedSessionInputSchema = z.object({
  sessionId: z.string().optional(),
  elements: z.array(z.any()),
  appState: z.record(z.string(), z.any()).optional(),
  expectedVersion: z.number().int().min(0).optional(),
  traceId: z.string().optional(),
});

JSON_SCHEMA_REGISTRY.add(seedSessionInputSchema, {
  examples: [
    {
      elements: exampleElements,
      appState: {},
    },
  ],
});

const seedSessionOutputSchema = z.object({
  status: z.enum(["success", "conflict"]),
  sessionId: z.string(),
  threadId: z.string().nullable(),
  latestSceneVersion: z.number(),
  traceId: z.string(),
  savedAt: z.number().optional(),
});

export const appRouter = {
  diagramsGenerate: orpc
    .route({ method: "POST", path: "/diagrams/generate" })
    .input(generateInputSchema)
    .output(generateOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.generateDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.generateDiagram",
          error,
          hint: "If this is intermittent, retry; if persistent, switch model or check upstream/provider status.",
        });
      }
    }),
  diagramsTweak: orpc
    .route({ method: "POST", path: "/diagrams/tweak" })
    .input(tweakInputSchema)
    .output(tweakOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.tweakDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.tweakDiagram",
          error,
        });
      }
    }),
  diagramsRestructure: orpc
    .route({ method: "POST", path: "/diagrams/restructure" })
    .input(restructureInputSchema)
    .output(restructureOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.restructureDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.restructureDiagram",
          error,
        });
      }
    }),
  diagramsParse: orpc
    .route({ method: "GET", path: "/diagrams/parse" })
    .input(parseInputSchema)
    .output(parseOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.parseDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.parseDiagram",
          error,
        });
      }
    }),
  diagramsShare: orpc
    .route({ method: "POST", path: "/diagrams/share" })
    .input(shareInputSchema)
    .output(shareLinkSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      try {
        return await context.convex.action(api.diagrams.shareDiagram, {
          ...input,
          traceId,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.action",
          action: "diagrams.shareDiagram",
          error,
        });
      }
    }),
  diagramsSessionSeed: orpc
    .route({ method: "POST", path: "/diagrams/session-seed" })
    .input(seedSessionInputSchema)
    .output(seedSessionOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;

      try {
        let sessionId = input.sessionId;
        let threadId: string | null = null;

        if (sessionId) {
          const ensured = await context.convex.mutation(
            api.diagramSessions.ensureThread,
            {
              sessionId,
            }
          );
          threadId = ensured.threadId;
        } else {
          const created = await context.convex.mutation(
            api.diagramSessions.create,
            {}
          );
          sessionId = created.sessionId;
          threadId = created.threadId;
        }

        if (!sessionId) {
          throw new Error("Failed to resolve a diagram session.");
        }

        const session = await context.convex.query(api.diagramSessions.get, {
          sessionId,
        });
        if (!session) {
          throw new Error("Session not found.");
        }

        const expectedVersion =
          input.expectedVersion ?? session.latestSceneVersion;
        const saveResult = await context.convex.mutation(
          api.diagramSessions.setLatestScene,
          {
            sessionId,
            expectedVersion,
            elements: input.elements,
            appState: input.appState ?? {},
          }
        );

        const responseThreadId = session.threadId ?? threadId;

        if (saveResult.status === "success") {
          return {
            status: "success" as const,
            sessionId,
            threadId: responseThreadId,
            latestSceneVersion: saveResult.latestSceneVersion,
            savedAt: saveResult.savedAt,
            traceId,
          };
        }

        if (saveResult.status === "conflict") {
          return {
            status: "conflict" as const,
            sessionId,
            threadId: responseThreadId,
            latestSceneVersion: saveResult.latestSceneVersion,
            traceId,
          };
        }

        throw new Error(
          saveResult.reason === "scene-too-large"
            ? "Scene is too large to seed."
            : "Failed to seed session."
        );
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.mutation",
          action: "diagrams.sessionSeed",
          error,
        });
      }
    }),
  diagramsThreadRun: orpc
    .route({ method: "POST", path: "/diagrams/thread-run" })
    .input(threadRunInputSchema)
    .output(threadRunOutputSchema)
    .handler(async ({ input, context }) => {
      const traceId = input.traceId ?? context.traceId;
      const timeoutMs = input.timeoutMs ?? DEFAULT_THREAD_RUN_TIMEOUT_MS;
      const pollIntervalMs =
        input.pollIntervalMs ?? DEFAULT_THREAD_RUN_POLL_INTERVAL_MS;
      const startedAt = Date.now();
      const promptMessageId = input.promptMessageId ?? createPromptMessageId();

      try {
        return await executeThreadRun({
          context,
          sessionId: input.sessionId,
          prompt: input.prompt,
          promptMessageId,
          pollIntervalMs,
          timeoutMs,
          traceId,
          startedAt,
        });
      } catch (error) {
        throwInternalError({
          traceId,
          stage: "convex.thread-run",
          action: "diagrams.threadRun",
          error,
        });
      }
    }),
};

export type AppRouter = typeof appRouter;
