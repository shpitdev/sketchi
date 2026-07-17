import "@tanstack/react-start/server-only";

import { waitUntil } from "cloudflare:workers";
import type { ArtifactFormat, ArtifactFormatRef } from "@sketchi/diagram-agent";

import type { StudioEnv } from "../bindings/studio-env.server";

const USAGE_PREFIX = "codemode/usage";
const USAGE_EVENT_SCHEMA = "sketchi.codemode.usage.v1";
const MAX_SNAPSHOT_BYTES = 1_000_000;
const MAX_ISSUE_DEPTH = 8;
const MAX_ISSUE_ROWS = 100;

export type CodeModeUsageOperation =
  | "applyDiagramPatch"
  | "buildFlowchart"
  | "buildMindmap"
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

interface CodeModeUsageIssueSummary {
  code: string;
  message?: string;
  path: string;
  severity?: string;
  stage?: string;
}

interface CodeModeUsageAnalyticsRow {
  artifact_count: number;
  artifact_delivery: boolean;
  artifact_formats?: string;
  attempt_id: string;
  client?: string;
  duration_ms: number;
  error_message?: string;
  event_date: string;
  event_id: string;
  event_key: string;
  event_time: string;
  harness?: string;
  issue_codes?: string;
  issue_count: number;
  model?: string;
  operation: CodeModeUsageOperation;
  reasoning_level?: string;
  request_method: string;
  request_omitted_reason?: string;
  request_path: string;
  request_snapshot_bytes?: number;
  response_omitted_reason?: string;
  response_snapshot_bytes?: number;
  run_id: string;
  scenario_id?: string;
  schema: typeof USAGE_EVENT_SCHEMA;
  status: "error" | "ok";
  status_code?: number;
  surface: CodeModeUsageSurface;
  user_agent?: string;
}

interface CodeModeUsageIssueAnalyticsRow {
  attempt_id: string;
  event_date: string;
  event_id: string;
  event_key: string;
  event_time: string;
  issue_code: string;
  issue_message?: string;
  issue_path: string;
  issue_severity?: string;
  issue_stage?: string;
  operation: CodeModeUsageOperation;
  run_id: string;
  schema: typeof USAGE_EVENT_SCHEMA;
  status: "error" | "ok";
  surface: CodeModeUsageSurface;
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
  const event = codeModeUsageEventFromInput(input);
  const writes: Promise<unknown>[] = [
    sendCodeModeUsageAnalytics(input.env, event, input.responseBody),
  ];

  if (input.env.SKETCHI_ARTIFACTS) {
    writes.push(
      input.env.SKETCHI_ARTIFACTS.put(event.eventKey, JSON.stringify(event), {
        httpMetadata: { contentType: "application/json" },
      }),
    );
  }

  await Promise.all(writes);
}

function codeModeUsageEventFromInput(
  input: CodeModeUsageCaptureInput,
): CodeModeUsageEvent {
  const eventKey = keyForUsageEvent(input.context, "event.json");

  return {
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
}

async function sendCodeModeUsageAnalytics(
  env: StudioEnv,
  event: CodeModeUsageEvent,
  responseBody: unknown,
): Promise<void> {
  const issueSummaries = issueSummariesFrom(responseBody);
  const writes: Promise<void>[] = [];

  if (env.CODEMODE_USAGE_EVENTS) {
    writes.push(
      env.CODEMODE_USAGE_EVENTS.send([
        analyticsRowFrom(event, responseBody, issueSummaries),
      ]),
    );
  }

  if (env.CODEMODE_USAGE_ISSUES && issueSummaries.length > 0) {
    writes.push(
      env.CODEMODE_USAGE_ISSUES.send(
        issueSummaries.map((issue) => issueAnalyticsRowFrom(event, issue)),
      ),
    );
  }

  await Promise.all(writes);
}

function analyticsRowFrom(
  event: CodeModeUsageEvent,
  responseBody: unknown,
  issueSummaries: CodeModeUsageIssueSummary[],
): CodeModeUsageAnalyticsRow {
  const eventDate = event.eventTime.slice(0, 10);
  const issueCodes = joinedUnique(issueSummaries.map((issue) => issue.code));
  const artifactFormats = joinedUnique(
    event.artifactRefs.flatMap((ref) =>
      ref.formats.map((formatRef) => formatRef.format),
    ),
  );
  const errorMessage =
    stringValue(recordValue(responseBody, "error")) ??
    issueSummaries.find((issue) => Boolean(issue.message))?.message;

  return {
    artifact_count: event.artifactRefs.length,
    artifact_delivery: isRecord(recordValue(responseBody, "artifactDelivery")),
    ...(artifactFormats ? { artifact_formats: artifactFormats } : {}),
    attempt_id: event.attemptId,
    ...(event.client.client ? { client: event.client.client } : {}),
    duration_ms: event.durationMs,
    ...(errorMessage ? { error_message: errorMessage } : {}),
    event_date: eventDate,
    event_id: event.eventId,
    event_key: event.eventKey,
    event_time: event.eventTime,
    ...(event.client.harness ? { harness: event.client.harness } : {}),
    ...(issueCodes ? { issue_codes: issueCodes } : {}),
    issue_count: issueSummaries.length,
    ...(event.client.model ? { model: event.client.model } : {}),
    operation: event.operation,
    ...(event.client.reasoningLevel
      ? { reasoning_level: event.client.reasoningLevel }
      : {}),
    request_method: event.request.method,
    ...(event.request.body.omittedReason
      ? { request_omitted_reason: event.request.body.omittedReason }
      : {}),
    request_path: event.request.path,
    ...(event.request.body.sizeBytes === undefined
      ? {}
      : { request_snapshot_bytes: event.request.body.sizeBytes }),
    ...(event.response.body.omittedReason
      ? { response_omitted_reason: event.response.body.omittedReason }
      : {}),
    ...(event.response.body.sizeBytes === undefined
      ? {}
      : { response_snapshot_bytes: event.response.body.sizeBytes }),
    run_id: event.runId,
    ...(event.client.scenarioId
      ? { scenario_id: event.client.scenarioId }
      : {}),
    schema: event.schema,
    status: event.status,
    ...(event.statusCode === undefined
      ? {}
      : { status_code: event.statusCode }),
    surface: event.surface,
    ...(event.client.userAgent ? { user_agent: event.client.userAgent } : {}),
  };
}

function issueAnalyticsRowFrom(
  event: CodeModeUsageEvent,
  issue: CodeModeUsageIssueSummary,
): CodeModeUsageIssueAnalyticsRow {
  return {
    attempt_id: event.attemptId,
    event_date: event.eventTime.slice(0, 10),
    event_id: event.eventId,
    event_key: event.eventKey,
    event_time: event.eventTime,
    issue_code: issue.code,
    ...(issue.message ? { issue_message: issue.message } : {}),
    issue_path: issue.path,
    ...(issue.severity ? { issue_severity: issue.severity } : {}),
    ...(issue.stage ? { issue_stage: issue.stage } : {}),
    operation: event.operation,
    run_id: event.runId,
    schema: event.schema,
    status: event.status,
    surface: event.surface,
  };
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

function issueSummariesFrom(value: unknown): CodeModeUsageIssueSummary[] {
  const summaries: CodeModeUsageIssueSummary[] = [];
  collectIssueSummaries(value, "response", summaries, 0);
  return summaries;
}

function collectIssueSummaries(
  value: unknown,
  path: string,
  summaries: CodeModeUsageIssueSummary[],
  depth: number,
): void {
  if (depth > MAX_ISSUE_DEPTH || summaries.length >= MAX_ISSUE_ROWS) {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectIssueSummaries(item, `${path}[${index}]`, summaries, depth + 1);
      if (summaries.length >= MAX_ISSUE_ROWS) {
        return;
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const summary = issueSummaryFromRecord(value, path);
  if (summary) {
    summaries.push(summary);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectIssueSummaries(child, childPath(path, key), summaries, depth + 1);
    if (summaries.length >= MAX_ISSUE_ROWS) {
      return;
    }
  }
}

function issueSummaryFromRecord(
  value: Record<string, unknown>,
  path: string,
): CodeModeUsageIssueSummary | undefined {
  const code = stringValue(value.code);
  const message = stringValue(value.message);
  const severity = stringValue(value.severity);
  const stage = stringValue(value.stage);

  if (!code || (!message && !severity && !stage)) {
    return undefined;
  }

  return {
    code,
    ...(message ? { message } : {}),
    path,
    ...(severity ? { severity } : {}),
    ...(stage ? { stage } : {}),
  };
}

function childPath(parent: string, key: string): string {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) {
    return `${parent}.${key}`;
  }

  return `${parent}[${JSON.stringify(key)}]`;
}

function joinedUnique(values: string[]): string | undefined {
  const joined = [...new Set(values)].filter(Boolean).join(",");
  return joined.length > 0 ? joined : undefined;
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
