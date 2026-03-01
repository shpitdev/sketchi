import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { createTraceId } from "./lib/trace";
import { ensureViewerUser, getViewerWithUser } from "./lib/users";

type SessionLike = Doc<"diagramSessions">;

function normalizePrompt(prompt: string): string {
  return prompt.trim();
}

function createMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function createThreadId(): string {
  return `thread_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function getAuthorizedSessionForQuery(
  ctx: QueryCtx,
  sessionId: string
): Promise<SessionLike | null> {
  const { user, isAdmin } = await getViewerWithUser(ctx);
  if (!user) {
    throw new Error("Unauthorized");
  }

  const session = await ctx.db
    .query("diagramSessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();

  if (!session) {
    return null;
  }

  if (session.ownerUserId && session.ownerUserId !== user._id && !isAdmin) {
    throw new Error("Forbidden");
  }

  return session;
}

async function getAuthorizedSessionForMutation(
  ctx: MutationCtx,
  sessionId: string
): Promise<{ session: SessionLike; viewerUserId: Id<"users"> }> {
  const { user, isAdmin } = await ensureViewerUser(ctx);

  const session = await ctx.db
    .query("diagramSessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();

  if (!session) {
    throw new Error("Session not found");
  }

  if (session.ownerUserId && session.ownerUserId !== user._id && !isAdmin) {
    throw new Error("Forbidden");
  }

  return {
    session,
    viewerUserId: user._id,
  };
}

async function getMessageByMessageId(
  ctx: Pick<MutationCtx, "db">,
  messageId: string
): Promise<Doc<"diagramThreadMessages"> | null> {
  return await ctx.db
    .query("diagramThreadMessages")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .unique();
}

export const listBySession = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const session = await getAuthorizedSessionForQuery(ctx, sessionId);
    if (!session) {
      return null;
    }

    const messages = await ctx.db
      .query("diagramThreadMessages")
      .withIndex("by_session_createdAt", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect();

    const latestRun = (
      await ctx.db
        .query("diagramThreadRuns")
        .withIndex("by_session_createdAt", (q) => q.eq("sessionId", sessionId))
        .order("desc")
        .collect()
    )[0];

    return {
      threadId: session.threadId ?? null,
      messages: messages.map((message) => ({
        messageId: message.messageId,
        promptMessageId: message.promptMessageId ?? null,
        role: message.role,
        messageType: message.messageType,
        content: message.content ?? "",
        reasoningSummary: message.reasoningSummary ?? null,
        status: message.status ?? null,
        toolName: message.toolName ?? null,
        toolCallId: message.toolCallId ?? null,
        toolInput: message.toolInput ?? null,
        toolOutput: message.toolOutput ?? null,
        traceId: message.traceId ?? null,
        error: message.error ?? null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })),
      latestRun: latestRun
        ? {
            promptMessageId: latestRun.promptMessageId,
            status: latestRun.status,
            stopRequested: latestRun.stopRequested,
            error: latestRun.error ?? null,
            appliedSceneVersion: latestRun.appliedSceneVersion ?? null,
            updatedAt: latestRun.updatedAt,
            finishedAt: latestRun.finishedAt ?? null,
          }
        : null,
    };
  },
});

export const getRun = query({
  args: {
    sessionId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { sessionId, promptMessageId }) => {
    const session = await getAuthorizedSessionForQuery(ctx, sessionId);
    if (!session) {
      return null;
    }

    const run = await ctx.db
      .query("diagramThreadRuns")
      .withIndex("by_session_promptMessageId", (q) =>
        q.eq("sessionId", sessionId).eq("promptMessageId", promptMessageId)
      )
      .unique();

    if (!run) {
      return null;
    }

    return {
      promptMessageId: run.promptMessageId,
      status: run.status,
      stopRequested: run.stopRequested,
      error: run.error ?? null,
      appliedSceneVersion: run.appliedSceneVersion ?? null,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt ?? null,
      assistantMessageId: run.assistantMessageId,
      userMessageId: run.userMessageId,
      traceId: run.traceId,
    };
  },
});

export const enqueuePrompt = mutation({
  args: {
    sessionId: v.string(),
    prompt: v.string(),
    promptMessageId: v.string(),
    traceId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | {
        status: "duplicate";
        runId: Id<"diagramThreadRuns">;
        threadId: string;
        promptMessageId: string;
        traceId: string;
        assistantMessageId: string;
        userMessageId: string;
      }
    | {
        status: "enqueued";
        runId: Id<"diagramThreadRuns">;
        threadId: string;
        promptMessageId: string;
        traceId: string;
        assistantMessageId: string;
        userMessageId: string;
      }
  > => {
    const prompt = normalizePrompt(args.prompt);
    if (!prompt) {
      throw new Error("Prompt cannot be empty");
    }

    const { session, viewerUserId } = await getAuthorizedSessionForMutation(
      ctx,
      args.sessionId
    );

    const existingRun = await ctx.db
      .query("diagramThreadRuns")
      .withIndex("by_session_promptMessageId", (q) =>
        q
          .eq("sessionId", args.sessionId)
          .eq("promptMessageId", args.promptMessageId)
      )
      .unique();

    if (existingRun) {
      return {
        status: "duplicate" as const,
        runId: existingRun._id,
        threadId: existingRun.threadId,
        promptMessageId: existingRun.promptMessageId,
        traceId: existingRun.traceId,
        assistantMessageId: existingRun.assistantMessageId,
        userMessageId: existingRun.userMessageId,
      };
    }

    let threadId = session.threadId;
    if (!threadId) {
      threadId = createThreadId();
      await ctx.db.patch(session._id, {
        threadId,
        updatedAt: Date.now(),
      });
    }

    if (!threadId) {
      throw new Error("Failed to initialize session thread");
    }

    const now = Date.now();
    const traceId = args.traceId ?? createTraceId();
    const userMessageId = createMessageId();
    const assistantMessageId = createMessageId();

    await ctx.db.insert("diagramThreadMessages", {
      sessionId: args.sessionId,
      threadId,
      messageId: userMessageId,
      promptMessageId: args.promptMessageId,
      role: "user",
      messageType: "chat",
      status: "persisted",
      content: prompt,
      traceId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("diagramThreadMessages", {
      sessionId: args.sessionId,
      threadId,
      messageId: assistantMessageId,
      promptMessageId: args.promptMessageId,
      role: "assistant",
      messageType: "chat",
      status: "sending",
      content: "",
      traceId,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    const runId: Id<"diagramThreadRuns"> = await ctx.db.insert(
      "diagramThreadRuns",
      {
        sessionId: args.sessionId,
        threadId,
        ownerUserId: session.ownerUserId ?? viewerUserId,
        promptMessageId: args.promptMessageId,
        prompt,
        traceId,
        userMessageId,
        assistantMessageId,
        status: "sending",
        stopRequested: false,
        createdAt: now,
        updatedAt: now,
      }
    );

    if (process.env.SKETCHI_DISABLE_THREAD_AUTORUN !== "1") {
      await ctx.scheduler.runAfter(0, internal.diagramThreadsNode.processRun, {
        runId,
      });
    }

    return {
      status: "enqueued" as const,
      runId,
      threadId,
      promptMessageId: args.promptMessageId,
      traceId,
      assistantMessageId,
      userMessageId,
    };
  },
});

export const stopPrompt = mutation({
  args: {
    sessionId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { sessionId, promptMessageId }) => {
    await getAuthorizedSessionForMutation(ctx, sessionId);

    let run = await ctx.db
      .query("diagramThreadRuns")
      .withIndex("by_session_promptMessageId", (q) =>
        q.eq("sessionId", sessionId).eq("promptMessageId", promptMessageId)
      )
      .unique();

    if (!run) {
      const fallbackRun = (
        await ctx.db
          .query("diagramThreadRuns")
          .withIndex("by_session_createdAt", (q) =>
            q.eq("sessionId", sessionId)
          )
          .order("desc")
          .collect()
      ).find(
        (candidate) =>
          candidate.status !== "persisted" &&
          candidate.status !== "error" &&
          candidate.status !== "stopped"
      );

      if (fallbackRun) {
        run = fallbackRun;
      }
    }

    if (!run) {
      return {
        status: "not-found" as const,
      };
    }

    const now = Date.now();
    const isTerminal =
      run.status === "persisted" ||
      run.status === "error" ||
      run.status === "stopped";

    await ctx.db.patch(run._id, {
      stopRequested: true,
      status: isTerminal ? run.status : "stopped",
      updatedAt: now,
      finishedAt: isTerminal ? run.finishedAt : now,
    });

    if (!isTerminal) {
      const assistantMessage = await getMessageByMessageId(
        ctx,
        run.assistantMessageId
      );
      if (assistantMessage) {
        await ctx.db.patch(assistantMessage._id, {
          status: "stopped",
          updatedAt: now,
        });
      }
    }

    return {
      status: "requested" as const,
      runStatus: isTerminal ? run.status : "stopped",
      promptMessageId: run.promptMessageId,
    };
  },
});

export const getRunForProcessing = internalQuery({
  args: {
    runId: v.id("diagramThreadRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) {
      return null;
    }

    const session = await ctx.db
      .query("diagramSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", run.sessionId))
      .unique();

    if (!session) {
      return null;
    }

    const messages = await ctx.db
      .query("diagramThreadMessages")
      .withIndex("by_session_createdAt", (q) =>
        q.eq("sessionId", run.sessionId)
      )
      .order("asc")
      .collect();

    return {
      run,
      session,
      messages,
    };
  },
});

export const shouldStopRun = internalQuery({
  args: {
    runId: v.id("diagramThreadRuns"),
  },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) {
      return true;
    }
    return run.stopRequested || run.status === "stopped";
  },
});

export const updateAssistantProgress = internalMutation({
  args: {
    assistantMessageId: v.string(),
    content: v.optional(v.string()),
    reasoningSummary: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("sending"),
        v.literal("running"),
        v.literal("applying"),
        v.literal("persisted"),
        v.literal("stopped"),
        v.literal("error")
      )
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("diagramThreadMessages")
      .withIndex("by_messageId", (q) =>
        q.eq("messageId", args.assistantMessageId)
      )
      .unique();

    if (!message) {
      return;
    }

    await ctx.db.patch(message._id, {
      ...(args.content === undefined ? {} : { content: args.content }),
      ...(args.reasoningSummary === undefined
        ? {}
        : { reasoningSummary: args.reasoningSummary }),
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(args.error === undefined ? {} : { error: args.error }),
      updatedAt: Date.now(),
    });
  },
});

export const upsertToolMessage = internalMutation({
  args: {
    runId: v.id("diagramThreadRuns"),
    sessionId: v.string(),
    threadId: v.string(),
    promptMessageId: v.string(),
    traceId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("error")
    ),
    toolInput: v.optional(v.any()),
    toolOutput: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("diagramThreadMessages")
      .withIndex("by_run_toolCallId", (q) =>
        q.eq("runId", args.runId).eq("toolCallId", args.toolCallId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        toolName: args.toolName,
        ...(args.toolInput === undefined ? {} : { toolInput: args.toolInput }),
        ...(args.toolOutput === undefined
          ? {}
          : { toolOutput: args.toolOutput }),
        ...(args.error === undefined ? {} : { error: args.error }),
        updatedAt: now,
      });
      return {
        messageId: existing.messageId,
      };
    }

    const messageId = createMessageId();
    await ctx.db.insert("diagramThreadMessages", {
      sessionId: args.sessionId,
      threadId: args.threadId,
      runId: args.runId,
      messageId,
      promptMessageId: args.promptMessageId,
      role: "tool",
      messageType: "tool",
      status: args.status,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      toolInput: args.toolInput,
      toolOutput: args.toolOutput,
      traceId: args.traceId,
      error: args.error,
      createdAt: now,
      updatedAt: now,
    });

    return {
      messageId,
    };
  },
});

export const updateRunState = internalMutation({
  args: {
    runId: v.id("diagramThreadRuns"),
    status: v.union(
      v.literal("sending"),
      v.literal("running"),
      v.literal("applying"),
      v.literal("persisted"),
      v.literal("stopped"),
      v.literal("error")
    ),
    error: v.optional(v.string()),
    appliedSceneVersion: v.optional(v.number()),
    finished: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: args.status,
      ...(args.error === undefined ? {} : { error: args.error }),
      ...(args.appliedSceneVersion === undefined
        ? {}
        : { appliedSceneVersion: args.appliedSceneVersion }),
      ...(args.finished ? { finishedAt: now } : {}),
      updatedAt: now,
    });
  },
});
