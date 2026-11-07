import { readFileSync } from "node:fs";

import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Metric, Schema } from "effect";

import {
	makeTelemetryTestSink,
	makeWorkersTelemetryLayer,
	recordMetric,
	SpanContent,
	START_SEQ_ATTRIBUTE,
	TelemetryCorrelation,
	type TelemetryExportTarget,
	withSpanContent,
	withTelemetryCorrelation,
	withTelemetryExport,
} from "./effect-telemetry.js";
import { toJsonValue } from "./json.js";
import {
	MAX_ROW_BYTES,
	rowBatches,
	SPAN_ROW_SCHEMA,
	spanRows,
	type TelemetrySpan,
	type TelemetrySpanRow,
} from "./rows.js";

const requestCounter = Metric.counter("sketchi_test_requests", {
	description: "Test request count",
	incremental: true,
});

class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", {
	detail: Schema.String,
	message: Schema.String,
}) {}

interface StreamField {
	readonly name: string;
	readonly required: boolean;
	readonly type: string;
}

const streamSchema = JSON.parse(
	readFileSync(new URL("../../spans.schema.json", import.meta.url), "utf8"),
) as { readonly fields: readonly StreamField[] };

function fakeExport() {
	const sends: TelemetrySpanRow[][] = [];
	const pending: Promise<unknown>[] = [];
	const target: TelemetryExportTarget = {
		pipeline: {
			send: (records) => {
				sends.push(records as TelemetrySpanRow[]);
				return Promise.resolve();
			},
		},
		waitUntil: (promise) => pending.push(promise),
	};
	return { pending, sends, target };
}

function span(overrides: Partial<TelemetrySpan> = {}): TelemetrySpan {
	return {
		attributes: {},
		duration_ms: 1,
		end_time: "2026-11-07T00:00:01.000Z",
		events: [],
		kind: "internal",
		name: "test.span",
		outcome: "success",
		service: "sketchi-test",
		span_id: "0123456789abcdef",
		start_time: "2026-11-07T00:00:00.000Z",
		trace_id: "0123456789abcdef0123456789abcdef",
		...overrides,
	};
}

function reassembled(rows: readonly TelemetrySpanRow[], column: "attributes" | "cause" | "events") {
	return [...rows]
		.sort((left, right) => left.part_index - right.part_index)
		.map((row) => row[column] ?? "")
		.join("");
}

describe("Workers Effect telemetry", () => {
	it.effect("annotates every correlation field and lets a child override its parent", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return withTelemetryCorrelation(
			withTelemetryCorrelation(
				Effect.logInfo("Retrying diagram generation", { operation: "generate" }).pipe(
					Effect.withSpan("test.correlation"),
				),
				{ requestId: "request child", scenarioId: " scenario_child " },
			),
			{
				artifactId: "artifact_parent",
				attemptId: "attempt_parent",
				projectId: "project_parent",
				requestId: "request_parent",
				runId: "run_parent",
				scenarioId: "scenario_parent",
				traceId: "trace_parent",
			},
		).pipe(
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			Effect.tap(() =>
				Effect.sync(() => {
					const [log] = probe.logs;
					assert.deepStrictEqual(log?.annotations, {
						"sketchi.artifact_id": "artifact_parent",
						"sketchi.attempt_id": "attempt_parent",
						"sketchi.project_id": "project_parent",
						"sketchi.request_id": "request child",
						"sketchi.run_id": "run_parent",
						"sketchi.scenario_id": "scenario_child",
						"sketchi.trace_id": "trace_parent",
					});
					assert.deepStrictEqual(log?.fields, { operation: "generate" });
					assert.strictEqual(probe.spans[0]?.run_id, "run_parent");
					assert.strictEqual(probe.spans[0]?.attempt_id, "attempt_parent");
				}),
			),
		);
	});

	it.effect("keeps every attribute, log and metric in full on its span", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const prompt = `Draw ${"a long request ".repeat(40)}`;
		return Effect.gen(function* () {
			yield* withTelemetryCorrelation(
				Effect.gen(function* () {
					const correlation = yield* TelemetryCorrelation;
					assert.strictEqual(correlation.runId, "run_test");
					yield* Effect.annotateCurrentSpan({ "gen_ai.input.messages": [{ content: prompt }] });
					yield* Effect.logInfo(`The full ${prompt}`, { model: "x".repeat(300), prompt });
					yield* recordMetric(requestCounter, 1, { operation: "buildFlowchart", surface: "api" });
				}).pipe(Effect.withSpan("codeMode.buildFlowchart")),
				{ runId: "run_test" },
			);
			const snapshot = (yield* Metric.snapshot).find(({ id }) => id === "sketchi_test_requests");
			assert.isDefined(snapshot);
			const [exported] = probe.spans;
			assert.strictEqual(probe.spans.length, 1);
			assert.deepStrictEqual(exported?.attributes["gen_ai.input.messages"], [{ content: prompt }]);
			const [log] = probe.logs;
			assert.strictEqual(log?.message, `The full ${prompt}`);
			assert.deepStrictEqual(log?.fields, { model: "x".repeat(300), prompt });
			assert.strictEqual(log?.span.span_id, exported?.span_id);
			const [metric] = probe.metrics;
			assert.deepStrictEqual(metric?.attributes, { operation: "buildFlowchart", surface: "api" });
			assert.strictEqual(metric?.metric, "sketchi_test_requests");
			assert.deepStrictEqual(
				exported?.events.map((event) => event.type),
				["log", "metric"],
			);
			assert.isNumber(exported?.attributes[START_SEQ_ATTRIBUTE]);
		}).pipe(Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })));
	});

	it.effect("records the input and output of an operation", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return withSpanContent({ prompt: "two boxes" }, Effect.succeed({ diagram: { nodes: 2 } })).pipe(
			Effect.withSpan("test.content"),
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			Effect.tap(() =>
				Effect.sync(() => {
					assert.deepInclude(probe.spans[0]?.attributes, {
						[SpanContent.input]: { prompt: "two boxes" },
						[SpanContent.output]: { diagram: { nodes: 2 } },
					});
				}),
			),
		);
	});

	it.effect("records the typed error, its message and the full cause of a failed span", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.fail(
			new TestFailure({ detail: "upstream body", message: "Gateway failed" }),
		).pipe(
			Effect.withSpan("test.failure"),
			Effect.exit,
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			Effect.tap(() =>
				Effect.sync(() => {
					const [failed] = probe.spans;
					assert.strictEqual(failed?.outcome, "failure");
					assert.strictEqual(failed?.error_tag, "TestFailure");
					assert.strictEqual(failed?.error_message, "Gateway failed");
					assert.include(JSON.stringify(failed?.error), "upstream body");
					assert.include(failed?.cause, "Gateway failed");
				}),
			),
		);
	});

	it.effect("marks defects and interruptions", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.gen(function* () {
			yield* Effect.exit(Effect.die(new TypeError("broken")).pipe(Effect.withSpan("test.defect")));
			const fiber = yield* Effect.forkChild(Effect.never.pipe(Effect.withSpan("test.interrupt")), {
				startImmediately: true,
			});
			yield* Fiber.interrupt(fiber);
			const defect = probe.spans.find(({ name }) => name === "test.defect");
			assert.strictEqual(defect?.error_tag, "defect");
			assert.strictEqual(defect?.error_message, "broken");
			assert.strictEqual(
				probe.spans.find(({ name }) => name === "test.interrupt")?.outcome,
				"interrupted",
			);
		}).pipe(Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })));
	});

	it.effect("records an attribute it cannot convert without failing the span's work", () => {
		const { probe, sink } = makeTelemetryTestSink();
		const hostile = {
			get value(): never {
				throw new Error("no access");
			},
		};
		return Effect.annotateCurrentSpan("hostile", hostile).pipe(
			Effect.as("done"),
			Effect.withSpan("test.hostile"),
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			Effect.tap((result) =>
				Effect.sync(() => {
					assert.strictEqual(result, "done");
					assert.deepStrictEqual(probe.spans[0]?.attributes["hostile"], {
						$unrecorded: "no access",
					});
				}),
			),
		);
	});

	it.effect("keeps a log with no open span as a row of its own", () => {
		const { probe, sink } = makeTelemetryTestSink();
		return Effect.logWarning("Outside every span").pipe(
			Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" }, sink })),
			Effect.tap(() =>
				Effect.sync(() => {
					assert.strictEqual(probe.spans[0]?.name, "effect.log");
					assert.strictEqual(probe.logs[0]?.message, "Outside every span");
					assert.strictEqual(probe.logs[0]?.level, "Warn");
				}),
			),
		);
	});
});

describe("request span export", () => {
	it.effect("sends a request's spans in one batch once its root ends", () => {
		const { pending, sends, target } = fakeExport();
		return Effect.gen(function* () {
			yield* Effect.void.pipe(Effect.withSpan("held.before.request"));
			yield* Effect.gen(function* () {
				yield* Effect.annotateCurrentSpan({
					"cf.ray_id": "ray-test",
					"sketchi.attempt_id": "attempt-test",
					"sketchi.run_id": "run-test",
				});
				yield* Effect.logInfo("inside");
				yield* Effect.void.pipe(Effect.withSpan("request.child"));
				// A span with its own run keeps it, and takes the request's other IDs.
				yield* Effect.void.pipe(
					Effect.withSpan("request.other_run", { attributes: { "sketchi.run_id": "run-other" } }),
				);
				assert.strictEqual(sends.length, 0);
			}).pipe(withTelemetryExport(target), Effect.withSpan("request.root"));
			assert.strictEqual(sends.length, 1);
			assert.strictEqual(pending.length, 1);
			const rows = sends[0] ?? [];
			assert.deepStrictEqual(
				rows.map((row) => row.name),
				["held.before.request", "request.child", "request.other_run", "request.root"],
			);
			const root = rows.find((row) => row.name === "request.root");
			const child = rows.find((row) => row.name === "request.child");
			assert.strictEqual(child?.parent_span_id, root?.span_id);
			for (const row of rows.slice(1)) {
				assert.deepInclude(row, { attempt_id: "attempt-test", ray_id: "ray-test" }, row.name);
			}
			assert.strictEqual(child?.run_id, "run-test");
			assert.strictEqual(root?.run_id, "run-test");
			assert.strictEqual(rows.find((row) => row.name === "request.other_run")?.run_id, "run-other");
			// A span from before the request belongs to no request.
			assert.isUndefined(rows[0]?.ray_id);
			assert.isUndefined(rows[0]?.run_id);
			assert.strictEqual(JSON.parse(root?.events ?? "[]")[0]?.message, "inside");
		}).pipe(Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" } })));
	});

	it.effect("sends work the request left running in a later batch", () => {
		const { sends, target } = fakeExport();
		return Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const root = yield* Effect.gen(function* () {
				const current = yield* Effect.currentSpan;
				yield* Effect.forkDetach(
					Deferred.await(release).pipe(Effect.withSpan("request.deferred", { parent: current })),
				);
				return current;
			}).pipe(withTelemetryExport(target), Effect.withSpan("request.root"));
			assert.deepStrictEqual(
				sends.map((batch) => batch.map((row) => row.name)),
				[["request.root"]],
			);
			yield* Deferred.succeed(release, undefined);
			while (sends.length < 2) yield* Effect.yieldNow;
			assert.strictEqual(sends[1]?.[0]?.name, "request.deferred");
			assert.strictEqual(sends[1]?.[0]?.parent_span_id, root.spanId);
		}).pipe(Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" } })));
	});

	it.effect("sends the request's spans when its root ends, though one is still open", () => {
		const { sends, target } = fakeExport();
		return Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			yield* Effect.gen(function* () {
				const current = yield* Effect.currentSpan;
				yield* Effect.forkDetach(
					Deferred.await(release).pipe(Effect.withSpan("request.stream", { parent: current })),
				);
				yield* Effect.yieldNow;
				yield* Effect.void.pipe(Effect.withSpan("request.child"));
			}).pipe(withTelemetryExport(target), Effect.withSpan("request.root"));
			assert.deepStrictEqual(
				sends.map((batch) => batch.map((row) => row.name)),
				[["request.child", "request.root"]],
			);
			yield* Deferred.succeed(release, undefined);
			while (sends.length < 2) yield* Effect.yieldNow;
			assert.deepStrictEqual(
				sends[1]?.map((row) => row.name),
				["request.stream"],
			);
		}).pipe(Effect.provide(makeWorkersTelemetryLayer({ resource: { serviceName: "test" } })));
	});

	it.effect("writes rows the spans stream schema accepts", () => {
		const { sends, target } = fakeExport();
		return withTelemetryCorrelation(
			Effect.fail(new TestFailure({ detail: "d", message: "m" })).pipe(
				Effect.withSpan("schema.child"),
				Effect.exit,
			),
			{ attemptId: "attempt_schema", runId: "run_schema" },
		).pipe(
			withTelemetryExport(target),
			Effect.withSpan("schema.root"),
			Effect.provide(
				makeWorkersTelemetryLayer({
					resource: { environment: "test", serviceName: "test", serviceVersion: "1" },
				}),
			),
			Effect.tap(() =>
				Effect.sync(() => {
					const fields = new Map(streamSchema.fields.map((field) => [field.name, field]));
					const rows = sends.flat();
					assert.isAbove(rows.length, 0);
					for (const row of rows) {
						for (const [key, value] of Object.entries(row)) {
							const field = fields.get(key);
							assert.isDefined(field, `${key} is not a stream field`);
							const expected =
								field?.type === "string" || field?.type === "timestamp" ? "string" : "number";
							assert.strictEqual(typeof value, expected, key);
						}
						for (const field of streamSchema.fields) {
							if (field.required) assert.property(row, field.name);
						}
						assert.strictEqual(row.schema, SPAN_ROW_SCHEMA);
					}
					const child = rows.find((row) => row.name === "schema.child");
					assert.strictEqual(child?.run_id, "run_schema");
					assert.strictEqual(child?.attempt_id, "attempt_schema");
					assert.strictEqual(child?.error_tag, "TestFailure");
				}),
			),
		);
	});
});

describe("span rows", () => {
	it("keeps a span that fits in one row", () => {
		const rows = spanRows(span({ attributes: { a: 1 } }));
		assert.strictEqual(rows.length, 1);
		assert.strictEqual(rows[0]?.attributes, '{"a":1}');
		assert.strictEqual(rows[0]?.part_count, 1);
	});

	it("splits a large span across rows that each fit, without losing a character", () => {
		const text = `${'é🎉"\\\n'.repeat(60_000)}${"x".repeat(1_500_000)}`;
		const attributes = { "gen_ai.output.messages": text };
		const events = [
			{
				attributes: { body: "y".repeat(400_000) },
				name: "e",
				seq: 1,
				time: "t",
				type: "event" as const,
			},
		];
		const cause = "z".repeat(300_000);
		const rows = spanRows(span({ attributes, cause, events }));
		assert.isAbove(rows.length, 2);
		for (const [index, row] of rows.entries()) {
			assert.isAtMost(new TextEncoder().encode(JSON.stringify(row)).byteLength, MAX_ROW_BYTES);
			assert.strictEqual(row.part_index, index);
			assert.strictEqual(row.part_count, rows.length);
			assert.strictEqual(row.span_id, "0123456789abcdef");
		}
		assert.deepStrictEqual(JSON.parse(reassembled(rows, "attributes")), attributes);
		assert.deepStrictEqual(JSON.parse(reassembled(rows, "events")), events);
		assert.strictEqual(reassembled(rows, "cause"), cause);
	});

	it("groups rows into requests under the request limit", () => {
		const rows = Array.from({ length: 12 }, (_, index) =>
			spanRows(span({ attributes: { body: "b".repeat(800_000) }, span_id: String(index) })),
		).flat();
		const batches = rowBatches(rows);
		assert.isAbove(batches.length, 1);
		assert.strictEqual(batches.flat().length, rows.length);
		for (const batch of batches) {
			assert.isAtMost(new TextEncoder().encode(JSON.stringify(batch)).byteLength, 4_500_000);
		}
	});
});

describe("JSON values", () => {
	it("keeps errors, binary data and collections", () => {
		const cause = new Error("inner");
		const value = toJsonValue({
			bytes: new Uint8Array([1, 2, 3]),
			error: new Error("outer", { cause }),
			map: new Map([["k", 1n]]),
			set: new Set(["a"]),
			skipped: undefined,
		});
		assert.deepInclude(value as object, {
			bytes: { $binary: "base64", byteLength: 3, data: "AQID" },
			map: { k: "1" },
			set: ["a"],
		});
		const error = (value as { error: { cause: { message: string }; message: string } }).error;
		assert.strictEqual(error.message, "outer");
		assert.strictEqual(error.cause.message, "inner");
		assert.notProperty(value as object, "skipped");
	});

	it("converts nesting deeper than the call stack allows", () => {
		const root: Record<string, unknown> = {};
		let level = root;
		for (let depth = 0; depth < 20_000; depth += 1) {
			const child: Record<string, unknown> = {};
			level["child"] = child;
			level = child;
		}
		const rows = spanRows(span({ attributes: { [SpanContent.input]: toJsonValue(root) } }));
		assert.strictEqual(rows.length, 1);
		assert.include(rows[0]?.attributes, '{"child":{"child":');
	});

	it("marks a circular reference instead of failing", () => {
		const value: Record<string, unknown> = { name: "loop" };
		value["self"] = value;
		assert.deepStrictEqual(toJsonValue(value), { name: "loop", self: "[Circular]" });
	});
});
