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

export default defineSchema({
  iconLibraries: defineTable({
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    styleSettings,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
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
  }).index("by_sessionId", ["sessionId"]),
});
