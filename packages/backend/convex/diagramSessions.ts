import { v } from "convex/values";

import type { DatabaseReader } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { ensureViewerUser, getViewerWithUser } from "./lib/users";

const MAX_SCENE_BYTES = 900_000;

const STRIPPED_APP_STATE_KEYS = [
  "selectedElementIds",
  "selectedGroupIds",
  "editingElement",
  "openDialog",
  "collaborators",
  "cursorButton",
] as const;

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateThreadId(): string {
  return `thread_${generateSessionId()}`;
}

async function getUniqueSessionId(ctx: {
  db: DatabaseReader;
}): Promise<string> {
  while (true) {
    const candidate = generateSessionId();
    const existing = await ctx.db
      .query("diagramSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", candidate))
      .unique();
    if (!existing) {
      return candidate;
    }
  }
}

function filterAppState(
  appState: Record<string, unknown>
): Record<string, unknown> {
  const filtered = { ...appState };
  for (const key of STRIPPED_APP_STATE_KEYS) {
    delete filtered[key];
  }
  return filtered;
}

function measureSceneBytes(scene: {
  elements: unknown[];
  appState: unknown;
}): number {
  const json = JSON.stringify(scene);
  return new TextEncoder().encode(json).byteLength;
}

function validateSceneSize(scene: { elements: unknown[]; appState: unknown }):
  | {
      status: "ok";
      scene: {
        elements: unknown[];
        appState: Record<string, unknown>;
      };
    }
  | {
      status: "failed";
      reason: "scene-too-large";
      maxBytes: number;
      actualBytes: number;
    } {
  const filteredAppState = filterAppState(
    scene.appState as Record<string, unknown>
  );
  const normalizedScene = {
    elements: scene.elements,
    appState: filteredAppState,
  };
  const actualBytes = measureSceneBytes(normalizedScene);
  if (actualBytes > MAX_SCENE_BYTES) {
    return {
      status: "failed",
      reason: "scene-too-large",
      maxBytes: MAX_SCENE_BYTES,
      actualBytes,
    };
  }

  return {
    status: "ok",
    scene: normalizedScene,
  };
}

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await ensureViewerUser(ctx);
    const sessionId = await getUniqueSessionId(ctx);
    const threadId = generateThreadId();
    const now = Date.now();

    await ctx.db.insert("diagramSessions", {
      sessionId,
      ownerUserId: user._id,
      latestScene: undefined,
      latestSceneVersion: 0,
      createdAt: now,
      updatedAt: now,
      threadId,
    });

    return { sessionId, threadId };
  },
});

export const ensureThread = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
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

    if (session.threadId) {
      return { threadId: session.threadId };
    }

    const threadId = generateThreadId();
    await ctx.db.patch(session._id, {
      threadId,
      updatedAt: Date.now(),
    });
    return { threadId };
  },
});

export const get = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
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

    return {
      sessionId: session.sessionId,
      ownerUserId: session.ownerUserId ?? null,
      latestScene: session.latestScene ?? null,
      latestSceneVersion: session.latestSceneVersion,
      threadId: session.threadId ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  },
});

export const setLatestScene = mutation({
  args: {
    sessionId: v.string(),
    expectedVersion: v.number(),
    elements: v.array(v.any()),
    appState: v.record(v.string(), v.any()),
  },
  handler: async (ctx, { sessionId, expectedVersion, elements, appState }) => {
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

    if (expectedVersion !== session.latestSceneVersion) {
      return {
        status: "conflict" as const,
        latestSceneVersion: session.latestSceneVersion,
      };
    }

    const sizeChecked = validateSceneSize({
      elements,
      appState: appState as Record<string, unknown>,
    });
    if (sizeChecked.status !== "ok") {
      return {
        status: "failed" as const,
        reason: sizeChecked.reason,
        maxBytes: sizeChecked.maxBytes,
        actualBytes: sizeChecked.actualBytes,
      };
    }

    const now = Date.now();
    const newVersion = session.latestSceneVersion + 1;

    await ctx.db.patch(session._id, {
      ownerUserId: session.ownerUserId ?? user._id,
      latestScene: sizeChecked.scene,
      latestSceneVersion: newVersion,
      updatedAt: now,
    });

    return {
      status: "success" as const,
      latestSceneVersion: newVersion,
      savedAt: now,
    };
  },
});

export const internalSetLatestSceneFromThreadRun = internalMutation({
  args: {
    sessionId: v.string(),
    ownerUserId: v.id("users"),
    expectedVersion: v.number(),
    elements: v.array(v.any()),
    appState: v.record(v.string(), v.any()),
  },
  handler: async (
    ctx,
    { sessionId, ownerUserId, expectedVersion, elements, appState }
  ) => {
    const session = await ctx.db
      .query("diagramSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();

    if (!session) {
      return {
        status: "failed" as const,
        reason: "session-not-found" as const,
      };
    }

    if (session.ownerUserId && session.ownerUserId !== ownerUserId) {
      return {
        status: "failed" as const,
        reason: "forbidden" as const,
      };
    }

    if (expectedVersion !== session.latestSceneVersion) {
      return {
        status: "conflict" as const,
        latestSceneVersion: session.latestSceneVersion,
      };
    }

    const sizeChecked = validateSceneSize({
      elements,
      appState: appState as Record<string, unknown>,
    });
    if (sizeChecked.status !== "ok") {
      return {
        status: "failed" as const,
        reason: sizeChecked.reason,
        maxBytes: sizeChecked.maxBytes,
        actualBytes: sizeChecked.actualBytes,
      };
    }

    const now = Date.now();
    const newVersion = session.latestSceneVersion + 1;
    await ctx.db.patch(session._id, {
      ownerUserId: session.ownerUserId ?? ownerUserId,
      latestScene: sizeChecked.scene,
      latestSceneVersion: newVersion,
      updatedAt: now,
    });

    return {
      status: "success" as const,
      latestSceneVersion: newVersion,
      savedAt: now,
    };
  },
});
