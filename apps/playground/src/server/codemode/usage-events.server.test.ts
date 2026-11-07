import { assert, describe, it } from "@effect/vitest";
import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	SpanContent,
} from "@sketchi/observability";
import { Effect, Layer } from "effect";

import { PlaygroundIds, PlaygroundRequestMetadata } from "../runtime/context.server";
import {
	type CodeModeUsageCaptureInput,
	PlaygroundCodeModeUsage,
	PlaygroundCodeModeUsageLive,
	USAGE_EVENT_ATTRIBUTE,
	USAGE_ISSUES_ATTRIBUTE,
} from "./usage-events.server";

function usageLayer() {
	let next = 0;
	return Layer.mergeAll(
		Layer.succeed(PlaygroundIds, {
			create: (prefix) => {
				next += 1;
				return `${prefix}_${next}`;
			},
		}),
		PlaygroundCodeModeUsageLive,
	);
}

function requestMetadata(headers: Record<string, string> = {}) {
	return Effect.provideService(PlaygroundRequestMetadata, {
		attemptId: "attempt_request",
		method: "POST",
		origin: "https://studio.test",
		path: "/api/v1/flowcharts/build",
		request: new Request("https://studio.test/api/v1/flowcharts/build?debug=1", {
			headers,
			method: "POST",
		}),
		runId: "run_request",
		traceId: "trace_request",
	});
}

/** Captures one call and returns its capture span. */
function captured(
	input: Omit<CodeModeUsageCaptureInput, "context">,
	headers?: Record<string, string>,
) {
	const { probe, sink } = makeTelemetryTestSink();
	return Effect.gen(function* () {
		const usage = yield* PlaygroundCodeModeUsage;
		const context = yield* usage.createContext;
		yield* usage.capture({ ...input, context });
		const span = probe.spans.find(({ name }) => name === "playground.codeModeUsage.capture");
		assert.isDefined(span);
		return span;
	}).pipe(
		requestMetadata(headers),
		Effect.provide(usageLayer()),
		Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
	);
}

describe("Code Mode usage on spans", () => {
	it.effect("records the usage summary and the full request and response on its span", () =>
		Effect.gen(function* () {
			const responseBody = {
				artifact: {
					artifactId: "artifact_1",
					formats: [{ format: "scene", mimeType: "application/json", sizeBytes: 12 }],
				},
				ok: true,
			};
			const span = yield* captured({
				durationMs: 4,
				operation: "buildFlowchart",
				requestBody: { spec: { title: "Flow" } },
				responseBody,
				statusCode: 200,
				surface: "api",
			});
			assert.deepStrictEqual(span.attributes[USAGE_EVENT_ATTRIBUTE], {
				artifact_count: 1,
				artifact_delivery: false,
				artifact_formats: "scene",
				artifacts: [
					{
						artifactId: "artifact_1",
						formats: [{ format: "scene", mimeType: "application/json", sizeBytes: 12 }],
					},
				],
				attempt_id: "attempt_request",
				duration_ms: 4,
				event_id: "event_1",
				issue_count: 0,
				operation: "buildFlowchart",
				request_method: "POST",
				request_path: "/api/v1/flowcharts/build?debug=1",
				run_id: "run_request",
				status: "ok",
				status_code: 200,
				surface: "api",
			});
			assert.deepStrictEqual(span.attributes[USAGE_ISSUES_ATTRIBUTE], []);
			assert.deepStrictEqual(span.attributes[SpanContent.input], { spec: { title: "Flow" } });
			assert.deepStrictEqual(span.attributes[SpanContent.output], responseBody);
			assert.deepInclude(span.attributes, { operation: "buildFlowchart", surface: "api" });
		}),
	);

	it.effect("records a failure's message and every issue, with no limit on their number", () =>
		Effect.gen(function* () {
			const issues = Array.from({ length: 150 }, (_, index) => ({
				code: index === 0 ? "invalid_node" : "invalid_edge",
				message: index === 0 ? "Node missing" : `Edge ${index} missing`,
				severity: "error",
				stage: "validation",
			}));
			const span = yield* captured({
				durationMs: 7,
				operation: "buildFlowchart",
				requestBody: { spec: {} },
				responseBody: { issues, ok: false },
				statusCode: 400,
				surface: "api",
			});
			assert.deepInclude(span.attributes[USAGE_EVENT_ATTRIBUTE] as object, {
				error_message: "Node missing",
				issue_codes: "invalid_node,invalid_edge",
				issue_count: 150,
				status: "error",
				status_code: 400,
			});
			const recorded = span.attributes[USAGE_ISSUES_ATTRIBUTE] as unknown[];
			assert.strictEqual(recorded.length, 150);
			assert.deepStrictEqual(recorded[0], {
				code: "invalid_node",
				message: "Node missing",
				path: "response.issues[0]",
				severity: "error",
				stage: "validation",
			});
		}),
	);

	it.effect("records the client a harness names in its headers", () =>
		Effect.gen(function* () {
			const span = yield* captured(
				{
					durationMs: 1,
					operation: "execute",
					requestBody: { code: "async () => 1" },
					responseBody: { ok: true, result: 1 },
					surface: "mcp",
				},
				{
					"user-agent": "harness/1",
					"x-sketchi-client": "codex",
					"x-sketchi-harness": "scenario-cli",
					"x-sketchi-model": "gpt",
					"x-sketchi-reasoning-level": "high",
					"x-sketchi-scenario-id": "scenario_1",
				},
			);
			assert.deepInclude(span.attributes[USAGE_EVENT_ATTRIBUTE] as object, {
				client: "codex",
				harness: "scenario-cli",
				model: "gpt",
				reasoning_level: "high",
				scenario_id: "scenario_1",
				surface: "mcp",
				user_agent: "harness/1",
			});
		}),
	);

	it.effect("gives every call in a request the request's run and attempt and its own event", () =>
		Effect.gen(function* () {
			const usage = yield* PlaygroundCodeModeUsage;
			const first = yield* usage.createContext;
			const second = yield* usage.createContext;
			assert.deepStrictEqual(
				[first, second],
				[
					{ attemptId: "attempt_request", eventId: "event_1", runId: "run_request" },
					{ attemptId: "attempt_request", eventId: "event_2", runId: "run_request" },
				],
			);
		}).pipe(requestMetadata(), Effect.provide(usageLayer())),
	);
});
