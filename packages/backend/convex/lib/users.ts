import type { UserIdentity } from "convex/server";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

function parseEmailSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

function parseSubjectSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

function getBootstrapAdminEmails(): Set<string> {
  return parseEmailSet(process.env.SKETCHI_BOOTSTRAP_ADMIN_EMAILS);
}

function getBootstrapAdminSubjects(): Set<string> {
  return parseSubjectSet(process.env.SKETCHI_BOOTSTRAP_ADMIN_SUBJECTS);
}

function normalizeEmail(email: string | null | undefined): string | undefined {
  if (!email) {
    return undefined;
  }
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeName(name: string | null | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  const normalized = name.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeImage(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const normalized = url.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function getIdentityExternalId(identity: UserIdentity): string {
  return identity.subject ?? identity.tokenIdentifier;
}

export function getIdentityEmail(identity: UserIdentity): string | undefined {
  return normalizeEmail(identity.email);
}

export function getIdentityName(identity: UserIdentity): string | undefined {
  return normalizeName(identity.name);
}

export function getIdentityImage(identity: UserIdentity): string | undefined {
  return normalizeImage(identity.pictureUrl);
}

export function canIdentityBootstrapFirstAdmin(
  identity: UserIdentity
): boolean {
  const email = getIdentityEmail(identity);
  return (
    (email ? getBootstrapAdminEmails().has(email) : false) ||
    getBootstrapAdminSubjects().has(getIdentityExternalId(identity))
  );
}

export async function hasAnyAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<boolean> {
  const admin = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .first();
  return Boolean(admin);
}

export async function canBootstrapIdentityAsFirstAdmin(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity
): Promise<boolean> {
  if (!canIdentityBootstrapFirstAdmin(identity)) {
    return false;
  }
  return !(await hasAnyAdmin(ctx));
}

export function isUserAdmin(user: Doc<"users"> | null): boolean {
  return user?.role === "admin";
}

export function canUserManagePublicIconLibraries(
  user: Doc<"users"> | null
): boolean {
  return Boolean(isUserAdmin(user) || user?.canManagePublicIconLibraries);
}

export async function getUserAuthorization(
  ctx: QueryCtx | MutationCtx,
  args: { identity: UserIdentity; user: Doc<"users"> | null }
): Promise<{
  isAdmin: boolean;
  canManagePublicIconLibraries: boolean;
  canBootstrapFirstAdmin: boolean;
}> {
  const canBootstrapFirstAdmin = await canBootstrapIdentityAsFirstAdmin(
    ctx,
    args.identity
  );
  const isAdmin = isUserAdmin(args.user) || canBootstrapFirstAdmin;
  return {
    isAdmin,
    canManagePublicIconLibraries:
      isAdmin || canUserManagePublicIconLibraries(args.user),
    canBootstrapFirstAdmin,
  };
}

export async function findUserByExternalId(
  ctx: QueryCtx | MutationCtx,
  externalId: string
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
    .unique();
}

export async function getViewerWithUser(ctx: QueryCtx | MutationCtx): Promise<{
  identity: UserIdentity;
  user: Doc<"users"> | null;
  isAdmin: boolean;
  canManagePublicIconLibraries: boolean;
  canBootstrapFirstAdmin: boolean;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const user = await findUserByExternalId(ctx, getIdentityExternalId(identity));
  const authorization = await getUserAuthorization(ctx, { identity, user });

  return {
    identity,
    user,
    ...authorization,
  };
}

export async function ensureViewerUser(ctx: MutationCtx): Promise<{
  identity: UserIdentity;
  user: Doc<"users">;
  isAdmin: boolean;
  canManagePublicIconLibraries: boolean;
  canBootstrapFirstAdmin: boolean;
}> {
  const {
    identity,
    user,
    isAdmin,
    canManagePublicIconLibraries,
    canBootstrapFirstAdmin,
  } = await getViewerWithUser(ctx);
  const externalId = getIdentityExternalId(identity);
  const email = getIdentityEmail(identity);
  const name = getIdentityName(identity);
  const image = getIdentityImage(identity);
  const now = Date.now();

  if (!user) {
    const userId = await ctx.db.insert("users", {
      externalId,
      email,
      name,
      image,
      role: canBootstrapFirstAdmin ? "admin" : "user",
      canManagePublicIconLibraries: canBootstrapFirstAdmin,
      createdAt: now,
      updatedAt: now,
    });
    const inserted = await ctx.db.get(userId);
    if (!inserted) {
      throw new Error("Failed to create user");
    }
    return {
      identity,
      user: inserted,
      isAdmin: inserted.role === "admin",
      canManagePublicIconLibraries:
        inserted.role === "admin" ||
        Boolean(inserted.canManagePublicIconLibraries),
      canBootstrapFirstAdmin,
    };
  }

  const nextRole =
    canBootstrapFirstAdmin && user.role !== "admin" ? "admin" : user.role;
  const nextCanManagePublicIconLibraries =
    canBootstrapFirstAdmin && !user.canManagePublicIconLibraries
      ? true
      : user.canManagePublicIconLibraries;

  if (
    user.email !== email ||
    user.name !== name ||
    user.image !== image ||
    user.role !== nextRole ||
    user.canManagePublicIconLibraries !== nextCanManagePublicIconLibraries
  ) {
    await ctx.db.patch(user._id, {
      email,
      name,
      image,
      role: nextRole,
      canManagePublicIconLibraries: nextCanManagePublicIconLibraries,
      updatedAt: now,
    });

    const refreshed = await ctx.db.get(user._id);
    if (!refreshed) {
      throw new Error("User not found after update");
    }

    return {
      identity,
      user: refreshed,
      isAdmin: refreshed.role === "admin",
      canManagePublicIconLibraries:
        refreshed.role === "admin" ||
        Boolean(refreshed.canManagePublicIconLibraries),
      canBootstrapFirstAdmin,
    };
  }

  return {
    identity,
    user,
    isAdmin,
    canManagePublicIconLibraries,
    canBootstrapFirstAdmin,
  };
}
