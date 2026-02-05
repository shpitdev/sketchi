import { captureMessage, withScope } from "@sentry/nextjs";
import { createTraceId } from "@sketchi/shared";

export type LogLevel = "info" | "warning" | "error";

export interface ApiLogEvent extends Record<string, unknown> {
  traceId: string;
  service?: string;
  component?: string;
  op: string;
  status?: "success" | "failed" | "warning";
  durationMs?: number;
  requestLength?: number;
  requestHash?: string;
  responseStatus?: number;
  method?: string;
  path?: string;
  orpcRoute?: string;
  errorName?: string;
  errorMessage?: string;
  sampled?: boolean;
  env?: string;
  release?: string | null;
  timestamp?: string;
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

  return {
    service: "web",
    component: event.component ?? "orpc",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev",
    release: getRelease(),
    timestamp: new Date().toISOString(),
    ...event,
    traceId,
    errorMessage: clampMessage(event.errorMessage),
    sampled,
  };
}

function sendToSentry(event: ApiLogEvent, level: LogLevel) {
  withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("traceId", event.traceId);
    if (event.orpcRoute) {
      scope.setTag("orpc.route", event.orpcRoute);
    }
    scope.setContext("telemetry", event);
    captureMessage(event.op);
  });
}

export function logApiEvent(
  event: ApiLogEvent,
  options: { level?: LogLevel } = {}
): void {
  const level = options.level ?? "info";
  const normalized = buildLogEvent(event, level);

  console.log(JSON.stringify(normalized));

  if (level === "info" && !normalized.sampled) {
    return;
  }

  sendToSentry(normalized, level);
}
