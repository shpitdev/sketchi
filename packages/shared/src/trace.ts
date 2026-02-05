export type TraceStatus = "success" | "failed" | "warning";

export interface TraceContext {
  traceId: string;
  requestId?: string;
  action?: string;
  stage?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  tokens?: number;
  iterations?: number;
  status?: TraceStatus;
}

const TRACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTraceId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeTraceId(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return TRACE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function coerceTraceId(value?: string | null): string {
  return normalizeTraceId(value) ?? createTraceId();
}
