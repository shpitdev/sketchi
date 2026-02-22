"use node";

import { createHash } from "node:crypto";
import {
  captureMessage,
  flush,
  init,
  startSpan,
  withScope,
} from "@sentry/node";
import { appUrl, envLabel } from "../../lib/app-url";
import type {
  ExcalidrawPermission,
  ExcalidrawUrlSource,
  ShareUrlType,
} from "./excalidrawShareLinks";
import { createTraceId } from "./trace";

export type LogLevel = "info" | "warning" | "error";

export interface LogEvent extends Record<string, unknown> {
  actionName?: string;
  arrowCount?: number;
  attempt?: number;
  component?: string;
  durationMs?: number;
  elementCount?: number;
  env?: string;
  errorMessage?: string;
  errorName?: string;
  excalidrawPermission?: ExcalidrawPermission;
  excalidrawSource?: ExcalidrawUrlSource;
  intermediateEdgeCount?: number;
  intermediateNodeCount?: number;
  issuesCount?: number;
  iterations?: number;
  level?: "info" | "warn" | "error";
  maxAttempts?: number;
  message?: string;
  modelId?: string;
  op: string;
  promptHash?: string;
  promptLength?: number;
  provider?: string;
  release?: string | null;
  requestHash?: string;
  requestId?: string;
  requestLength?: number;
  retries?: number;
  sampled?: boolean;
  service?: string;
  severity?: "info" | "warn" | "error";
  shapeCount?: number;
  shareUrlType?: ShareUrlType;
  stage?: string;
  status?: "success" | "failed" | "warning";
  step?: number;
  stepCount?: number;
  stepDurationMs?: number;
  timeoutMs?: number;
  timestamp?: string;
  tokens?: number;
  toolCalls?: number;
  traceId: string;
}

type SpanAttributeValue = string | number | boolean;
type SpanAttributes = Record<string, SpanAttributeValue | undefined>;

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

function formatSentryMessage(event: LogEvent): string {
  const parts: string[] = [];

  const service = event.service ?? "convex";
  const component = event.component;

  parts.push(service);
  if (component) {
    parts.push(component);
  }

  parts.push(event.op);

  if (event.stage) {
    parts.push(`stage=${event.stage}`);
  }
  if (event.actionName) {
    parts.push(`action=${event.actionName}`);
  }
  if (event.status) {
    parts.push(`status=${event.status}`);
  }
  if (typeof event.durationMs === "number") {
    parts.push(`durMs=${Math.round(event.durationMs)}`);
  }
  if (event.modelId) {
    parts.push(`model=${event.modelId}`);
  }

  return clampMessage(parts.join(" ")) ?? event.op;
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

  const normalizedSeverity = level === "warning" ? "warn" : level;

  const base: LogEvent = {
    service: "convex",
    component: event.component ?? "convex-action",
    env: envLabel,
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
  const response = await fetch(telemetryUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-trace-id": event.traceId,
    },
    body: JSON.stringify({ level, ...event }),
  });
  if (!response.ok) {
    console.warn(
      "Telemetry proxy returned non-2xx:",
      response.status,
      event.traceId
    );
  }
}

function sendToSentry(event: LogEvent, level: LogLevel): void {
  initSentry();
  if (!sentryInitialized) {
    return;
  }
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
    if (event.stage) {
      scope.setTag("stage", event.stage);
    }
    if (event.actionName) {
      scope.setTag("action", event.actionName);
    }
    if (event.status) {
      scope.setTag("status", event.status);
    }
    scope.setContext("telemetry", event);
    captureMessage(message);
  });
}

export async function logEvent(
  event: LogEvent,
  options: { level?: LogLevel } = {}
): Promise<void> {
  try {
    const level = options.level ?? "info";
    const normalized = buildLogEvent(event, level);

    try {
      console.log(JSON.stringify(normalized));
    } catch {
      console.log(
        "[logEvent] Failed to serialize event",
        event?.op,
        event?.traceId
      );
    }

    if (!(SENTRY_CONVEX_ENABLED && normalized.sampled)) {
      return;
    }

    try {
      if (SENTRY_CONVEX_MODE === "proxy") {
        await sendToTelemetryProxy(normalized, level);
        return;
      }

      sendToSentry(normalized, level);
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: "convex",
          component: "observability",
          op: "logEvent.error",
          traceId: normalized.traceId,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      );
    }
  } catch (error) {
    console.warn("logEvent failed silently:", error);
  }
}

export function logEventSafely(...args: Parameters<typeof logEvent>): void {
  logEvent(...args).catch(() => {
    // Ignore logging failures to avoid breaking the main flow.
  });
}

export async function startSentrySpan<T>(
  params: { name: string; op: string; attributes?: SpanAttributes },
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
