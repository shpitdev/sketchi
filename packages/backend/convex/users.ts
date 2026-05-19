import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  ensureViewerUser,
  getIdentityEmail,
  getIdentityImage,
  getIdentityName,
  getViewerWithUser,
} from "./lib/users";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const {
      identity,
      user,
      isAdmin,
      canManagePublicIconLibraries,
      canBootstrapFirstAdmin,
    } = await getViewerWithUser(ctx);

    if (!user) {
      return {
        user: null,
        identity: {
          email: getIdentityEmail(identity),
          name: getIdentityName(identity),
          image: getIdentityImage(identity),
          isAdmin,
          canManagePublicIconLibraries,
          canBootstrapFirstAdmin,
        },
      };
    }

    return {
      user: {
        _id: user._id,
        externalId: user.externalId,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        canManagePublicIconLibraries: Boolean(
          user.canManagePublicIconLibraries
        ),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      identity: {
        email: getIdentityEmail(identity),
        name: getIdentityName(identity),
        image: getIdentityImage(identity),
        isAdmin,
        canManagePublicIconLibraries,
        canBootstrapFirstAdmin,
      },
    };
  },
});

export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, isAdmin, canManagePublicIconLibraries } =
      await ensureViewerUser(ctx);
    return {
      _id: user._id,
      role: user.role,
      storedCanManagePublicIconLibraries: Boolean(
        user.canManagePublicIconLibraries
      ),
      isAdmin,
      canManagePublicIconLibraries,
    };
  },
});

export const updateAuthorization = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("admin")),
    canManagePublicIconLibraries: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: viewerUser, isAdmin } = await ensureViewerUser(ctx);
    if (!isAdmin) {
      throw new Error("Forbidden");
    }

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    const canManagePublicIconLibraries =
      args.role === "admin" ? true : args.canManagePublicIconLibraries;

    await ctx.db.patch(args.userId, {
      role: args.role,
      canManagePublicIconLibraries,
      updatedAt: Date.now(),
    });

    return {
      userId: args.userId,
      role: args.role,
      canManagePublicIconLibraries,
      changedByUserId: viewerUser._id,
    };
  },
});
