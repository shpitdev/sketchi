import { nanoid } from "nanoid";

import type {
  StudioAuthStatus,
  StudioOwner,
  StudioPublicSession,
} from "../contracts.js";

const STUDIO_SESSION_COOKIE = "sketchi_studio_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const ANONYMOUS_SESSION_PATTERN = /^anon_[a-zA-Z0-9_-]{12,64}$/;

export interface StudioSessionResolution {
  auth: StudioAuthStatus;
  session: StudioOwner;
  publicSession: StudioPublicSession;
  setCookie?: string;
}

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
