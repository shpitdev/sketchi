import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const styleSettings = v.object({
  strokeColor: v.string(),
  backgroundColor: v.string(),
  strokeWidth: v.number(),
  strokeStyle: v.union(
    v.literal("solid"),
    v.literal("dashed"),
    v.literal("dotted")
  ),
  fillStyle: v.union(
    v.literal("solid"),
    v.literal("hachure"),
    v.literal("cross-hatch"),
    v.literal("zigzag")
  ),
  roughness: v.number(),
  opacity: v.number(),
});

const userRole = v.union(v.literal("user"), v.literal("admin"));
const libraryVisibility = v.union(v.literal("public"), v.literal("private"));
const threadRunStatus = v.union(
  v.literal("sending"),
  v.literal("running"),
  v.literal("applying"),
  v.literal("persisted"),
  v.literal("stopped"),
  v.literal("error")
);
const threadMessageRole = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("tool")
);
const threadMessageType = v.union(v.literal("chat"), v.literal("tool"));
const toolStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("error")
);

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    role: userRole,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_externalId", ["externalId"])
    .index("by_email", ["email"]),
  oauthDeviceFlows: defineTable({
    deviceCodeHash: v.string(),
    userCode: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("consumed"),
      v.literal("expired")
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    intervalSeconds: v.number(),
    lastPolledAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedByExternalId: v.optional(v.string()),
    consumedAt: v.optional(v.number()),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
  })
    .index("by_deviceCodeHash", ["deviceCodeHash"])
    .index("by_userCode", ["userCode"]),
  iconLibraries: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    styleSettings,
    visibility: v.optional(libraryVisibility),
    ownerUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_visibility", ["visibility"])
    .index("by_ownerUserId", ["ownerUserId"]),
  iconItems: defineTable({
    libraryId: v.id("iconLibraries"),
    storageId: v.id("_storage"),
    originalName: v.string(),
    fileName: v.string(),
    contentHash: v.string(),
    byteSize: v.number(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_library", ["libraryId"])
    .index("by_library_order", ["libraryId", "sortOrder"]),
  diagramSessions: defineTable({
    sessionId: v.string(),
    ownerUserId: v.optional(v.id("users")),
    latestScene: v.optional(
      v.object({
        elements: v.array(v.any()),
        appState: v.any(),
      })
    ),
    latestSceneVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    threadId: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_ownerUserId", ["ownerUserId"]),
  diagramThreadRuns: defineTable({
    sessionId: v.string(),
    threadId: v.string(),
    ownerUserId: v.id("users"),
    promptMessageId: v.string(),
    prompt: v.string(),
    traceId: v.string(),
    userMessageId: v.string(),
    assistantMessageId: v.string(),
    status: threadRunStatus,
    stopRequested: v.boolean(),
    error: v.optional(v.string()),
    appliedSceneVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_session_promptMessageId", ["sessionId", "promptMessageId"])
    .index("by_session_createdAt", ["sessionId", "createdAt"]),
  diagramThreadMessages: defineTable({
    sessionId: v.string(),
    threadId: v.string(),
    runId: v.optional(v.id("diagramThreadRuns")),
    messageId: v.string(),
    promptMessageId: v.optional(v.string()),
    role: threadMessageRole,
    messageType: threadMessageType,
    status: v.optional(v.union(threadRunStatus, toolStatus)),
    content: v.optional(v.string()),
    reasoningSummary: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    toolInput: v.optional(v.any()),
    toolOutput: v.optional(v.any()),
    traceId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session_createdAt", ["sessionId", "createdAt"])
    .index("by_thread_createdAt", ["threadId", "createdAt"])
    .index("by_run_toolCallId", ["runId", "toolCallId"])
    .index("by_messageId", ["messageId"]),
});
