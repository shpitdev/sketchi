import { v } from "convex/values";

import type { DatabaseReader } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const DEFAULT_STYLE_SETTINGS = {
  strokeColor: "#1f2937",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  fillStyle: "hachure",
  roughness: 1,
  opacity: 100,
} as const;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "library";

const getUniqueSlug = async (ctx: { db: DatabaseReader }, base: string) => {
  let slug = base;
  let attempt = 1;

  while (true) {
    const existing = await ctx.db
      .query("iconLibraries")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!existing) {
      return slug;
    }
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
};

export const list = query({
  handler: async (ctx) => {
    const libraries = await ctx.db.query("iconLibraries").collect();

    return Promise.all(
      libraries.map(async (library) => {
        const icons = await ctx.db
          .query("iconItems")
          .withIndex("by_library_order", (q) => q.eq("libraryId", library._id))
          .order("asc")
          .collect();

        const previewIcons = icons.slice(0, 9);
        const previewUrls = (
          await Promise.all(
            previewIcons.map(async (icon) => {
              const url = await ctx.storage.getUrl(icon.storageId);
              return url ?? null;
            })
          )
        ).filter((url): url is string => Boolean(url));

        return {
          ...library,
          iconCount: icons.length,
          previewUrls,
        };
      })
    );
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const library = await ctx.db
      .query("iconLibraries")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!library) {
      return null;
    }

    const icons = await ctx.db
      .query("iconItems")
      .withIndex("by_library", (q) => q.eq("libraryId", library._id))
      .collect();

    return {
      library,
      iconCount: icons.length,
    };
  },
});

export const get = query({
  args: { id: v.id("iconLibraries") },
  handler: async (ctx, { id }) => {
    const library = await ctx.db.get(id);
    if (!library) {
      throw new Error("Icon library not found.");
    }

    const icons = await ctx.db
      .query("iconItems")
      .withIndex("by_library_order", (q) => q.eq("libraryId", id))
      .order("asc")
      .collect();

    const iconsWithUrls = await Promise.all(
      icons.map(async (icon) => ({
        ...icon,
        url: await ctx.storage.getUrl(icon.storageId),
      }))
    );

    return { library, icons: iconsWithUrls };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, { name, description, slug }) => {
    const baseSlug = slug ? slugify(slug) : slugify(name);
    const uniqueSlug = await getUniqueSlug(ctx, baseSlug);
    const now = Date.now();

    return ctx.db.insert("iconLibraries", {
      name,
      slug: uniqueSlug,
      description,
      styleSettings: { ...DEFAULT_STYLE_SETTINGS },
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("iconLibraries"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    styleSettings: v.optional(
      v.object({
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
      })
    ),
  },
  handler: async (ctx, { id, name, description, styleSettings }) => {
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) {
      updates.name = name;
    }
    if (description !== undefined) {
      updates.description = description;
    }
    if (styleSettings !== undefined) {
      updates.styleSettings = styleSettings;
    }

    await ctx.db.patch(id, updates);
  },
});

export const generateUploadUrl = mutation({
  handler: (ctx) => {
    return ctx.storage.generateUploadUrl();
  },
});

export const addIconRecord = internalMutation({
  args: {
    libraryId: v.id("iconLibraries"),
    storageId: v.id("_storage"),
    originalName: v.string(),
    contentHash: v.string(),
    fileName: v.string(),
    byteSize: v.number(),
  },
  handler: async (
    ctx,
    { libraryId, storageId, originalName, contentHash, fileName, byteSize }
  ) => {
    const library = await ctx.db.get(libraryId);
    if (!library) {
      throw new Error("Icon library not found.");
    }

    const lastItem = await ctx.db
      .query("iconItems")
      .withIndex("by_library_order", (q) => q.eq("libraryId", libraryId))
      .order("desc")
      .first();
    const nextOrder = lastItem ? lastItem.sortOrder + 1 : 0;

    const now = Date.now();
    return ctx.db.insert("iconItems", {
      libraryId,
      storageId,
      originalName,
      fileName,
      contentHash,
      byteSize,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteIcon = mutation({
  args: { iconId: v.id("iconItems") },
  handler: async (ctx, { iconId }) => {
    const icon = await ctx.db.get(iconId);
    if (!icon) {
      throw new Error("Icon not found.");
    }

    await ctx.storage.delete(icon.storageId);
    await ctx.db.delete(iconId);
  },
});

export const reorderIcons = mutation({
  args: {
    libraryId: v.id("iconLibraries"),
    orderedIds: v.array(v.id("iconItems")),
  },
  handler: async (ctx, { libraryId, orderedIds }) => {
    // Phase 1: Validate ALL icons exist and belong to library
    for (const iconId of orderedIds) {
      const icon = await ctx.db.get(iconId);
      if (!icon || icon.libraryId !== libraryId) {
        throw new Error("Invalid icon reorder request.");
      }
    }

    // Phase 2: Apply ALL patches (only if all validation passed)
    const now = Date.now();
    for (let index = 0; index < orderedIds.length; index++) {
      await ctx.db.patch(orderedIds[index], {
        sortOrder: index,
        updatedAt: now,
      });
    }
  },
});
