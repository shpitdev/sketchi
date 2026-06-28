import "@tanstack/react-start/server-only";

import { waitUntil } from "cloudflare:workers";
import type { ArtifactFormat, ArtifactFormatRef } from "@sketchi/diagram-agent";

import type { StudioEnv } from "./agent.server";

const USAGE_PREFIX = "codemode/usage";
const USAGE_EVENT_SCHEMA = "sketchi.codemode.usage.v1";
const MAX_SNAPSHOT_BYTES = 1_000_000;

export type CodeModeUsageOperation =
  | "applyDiagramPatch"
  | "buildFlowchart"
  | "execute";

export type CodeModeUsageSurface = "api" | "mcp";

export interface CodeModeUsageContext {
  attemptId: string;
  eventId: string;
  runId: string;
}

export interface CodeModeUsageCaptureInput {
  context: CodeModeUsageContext;
  durationMs: number;
  env: StudioEnv;
  operation: CodeModeUsageOperation;
  request: Request;
  requestBody: unknown;
  responseBody: unknown;
  statusCode?: number;
  surface: CodeModeUsageSurface;
}

interface CodeModeUsageArtifactRef {
  artifactId: string;
  diagramId?: string;
  formats: ArtifactFormatRef[];
}

interface CodeModeUsageSnapshot {
  contentType: "application/json";
  omittedReason?: string;
  sizeBytes?: number;
  value?: unknown;
}

interface CodeModeUsageEvent {
  artifactRefs: CodeModeUsageArtifactRef[];
  attemptId: string;
  client: CodeModeUsageClient;
  durationMs: number;
  eventId: string;
  eventKey: string;
  eventTime: string;
  operation: CodeModeUsageOperation;
  request: CodeModeUsageRequestSummary;
  response: CodeModeUsageResponseSummary;
  runId: string;
  schema: typeof USAGE_EVENT_SCHEMA;
  status: "error" | "ok";
  statusCode?: number;
  surface: CodeModeUsageSurface;
}

interface CodeModeUsageClient {
  client?: string;
  harness?: string;
  model?: string;
  reasoningLevel?: string;
  scenarioId?: string;
  userAgent?: string;
}

interface CodeModeUsageRequestSummary {
  body: CodeModeUsageSnapshot;
  method: string;
  path: string;
}

interface CodeModeUsageResponseSummary {
  body: CodeModeUsageSnapshot;
}

export function createCodeModeUsageContext(
  request: Request,
): CodeModeUsageContext {
  return {
    attemptId:
      headerValue(request, "x-sketchi-attempt-id") ?? randomId("attempt"),
    eventId: randomId("event"),
    runId: headerValue(request, "x-sketchi-run-id") ?? randomId("run"),
  };
}

export function codeModeUsageResponseHeaders(
  context: CodeModeUsageContext,
): HeadersInit {
  return {
    "x-sketchi-attempt-id": context.attemptId,
    "x-sketchi-event-id": context.eventId,
    "x-sketchi-run-id": context.runId,
  };
}

export function captureCodeModeUsageEvent(
  input: CodeModeUsageCaptureInput,
): void {
  waitUntil(
    deferredCodeModeUsageCapture(input).catch((error: unknown) => {
      console.warn("Sketchi Code Mode usage capture failed.", error);
    }),
  );
}

async function deferredCodeModeUsageCapture(
  input: CodeModeUsageCaptureInput,
): Promise<void> {
  await nextTurn();
  await persistCodeModeUsageEvent(input);
}

async function persistCodeModeUsageEvent(
  input: CodeModeUsageCaptureInput,
): Promise<void> {
  const bucket = input.env.SKETCHI_ARTIFACTS;
  if (!bucket) {
    return;
  }

  const eventKey = keyForUsageEvent(input.context, "event.json");
  const event: CodeModeUsageEvent = {
    artifactRefs: artifactRefsFrom(input.responseBody),
    attemptId: input.context.attemptId,
    client: clientFromRequest(input.request),
    durationMs: input.durationMs,
    eventId: input.context.eventId,
    eventKey,
    eventTime: new Date().toISOString(),
    operation: input.operation,
    request: {
      body: snapshotFrom(input.requestBody),
      method: input.request.method,
      path: pathFromRequest(input.request),
    },
    response: {
      body: snapshotFrom(input.responseBody),
    },
    runId: input.context.runId,
    schema: USAGE_EVENT_SCHEMA,
    status: okFromResponse(input.responseBody) ? "ok" : "error",
    ...(input.statusCode === undefined ? {} : { statusCode: input.statusCode }),
    surface: input.surface,
  };

  await bucket.put(eventKey, JSON.stringify(event), {
    httpMetadata: { contentType: "application/json" },
  });
}

function snapshotFrom(value: unknown): CodeModeUsageSnapshot {
  const serialized = serializeSnapshot(value);

  if (!serialized) {
    return {
      contentType: "application/json",
      omittedReason: "not_json_serializable",
    };
  }

  const sizeBytes = byteSize(serialized);
  if (sizeBytes > MAX_SNAPSHOT_BYTES) {
    return {
      contentType: "application/json",
      omittedReason: "snapshot_too_large",
      sizeBytes,
    };
  }

  return {
    contentType: "application/json",
    sizeBytes,
    value,
  };
}

function artifactRefsFrom(value: unknown): CodeModeUsageArtifactRef[] {
  return uniqueArtifactRefs([
    ...artifactRefCandidates(value),
    ...artifactRefCandidates(recordValue(value, "result")),
    ...artifactRefCandidates(recordValue(value, "artifactDelivery")),
    ...artifactRefCandidates(recordValue(value, "artifact")),
    ...artifactRefCandidates(recordValue(value, "built")),
    ...artifactRefCandidates(recordValue(value, "patched")),
  ]);
}

function artifactRefCandidates(value: unknown): CodeModeUsageArtifactRef[] {
  if (!isRecord(value)) {
    return [];
  }

  const artifactId = stringValue(value.artifactId);
  const formats = artifactFormatsFrom(value.formats);
  if (!artifactId || formats.length === 0) {
    return [];
  }

  const diagramId = stringValue(value.diagramId);
  return [
    {
      artifactId,
      ...(diagramId ? { diagramId } : {}),
      formats,
    },
  ];
}

function artifactFormatsFrom(value: unknown): ArtifactFormatRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).flatMap((formatRef) => {
    const format = artifactFormatFrom(formatRef.format);
    const mimeType = stringValue(formatRef.mimeType);
    if (!format || !mimeType) {
      return [];
    }

    const sizeBytes = numberValue(formatRef.sizeBytes);
    const url = stringValue(formatRef.url);

    return [
      {
        format,
        mimeType,
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
        ...(url ? { url } : {}),
      },
    ];
  });
}

function uniqueArtifactRefs(
  refs: CodeModeUsageArtifactRef[],
): CodeModeUsageArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.artifactId)) {
      return false;
    }
    seen.add(ref.artifactId);
    return true;
  });
}

function clientFromRequest(request: Request): CodeModeUsageClient {
  const client: CodeModeUsageClient = {};
  const clientHeader = headerValue(request, "x-sketchi-client");
  const harness = headerValue(request, "x-sketchi-harness");
  const model = headerValue(request, "x-sketchi-model");
  const reasoningLevel = headerValue(request, "x-sketchi-reasoning-level");
  const scenarioId = headerValue(request, "x-sketchi-scenario-id");
  const userAgent = headerValue(request, "user-agent");

  if (clientHeader) {
    client.client = clientHeader;
  }
  if (harness) {
    client.harness = harness;
  }
  if (model) {
    client.model = model;
  }
  if (reasoningLevel) {
    client.reasoningLevel = reasoningLevel;
  }
  if (scenarioId) {
    client.scenarioId = scenarioId;
  }
  if (userAgent) {
    client.userAgent = userAgent;
  }

  return client;
}

function keyForUsageEvent(
  context: CodeModeUsageContext,
  fileName: "event.json",
): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");

  return [
    USAGE_PREFIX,
    String(year),
    month,
    day,
    context.runId,
    context.attemptId,
    context.eventId,
    fileName,
  ].join("/");
}

function pathFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function okFromResponse(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value.ok !== false && !stringValue(value.error);
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function artifactFormatFrom(value: unknown): ArtifactFormat | undefined {
  return value === "excalidraw" || value === "scene" || value === "png"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializeSnapshot(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.trim();
  return value ? value : undefined;
}

function randomId(prefix: "attempt" | "event" | "run"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
