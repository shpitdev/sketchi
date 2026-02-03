import { createHash } from "node:crypto";
import {
  captureMessage,
  flush,
  init,
  startSpan,
  withScope,
} from "@sentry/node";
import { createTraceId } from "@sketchi/shared";
import { appUrl, envLabel } from "../../lib/app-url";
import type { ShareUrlType } from "./excalidrawShareLinks";

export type LogLevel = "info" | "warning" | "error";

export interface LogEvent extends Record<string, unknown> {
  traceId: string;
  requestId?: string;
  service?: string;
  component?: string;
  op: string;
  stage?: string;
  actionName?: string;
  status?: "success" | "failed" | "warning";
  durationMs?: number;
  promptLength?: number;
  promptHash?: string;
  requestLength?: number;
  requestHash?: string;
  intermediateNodeCount?: number;
  intermediateEdgeCount?: number;
  elementCount?: number;
  shapeCount?: number;
  arrowCount?: number;
  shareUrlType?: ShareUrlType;
  modelId?: string;
  provider?: string;
  tokens?: number;
  iterations?: number;
  retries?: number;
  attempt?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  errorName?: string;
  errorMessage?: string;
  issuesCount?: number;
  step?: number;
  stepCount?: number;
  stepDurationMs?: number;
  toolCalls?: number;
  sampled?: boolean;
  env?: string;
  release?: string | null;
  timestamp?: string;
}

const SENTRY_CONVEX_ENABLED = process.env.SENTRY_CONVEX_ENABLED === "1";
const SENTRY_CONVEX_MODE =
  (process.env.SENTRY_CONVEX_MODE ?? "direct").toLowerCase() === "proxy"
    ? "proxy"
    : "direct";
const SENTRY_DSN = process.env.SENTRY_DSN;
const rawSampleRate = Number(process.env.SENTRY_LOG_SAMPLE_RATE ?? "0.1");
const SENTRY_LOG_SAMPLE_RATE = Number.isFinite(rawSampleRate)
  ? rawSampleRate
  : 0.1;
const MAX_MESSAGE_LENGTH = 512;

let sentryInitialized = false;

function getRelease(): string | null {
  return (
    process.env.SENTRY_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_REF ??
    null
  );
}

function clampMessage(message?: string): string | undefined {
  if (!message) {
    return message;
  }
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

export function hashString(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return createHash("sha256").update(value).digest("hex");
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

function buildLogEvent(event: LogEvent, level: LogLevel): LogEvent {
  const traceId = event.traceId || createTraceId();
  const sampled =
    level === "info" ? shouldSample(traceId, SENTRY_LOG_SAMPLE_RATE) : true;

  return {
    service: "convex",
    component: event.component ?? "convex-action",
    env: envLabel,
    release: getRelease(),
    timestamp: new Date().toISOString(),
    ...event,
    traceId,
    errorMessage: clampMessage(event.errorMessage),
    sampled,
  };
}

function initSentry() {
  if (!(SENTRY_CONVEX_ENABLED && SENTRY_DSN)) {
    return;
  }
  if (sentryInitialized) {
    return;
  }
  init({
    dsn: SENTRY_DSN,
    environment: envLabel,
    enableLogs: true,
    tracesSampleRate: 1,
  });
  sentryInitialized = true;
}

async function sendToTelemetryProxy(
  event: LogEvent,
  level: LogLevel
): Promise<void> {
  const telemetryUrl =
    process.env.SKETCHI_TELEMETRY_URL ?? `${appUrl}/api/telemetry`;
  if (!telemetryUrl) {
    return;
  }
  await fetch(telemetryUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-id": event.traceId,
    },
    body: JSON.stringify({ level, ...event }),
  });
}

function sendToSentry(event: LogEvent, level: LogLevel): void {
  initSentry();
  if (!sentryInitialized) {
    return;
  }
  withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("traceId", event.traceId);
    scope.setContext("telemetry", event);
    captureMessage(event.op);
  });
}

export async function logEvent(
  event: LogEvent,
  options: { level?: LogLevel } = {}
): Promise<void> {
  const level = options.level ?? "info";
  const normalized = buildLogEvent(event, level);

  console.log(JSON.stringify(normalized));

  if (!(SENTRY_CONVEX_ENABLED && normalized.sampled)) {
    return;
  }

  if (SENTRY_CONVEX_MODE === "proxy") {
    await sendToTelemetryProxy(normalized, level);
    return;
  }

  sendToSentry(normalized, level);
}

export async function startSentrySpan<T>(
  params: { name: string; op: string; attributes?: Record<string, unknown> },
  fn: () => Promise<T>
): Promise<T> {
  initSentry();
  if (sentryInitialized && typeof startSpan === "function") {
    return await startSpan(
      {
        name: params.name,
        op: params.op,
        attributes: params.attributes,
      },
      fn
    );
  }
  return await fn();
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  initSentry();
  if (sentryInitialized) {
    await flush(timeoutMs);
  }
}
