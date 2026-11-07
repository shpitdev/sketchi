import "@tanstack/react-start/server-only";

import type { ArtifactFormat, ArtifactFormatRef } from "@sketchi/diagram-agent";
import { SpanContent } from "@sketchi/observability";
import { Context, Effect, Layer } from "effect";

import { PlaygroundIds, PlaygroundRequestMetadata } from "../runtime/context.server";

const MAX_ISSUE_DEPTH = 8;

/** A Code Mode call's usage summary: one row of the `usage_events` view. */
export const USAGE_EVENT_ATTRIBUTE = "sketchi.usage.event";
/** The issues a Code Mode call reported: the rows of the `usage_issues` view. */
export const USAGE_ISSUES_ATTRIBUTE = "sketchi.usage.issues";

export type CodeModeUsageOperation =
	| "applyDiagramPatch"
	| "buildFlowchart"
	| "buildMindmap"
	| "buildSequenceDiagram"
	| "buildTimeline"
	| "buildChart"
	| "buildStateMachine"
	| "buildGantt"
	| "buildErDiagram"
	| "buildClassDiagram"
	| "buildOrgChart"
	| "buildVennDiagram"
	| "buildJourneyMap"
	| "buildSankey"
	| "buildWireframe"
	| "buildQuadrantChart"
	| "createCanvas"
	| "execute"
	| "generateDiagram";

export type CodeModeUsageSurface = "api" | "mcp";

export interface CodeModeUsageContext {
	attemptId: string;
	eventId: string;
	runId: string;
}

export interface CodeModeUsageCaptureInput {
	context: CodeModeUsageContext;
	durationMs: number;
	operation: CodeModeUsageOperation;
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

interface CodeModeUsageClient {
	client?: string;
	harness?: string;
	model?: string;
	reasoningLevel?: string;
	scenarioId?: string;
	userAgent?: string;
}

interface CodeModeUsageIssueSummary {
	code: string;
	message?: string;
	path: string;
	severity?: string;
	stage?: string;
}

/** The fields the `usage_events` view reads from a capture span. */
export interface CodeModeUsageEvent {
	artifact_count: number;
	artifact_delivery: boolean;
	artifact_formats?: string;
	artifacts: CodeModeUsageArtifactRef[];
	attempt_id: string;
	client?: string;
	duration_ms: number;
	error_message?: string;
	event_id: string;
	harness?: string;
	issue_codes?: string;
	issue_count: number;
	model?: string;
	operation: CodeModeUsageOperation;
	reasoning_level?: string;
	request_method: string;
	request_path: string;
	run_id: string;
	scenario_id?: string;
	status: "error" | "ok";
	status_code?: number;
	surface: CodeModeUsageSurface;
	user_agent?: string;
}

export interface PlaygroundCodeModeUsageShape {
	readonly capture: (
		input: CodeModeUsageCaptureInput,
	) => Effect.Effect<void, never, PlaygroundRequestMetadata>;
	readonly createContext: Effect.Effect<
		CodeModeUsageContext,
		never,
		PlaygroundIds | PlaygroundRequestMetadata
	>;
}

export class PlaygroundCodeModeUsage extends Context.Service<
	PlaygroundCodeModeUsage,
	PlaygroundCodeModeUsageShape
>()("@sketchi/playground/PlaygroundCodeModeUsage") {}

/** The request's run and attempt, and a new event for this call. */
const createCodeModeUsageContext = Effect.fn("playground.codeModeUsage.createContext")(
	function* () {
		const ids = yield* PlaygroundIds;
		const metadata = yield* PlaygroundRequestMetadata;
		return {
			attemptId: metadata.attemptId,
			eventId: ids.create("event"),
			runId: metadata.runId,
		};
	},
);

export function codeModeUsageResponseHeaders(context: CodeModeUsageContext): HeadersInit {
	return {
		"x-sketchi-attempt-id": context.attemptId,
		"x-sketchi-event-id": context.eventId,
		"x-sketchi-run-id": context.runId,
	};
}

/**
 * Records one Code Mode call on its span: the usage summary, every issue it
 * reported, and the full request and response.
 */
const captureCodeModeUsageEvent = Effect.fn("playground.codeModeUsage.capture")(function* (
	input: CodeModeUsageCaptureInput,
) {
	const metadata = yield* PlaygroundRequestMetadata;
	const issues = issueSummariesFrom(input.responseBody);
	yield* Effect.annotateCurrentSpan({
		operation: input.operation,
		surface: input.surface,
		[USAGE_EVENT_ATTRIBUTE]: usageEventFrom(input, metadata.request, issues),
		[USAGE_ISSUES_ATTRIBUTE]: issues,
		[SpanContent.input]: input.requestBody,
		[SpanContent.output]: input.responseBody,
	});
});

export const PlaygroundCodeModeUsageLive = Layer.succeed(PlaygroundCodeModeUsage, {
	capture: captureCodeModeUsageEvent,
	createContext: createCodeModeUsageContext(),
});

export function usageEventFrom(
	input: CodeModeUsageCaptureInput,
	request: Request,
	issues: readonly CodeModeUsageIssueSummary[],
): CodeModeUsageEvent {
	const { responseBody } = input;
	const artifacts = artifactRefsFrom(responseBody);
	const client = clientFromRequest(request);
	const issueCodes = joinedUnique(issues.map((issue) => issue.code));
	const artifactFormats = joinedUnique(
		artifacts.flatMap((ref) => ref.formats.map((formatRef) => formatRef.format)),
	);
	const errorMessage =
		stringValue(recordValue(responseBody, "error")) ??
		issues.find((issue) => Boolean(issue.message))?.message;

	return {
		artifact_count: artifacts.length,
		artifact_delivery: isRecord(recordValue(responseBody, "artifactDelivery")),
		...(artifactFormats ? { artifact_formats: artifactFormats } : {}),
		artifacts,
		attempt_id: input.context.attemptId,
		...(client.client ? { client: client.client } : {}),
		duration_ms: input.durationMs,
		...(errorMessage ? { error_message: errorMessage } : {}),
		event_id: input.context.eventId,
		...(client.harness ? { harness: client.harness } : {}),
		...(issueCodes ? { issue_codes: issueCodes } : {}),
		issue_count: issues.length,
		...(client.model ? { model: client.model } : {}),
		operation: input.operation,
		...(client.reasoningLevel ? { reasoning_level: client.reasoningLevel } : {}),
		request_method: request.method,
		request_path: pathFromRequest(request),
		run_id: input.context.runId,
		...(client.scenarioId ? { scenario_id: client.scenarioId } : {}),
		status: okFromResponse(responseBody) ? "ok" : "error",
		...(input.statusCode === undefined ? {} : { status_code: input.statusCode }),
		surface: input.surface,
		...(client.userAgent ? { user_agent: client.userAgent } : {}),
	};
}

function artifactRefsFrom(value: unknown): CodeModeUsageArtifactRef[] {
	const builds = recordValue(value, "builds");
	return uniqueArtifactRefs([
		...(Array.isArray(builds)
			? builds.flatMap((build) => [
					...artifactRefCandidates(recordValue(build, "artifact")),
					...artifactRefCandidates(recordValue(build, "partial")),
				])
			: []),
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

function uniqueArtifactRefs(refs: CodeModeUsageArtifactRef[]): CodeModeUsageArtifactRef[] {
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
	const builds = recordValue(value, "builds");
	if (!isRecord(value) || !Array.isArray(builds)) {
		collectIssueSummaries(value, "response", summaries, 0);
		return summaries;
	}
	// Receipts are canonical; preserve distinct attempts even when their issues are identical.
	const receipts = builds.filter(isRecord);
	collectIssueSummaries(builds, "response.builds", summaries, 1);
	for (const [key, child] of Object.entries(value)) {
		if (key !== "builds")
			collectIssueSummaries(child, childPath("response", key), summaries, 1, receipts);
	}
	return summaries;
}

function copiesBuildReceipt(
	value: Record<string, unknown>,
	receipts: readonly Record<string, unknown>[],
): boolean {
	return receipts.some((receipt) => {
		if (typeof value.buildId === "string") return value.buildId === receipt.buildId;
		// Invalid input may fail before an id is assigned. Match the complete diagnostic envelope.
		if (
			receipt.buildId !== undefined ||
			value.ok !== receipt.ok ||
			value.status !== receipt.status ||
			!Array.isArray(value.issues)
		)
			return false;
		const issues = serializeSnapshot(value.issues);
		return issues !== undefined && issues === serializeSnapshot(receipt.issues);
	});
}

function collectIssueSummaries(
	value: unknown,
	path: string,
	summaries: CodeModeUsageIssueSummary[],
	depth: number,
	receipts: readonly Record<string, unknown>[] = [],
): void {
	if (depth > MAX_ISSUE_DEPTH) {
		return;
	}

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			collectIssueSummaries(item, `${path}[${index}]`, summaries, depth + 1, receipts);
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

	const copiedBuild = copiesBuildReceipt(value, receipts);
	for (const [key, child] of Object.entries(value)) {
		if (copiedBuild && (key === "issues" || key === "quality")) continue;
		collectIssueSummaries(child, childPath(path, key), summaries, depth + 1, receipts);
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
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function artifactFormatFrom(value: unknown): ArtifactFormat | undefined {
	return value === "excalidraw" || value === "scene" || value === "png" ? value : undefined;
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

function headerValue(request: Request, name: string): string | undefined {
	const value = request.headers.get(name)?.trim();
	return value ? value : undefined;
}
