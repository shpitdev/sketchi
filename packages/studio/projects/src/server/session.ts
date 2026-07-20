import { nanoid } from "nanoid";
import { Context, Effect, Layer } from "effect";

import type {
  StudioAuthStatus,
  StudioOwner,
  StudioPublicSession,
} from "../contracts.js";
import {
  failureMessage,
  StudioOwnershipError,
  type StudioResourceKind,
  StudioSessionError,
} from "./errors.js";

const STUDIO_SESSION_COOKIE = "sketchi_studio_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const ANONYMOUS_SESSION_PATTERN = /^anon_[a-zA-Z0-9_-]{12,64}$/;

export interface StudioSessionResolution {
  auth: StudioAuthStatus;
  session: StudioOwner;
  publicSession: StudioPublicSession;
  setCookie?: string;
}

export interface StudioSessionServiceShape {
  readonly ensureOwner: (
    actual: StudioOwner,
    expected: StudioOwner,
    resource: StudioResourceKind,
    id: string,
  ) => Effect.Effect<void, StudioOwnershipError>;
  readonly resolve: (
    request: Request,
  ) => Effect.Effect<StudioSessionResolution, StudioSessionError>;
}

export class StudioSessionService extends Context.Service<
  StudioSessionService,
  StudioSessionServiceShape
>()("@sketchi/studio-projects/StudioSessionService") {}

function publicSession(session: StudioOwner): StudioPublicSession {
  if (session.kind === "authenticated") {
    return session.displayName
      ? { displayName: session.displayName, kind: "authenticated" }
      : { kind: "authenticated" };
  }

  return { kind: "anonymous" };
}

function authStatus(session: StudioOwner): StudioAuthStatus {
  if (session.kind === "authenticated") {
    return session.displayName
      ? { displayName: session.displayName, status: "authenticated" }
      : { status: "authenticated" };
  }

  return {
    message:
      "Studio persistence is using an anonymous session cookie until product auth is wired.",
    status: "anonymous",
  };
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("Cookie");
  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      const value = rawValue.join("=");
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }

  return undefined;
}

function sessionCookie(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STUDIO_SESSION_COOKIE}=${encodeURIComponent(
    sessionId,
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}${secure}`;
}

export function createAuthenticatedStudioSession(input: {
  displayName?: string;
  subjectId: string;
}): StudioOwner {
  return input.displayName
    ? {
        displayName: input.displayName,
        kind: "authenticated",
        subjectId: input.subjectId,
      }
    : {
        kind: "authenticated",
        subjectId: input.subjectId,
      };
}

export function studioOwnersMatch(
  left: StudioOwner,
  right: StudioOwner,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "authenticated" && right.kind === "authenticated") {
    return left.subjectId === right.subjectId;
  }

  return left.kind === "anonymous" && right.kind === "anonymous"
    ? left.sessionId === right.sessionId
    : false;
}

export function resolveStudioSession(
  request: Request,
): StudioSessionResolution {
  const existingSessionId = cookieValue(request, STUDIO_SESSION_COOKIE);

  if (existingSessionId && ANONYMOUS_SESSION_PATTERN.test(existingSessionId)) {
    const session: StudioOwner = {
      kind: "anonymous",
      sessionId: existingSessionId,
    };
    return {
      auth: authStatus(session),
      publicSession: publicSession(session),
      session,
    };
  }

  const session: StudioOwner = {
    kind: "anonymous",
    sessionId: `anon_${nanoid(24)}`,
  };

  return {
    auth: authStatus(session),
    publicSession: publicSession(session),
    session,
    setCookie: sessionCookie(session.sessionId, request),
  };
}

export const StudioSessionServiceLive = Layer.succeed(StudioSessionService, {
  ensureOwner: Effect.fn("studioPersistence.session.ensureOwner")(function* (
    actual: StudioOwner,
    expected: StudioOwner,
    resource: StudioResourceKind,
    id: string,
  ) {
    if (!studioOwnersMatch(actual, expected)) {
      return yield* Effect.fail(StudioOwnershipError.make({ id, resource }));
    }
  }),
  resolve: Effect.fn("studioPersistence.session.resolve")(function* (
    request: Request,
  ) {
    return yield* Effect.try({
      try: () => resolveStudioSession(request),
      catch: (cause) =>
        StudioSessionError.make({
          cause,
          message: failureMessage(
            cause,
            "Studio session could not be resolved.",
          ),
        }),
    });
  }),
});

export function makeStudioSessionServiceTestLayer(
  service: StudioSessionServiceShape,
) {
  return Layer.succeed(StudioSessionService, service);
}
