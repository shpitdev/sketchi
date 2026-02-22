import { captureMessage, flush, withScope } from "@sentry/nextjs";
import { createTraceId } from "@sketchi/shared";

export type LogLevel = "info" | "warning" | "error";

export interface ApiLogEvent extends Record<string, unknown> {
  component?: string;
  durationMs?: number;
  env?: string;
  errorMessage?: string;
  errorName?: string;
  level?: "info" | "warn" | "error";
  message?: string;
  method?: string;
  op: string;
  orpcRoute?: string;
  path?: string;
  release?: string | null;
  requestHash?: string;
  requestLength?: number;
  responseStatus?: number;
  sampled?: boolean;
  service?: string;
  severity?: "info" | "warn" | "error";
  status?: "success" | "failed" | "warning";
  timestamp?: string;
  traceId: string;
}

const MAX_MESSAGE_LENGTH = 512;

const rawSampleRate = Number(process.env.SENTRY_LOG_SAMPLE_RATE ?? "0.1");
const SAMPLE_RATE = Number.isFinite(rawSampleRate) ? rawSampleRate : 0.1;
const TRAILING_SLASH_PATTERN = /\/+$/;

function clampMessage(message?: string): string | undefined {
  if (!message) {
    return message;
  }
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

function formatSentryMessage(event: ApiLogEvent): string {
  const parts: string[] = [];

  const service = event.service ?? "web";
  const component = event.component;

  parts.push(service);
  if (component) {
    parts.push(component);
  }
  parts.push(event.op);

  if (event.orpcRoute) {
    parts.push(`route=${event.orpcRoute}`);
  }
  if (event.method) {
    parts.push(event.method);
  }
  if (event.path) {
    parts.push(event.path);
  }
  if (typeof event.responseStatus === "number") {
    parts.push(`status=${event.responseStatus}`);
  }
  if (event.status) {
    parts.push(`result=${event.status}`);
  }
  if (typeof event.durationMs === "number") {
    parts.push(`durMs=${Math.round(event.durationMs)}`);
  }

  return clampMessage(parts.join(" ")) ?? event.op;
}

function getRelease(): string | null {
  return (
    process.env.SENTRY_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_REF ??
    null
  );
}

function shouldSample(traceId: string, sampleRate: number): boolean {
  if (!(sampleRate > 0 && sampleRate < 1)) {
    return sampleRate >= 1;
  }
  let hash = 0;
  for (let i = 0; i < traceId.length; i += 1) {
    hash = (hash * 31 + traceId.charCodeAt(i)) % 1_000_000_007;
  }
  const bucket = hash % 10_000;
  return bucket / 10_000 < sampleRate;
}

export function getOrpcRouteTag(pathname: string): string | null {
  const trimmed = pathname.replace(TRAILING_SLASH_PATTERN, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const withoutApi = parts[0] === "api" ? parts.slice(1) : parts;
  if (withoutApi.length >= 2) {
    return `${withoutApi[0]}.${withoutApi[1]}`;
  }
  return withoutApi[0] ?? null;
}

export async function hashString(
  value?: string | null
): Promise<string | null> {
  if (!value) {
    return null;
  }
  if (!globalThis.crypto?.subtle) {
    return null;
  }
  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildLogEvent(event: ApiLogEvent, level: LogLevel): ApiLogEvent {
  const traceId = event.traceId || createTraceId();
  const sampled = level === "info" ? shouldSample(traceId, SAMPLE_RATE) : true;

  const normalizedSeverity = level === "warning" ? "warn" : level;

  const base: ApiLogEvent = {
    service: "web",
    component: event.component ?? "orpc",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev",
    release: getRelease(),
    timestamp: new Date().toISOString(),
    ...event,
    traceId,
    errorMessage: clampMessage(event.errorMessage),
    sampled,
    severity: normalizedSeverity,
    level: normalizedSeverity,
  };

  return {
    ...base,
    message: base.message ?? formatSentryMessage(base),
  };
}

function sendToSentry(event: ApiLogEvent, level: LogLevel) {
  const message = formatSentryMessage(event);
  withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("traceId", event.traceId);
    if (event.service) {
      scope.setTag("service", event.service);
    }
    if (event.component) {
      scope.setTag("component", event.component);
    }
    scope.setTag("op", event.op);
    if (event.orpcRoute) {
      scope.setTag("orpc.route", event.orpcRoute);
    }
    if (event.method) {
      scope.setTag("http.method", event.method);
    }
    if (typeof event.responseStatus === "number") {
      scope.setTag("http.status_code", String(event.responseStatus));
    }
    if (event.status) {
      scope.setTag("status", event.status);
    }
    scope.setContext("telemetry", event);
    captureMessage(message);
  });
}

export function logApiEvent(
  event: ApiLogEvent,
  options: { level?: LogLevel } = {}
): Promise<void> {
  const level = options.level ?? "info";
  const normalized = buildLogEvent(event, level);

  console.log(JSON.stringify(normalized));

  if (level === "info" && !normalized.sampled) {
    return Promise.resolve();
  }

  sendToSentry(normalized, level);

  if (level === "info") {
    return Promise.resolve();
  }

  // Route handlers on serverless platforms may terminate immediately after the
  // response is returned. Flushing on warning/error makes these events far more
  // reliable (call sites can choose to await this).
  return flush(2000)
    .then(() => undefined)
    .catch(() => undefined);
}
