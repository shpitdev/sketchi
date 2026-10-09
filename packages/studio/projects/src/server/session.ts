import { nanoid } from "nanoid";
import { Context, Effect, Layer, Option, Schema } from "effect";

import {
  AnonymousStudioAuthStatus,
  AnonymousStudioOwner,
  AnonymousStudioPublicSession,
  AnonymousStudioSessionIdSchema,
  AuthenticatedStudioAuthStatus,
  AuthenticatedStudioPublicSession,
  type StudioAuthStatus,
  type StudioOwner,
  type StudioPublicSession,
} from "../contracts.js";
import {
  failureMessage,
  StudioOwnershipError,
  type StudioResourceKind,
  StudioSessionError,
} from "./errors.js";

const STUDIO_SESSION_COOKIE = "sketchi_studio_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface StudioSessionResolution {
  auth: StudioAuthStatus;
  session: StudioOwner;
  publicSession: StudioPublicSession;
  setCookie?: string;
}

export interface StudioSessionServiceShape {
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
      ? AuthenticatedStudioPublicSession.make({
          displayName: session.displayName,
          kind: "authenticated",
        })
      : AuthenticatedStudioPublicSession.make({ kind: "authenticated" });
  }

  return AnonymousStudioPublicSession.make({ kind: "anonymous" });
}

function authStatus(session: StudioOwner): StudioAuthStatus {
  if (session.kind === "authenticated") {
    return session.displayName
      ? AuthenticatedStudioAuthStatus.make({
          displayName: session.displayName,
          status: "authenticated",
        })
      : AuthenticatedStudioAuthStatus.make({ status: "authenticated" });
  }

  return AnonymousStudioAuthStatus.make({
    message:
      "Studio persistence is using an anonymous session cookie until product auth is wired.",
    status: "anonymous",
  });
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
      return value.length > 0 ? value : undefined;
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
  createSessionId: () => string = () => `anon_${nanoid(24)}`,
): StudioSessionResolution {
  const existingSessionId = Schema.decodeUnknownOption(
    AnonymousStudioSessionIdSchema,
  )(cookieValue(request, STUDIO_SESSION_COOKIE));

  if (Option.isSome(existingSessionId)) {
    const session = AnonymousStudioOwner.make({
      kind: "anonymous",
      sessionId: existingSessionId.value,
    });
    return {
      auth: authStatus(session),
      publicSession: publicSession(session),
      session,
    };
  }

  const session = AnonymousStudioOwner.make({
    kind: "anonymous",
    sessionId: Schema.decodeUnknownSync(AnonymousStudioSessionIdSchema)(
      createSessionId(),
    ),
  });

  return {
    auth: authStatus(session),
    publicSession: publicSession(session),
    session,
    setCookie: sessionCookie(session.sessionId, request),
  };
}

export function ensureOwner(
  actual: StudioOwner,
  expected: StudioOwner,
  resource: StudioResourceKind,
  id: string,
): Effect.Effect<void, StudioOwnershipError> {
  return studioOwnersMatch(actual, expected)
    ? Effect.void
    : Effect.fail(StudioOwnershipError.make({ id, resource }));
}

function makeStudioSessionService(createSessionId: () => string) {
  return StudioSessionService.of({
    resolve: Effect.fn("studioPersistence.session.resolve")(function* (
      request: Request,
    ) {
      return yield* Effect.try({
        try: () => resolveStudioSession(request, createSessionId),
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
}

export const StudioSessionServiceLive = Layer.succeed(
  StudioSessionService,
  makeStudioSessionService(() => `anon_${nanoid(24)}`),
);

export function makeStudioSessionServiceLayer(options: {
  readonly createSessionId: () => string;
}) {
  return Layer.succeed(
    StudioSessionService,
    makeStudioSessionService(options.createSessionId),
  );
}
