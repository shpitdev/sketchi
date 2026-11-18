// @effect-diagnostics globalDate:off globalDateInEffect:off -- The exporter formats timestamps, including acquired Effect Clock values, in its existing ISO Pipeline row format.
// @effect-diagnostics globalConsole:off globalConsoleInEffect:off -- The telemetry sink and its export-failure fallback report to the host console without re-entering its own Effect logger.
import {
	Cause,
	Clock,
	Context,
	Effect,
	Exit,
	Layer,
	Logger,
	Metric,
	Option,
	References,
	Result,
	Scope,
	Tracer,
} from "effect";

import { type JsonValue, toJsonValue } from "./json";
import {
	rowBatches,
	spanRows,
	type TelemetryEvent,
	type TelemetryLogEvent,
	type TelemetryMetricEvent,
	type TelemetryOutcome,
	type TelemetrySpan,
} from "./rows";

/** Attribute names for the content a span carries. */
export const SpanContent = {
	/** What an operation was given. */
	input: "sketchi.input",
	/** What an operation returned. */
	output: "sketchi.output",
	httpRequestBody: "http.request.body",
	httpResponseBody: "http.response.body",
} as const;

export interface TelemetryCorrelationInput {
	readonly artifactId?: string;
	readonly attemptId?: string;
	readonly projectId?: string;
	/** The Cloudflare ray ID of the request. */
	readonly rayId?: string;
	readonly requestId?: string;
	readonly runId?: string;
	readonly scenarioId?: string;
	readonly traceId?: string;
}

const RAY_ID_ATTRIBUTE = "cf.ray_id";
const RUN_ID_ATTRIBUTE = "sketchi.run_id";
const ATTEMPT_ID_ATTRIBUTE = "sketchi.attempt_id";

const correlationFields = [
	["artifactId", "sketchi.artifact_id"],
	["attemptId", ATTEMPT_ID_ATTRIBUTE],
	["projectId", "sketchi.project_id"],
	["rayId", RAY_ID_ATTRIBUTE],
	["requestId", "sketchi.request_id"],
	["runId", RUN_ID_ATTRIBUTE],
	["scenarioId", "sketchi.scenario_id"],
	["traceId", "sketchi.trace_id"],
] satisfies readonly (readonly [keyof TelemetryCorrelationInput, string])[];

export interface TelemetryResource {
	readonly environment?: string;
	readonly serviceName: string;
	readonly serviceVersion?: string;
}

export interface TelemetryMetricAttributes {
	readonly artifactKind?: string;
	readonly failureCategory?: string;
	readonly operation?: string;
	readonly outcome?: string;
	readonly provider?: string;
	readonly retryKind?: string;
	readonly sink?: string;
	readonly surface?: string;
	readonly timeoutKind?: string;
}

/** Receives every span as it finishes. Tests read spans through one. */
export interface TelemetrySpanSink {
	readonly export: (span: TelemetrySpan) => void;
}

/** A Cloudflare Pipelines stream binding. */
export interface TelemetryPipeline {
	send(records: readonly unknown[]): Promise<void>;
}

/** Where one request's spans go, and when. */
export interface TelemetryExportTarget {
	/** The spans stream. Without one, the request's spans are not stored. */
	readonly pipeline: TelemetryPipeline | undefined;
	/**
	 * Closes once the request and the work it left running have ended. Closing it sends
	 * the request's spans and waits for the sends, so close it under the request's `waitUntil`.
	 */
	readonly scope: Scope.Scope;
}

/** The IDs every row of a request carries. */
interface RowCorrelation {
	readonly attempt_id?: string;
	readonly ray_id?: string;
	readonly run_id?: string;
}

function rowCorrelation(attributes: ReadonlyMap<string, unknown>): RowCorrelation {
	const attemptId = stringAttribute(attributes, ATTEMPT_ID_ATTRIBUTE);
	const rayId = stringAttribute(attributes, RAY_ID_ATTRIBUTE);
	const runId = stringAttribute(attributes, RUN_ID_ATTRIBUTE);
	return {
		...(attemptId ? { attempt_id: attemptId } : {}),
		...(rayId ? { ray_id: rayId } : {}),
		...(runId ? { run_id: runId } : {}),
	};
}

interface TelemetryExporterShape {
	readonly metric: (
		event: Omit<TelemetryMetricEvent, "seq" | "type">,
		span: Tracer.AnySpan | undefined,
	) => void;
}

const noopTelemetryExporter: TelemetryExporterShape = {
	metric: () => undefined,
};

export const TelemetryExporter = Context.Reference<TelemetryExporterShape>(
	"@sketchi/observability/TelemetryExporter",
	{ defaultValue: () => noopTelemetryExporter },
);

export const TelemetryCorrelation = Context.Reference<TelemetryCorrelationInput>(
	"@sketchi/observability/TelemetryCorrelation",
	{ defaultValue: () => ({}) },
);

export const TelemetryResourceContext = Context.Reference<TelemetryResource>(
	"@sketchi/observability/TelemetryResource",
	{ defaultValue: () => ({ serviceName: "sketchi" }) },
);

function normalizedCorrelation(input: TelemetryCorrelationInput): TelemetryCorrelationInput {
	const normalized: {
		-readonly [K in keyof TelemetryCorrelationInput]?: string;
	} = {};
	for (const [key] of correlationFields) {
		const value = input[key]?.trim();
		if (value) normalized[key] = value;
	}
	return normalized;
}

function correlationAnnotations(input: TelemetryCorrelationInput): Record<string, string> {
	const annotations: Record<string, string> = {};
	for (const [key, annotation] of correlationFields) {
		const value = input[key];
		if (value) annotations[annotation] = value;
	}
	return annotations;
}

export function withTelemetryCorrelation<A, E, R>(
	effect: Effect.Effect<A, E, R>,
	input: TelemetryCorrelationInput,
): Effect.Effect<A, E, R> {
	return Effect.gen(function* () {
		const parent = yield* TelemetryCorrelation;
		const correlation = { ...parent, ...normalizedCorrelation(input) };
		const annotations = correlationAnnotations(correlation);
		return yield* effect.pipe(
			Effect.provideService(TelemetryCorrelation, correlation),
			Effect.annotateSpans(annotations),
			Effect.annotateLogs(annotations),
		);
	});
}

/** Records `input` on the current span, then what `effect` returns. */
export function withSpanContent<A, E, R>(
	input: unknown,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
	return Effect.annotateCurrentSpan(SpanContent.input, input).pipe(
		Effect.andThen(effect),
		Effect.tap((output) => Effect.annotateCurrentSpan(SpanContent.output, output)),
	);
}

function metricAttributes(input: TelemetryMetricAttributes): Record<string, string> {
	const values = {
		artifact_kind: input.artifactKind,
		failure_category: input.failureCategory,
		operation: input.operation,
		outcome: input.outcome,
		provider: input.provider,
		retry_kind: input.retryKind,
		sink: input.sink,
		surface: input.surface,
		timeout_kind: input.timeoutKind,
	};
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (value) output[key] = value;
	}
	return output;
}

export const recordMetric = Effect.fn(function* (
	metric: Metric.Metric<number, unknown>,
	value: number,
	attributes: TelemetryMetricAttributes = {},
) {
	const normalized = metricAttributes(attributes);
	yield* Metric.update(Metric.withAttributes(metric, normalized), value);
	const exporter = yield* TelemetryExporter;
	const span = Option.getOrUndefined(yield* Effect.option(Effect.currentParentSpan));
	const now = yield* Clock.currentTimeMillis;
	exporter.metric(
		{
			attributes: normalized,
			metric: metric.id,
			metric_type: metric.type,
			time: new Date(now).toISOString(),
			value,
		},
		span,
	);
});

function randomHex(bytes: number): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function isoFromNanos(nanos: bigint): string {
	return new Date(Number(nanos / 1_000_000n)).toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function jsonRecord(values: Iterable<readonly [string, unknown]>): Record<string, JsonValue> {
	const output: Record<string, JsonValue> = {};
	for (const [key, value] of values) {
		try {
			output[key] = toJsonValue(value);
		} catch (error) {
			// A getter that throws, for one: keep the attribute and say why it is empty.
			output[key] = { $unrecorded: error instanceof Error ? error.message : String(error) };
		}
	}
	return output;
}

function stringAttribute(attributes: ReadonlyMap<string, unknown>, key: string) {
	const value = attributes.get(key);
	return typeof value === "string" && value ? value : undefined;
}

interface ExitDetails {
	readonly cause?: string;
	readonly error?: JsonValue;
	readonly error_message?: string;
	readonly error_tag?: string;
	readonly outcome: TelemetryOutcome;
}

function errorDetails(error: unknown, fallbackTag: string): Omit<ExitDetails, "outcome"> {
	const record =
		typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
	const tag = typeof record["_tag"] === "string" ? record["_tag"] : undefined;
	const message =
		error instanceof Error
			? error.message
			: typeof record["message"] === "string"
				? record["message"]
				: typeof error === "string"
					? error
					: undefined;
	return {
		error: toJsonValue(error),
		...(message ? { error_message: message } : {}),
		error_tag: tag ?? fallbackTag,
	};
}

function exitDetails(exit: Exit.Exit<unknown, unknown>): ExitDetails {
	if (Exit.isSuccess(exit)) return { outcome: "success" };
	const cause = Cause.pretty(exit.cause);
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isSome(failure)) {
		return { cause, outcome: "failure", ...errorDetails(failure.value, "failure") };
	}
	const defect = Cause.findDefect(exit.cause);
	if (Result.isSuccess(defect)) {
		return { cause, outcome: "failure", ...errorDetails(defect.success, "defect") };
	}
	if (Cause.hasInterrupts(exit.cause)) return { cause, outcome: "interrupted" };
	return { cause, error_tag: "defect", outcome: "failure" };
}

/** Orders spans that start in the same millisecond within one isolate. */
export const START_SEQ_ATTRIBUTE = "sketchi.span.start_seq";

/** One request's finished spans, sent together when the request's scope closes. */
class RequestSpans {
	readonly #root: Tracer.Span;
	#spans: TelemetrySpan[] | undefined = [];

	constructor(root: Tracer.Span) {
		this.#root = root;
	}

	/** The request's ray, run and attempt IDs, as its root span records them. */
	get correlation(): RowCorrelation {
		return rowCorrelation(this.#root.attributes);
	}

	add(span: TelemetrySpan): void {
		if (this.#spans) this.#spans.push(span);
		else console.error("Span ended after its request's spans were sent", { name: span.name });
	}

	/** Sends every span once, then waits for the sends. A failed send is logged, never raised. */
	send(pipeline: TelemetryPipeline): Effect.Effect<void> {
		return Effect.suspend(() => {
			const spans = this.#spans ?? [];
			this.#spans = undefined;
			const failed = (cause: Cause.Cause<unknown>) =>
				Effect.sync(() =>
					console.error("Span export failed", {
						error: toJsonValue(Cause.squash(cause)),
						names: [...new Set(spans.map((span) => span.name))],
						spans: spans.length,
					}),
				);
			return Effect.forEach(
				rowBatches(spans.flatMap((span) => spanRows(span))),
				(batch) => Effect.promise(() => pipeline.send(batch)).pipe(Effect.catchCause(failed)),
				{ concurrency: "unbounded", discard: true },
			).pipe(Effect.catchCause(failed));
		});
	}
}

class SpanExporter implements TelemetryExporterShape {
	readonly resource: TelemetryResource;
	readonly #sink: TelemetrySpanSink | undefined;
	#sequence = 0;

	constructor(resource: TelemetryResource, sink: TelemetrySpanSink | undefined) {
		this.resource = resource;
		this.#sink = sink;
	}

	nextSeq(): number {
		this.#sequence += 1;
		return this.#sequence;
	}

	/** Hands a finished span to the sink and its request. A span outside every request is not stored. */
	finish(span: TelemetrySpan, request: RequestSpans | undefined): void {
		this.#sink?.export(span);
		request?.add(span);
	}

	resourceFields() {
		return {
			service: this.resource.serviceName,
			...(this.resource.environment ? { environment: this.resource.environment } : {}),
			...(this.resource.serviceVersion ? { service_version: this.resource.serviceVersion } : {}),
		};
	}

	/** A log or metric with no open span to hold it becomes a row of its own. */
	standalone(event: TelemetryEvent, parent: Tracer.AnySpan | undefined): void {
		const time = "time" in event ? event.time : new Date().toISOString();
		const request = parent instanceof ExportingSpan ? parent.request : undefined;
		this.finish(
			{
				attributes: {},
				duration_ms: 0,
				end_time: time,
				events: [event],
				kind: "internal",
				name: event.type === "log" ? "effect.log" : "effect.metric",
				outcome: "success",
				...(parent ? { parent_span_id: parent.spanId } : {}),
				...request?.correlation,
				...this.resourceFields(),
				span_id: randomHex(8),
				start_time: time,
				trace_id: parent?.traceId ?? randomHex(16),
			},
			request,
		);
	}

	metric(event: Omit<TelemetryMetricEvent, "seq" | "type">, span: Tracer.AnySpan | undefined) {
		const record: TelemetryMetricEvent = { ...event, seq: this.nextSeq(), type: "metric" };
		if (span instanceof ExportingSpan && span.record(record)) return;
		this.standalone(record, span);
	}
}

class ExportingSpan extends Tracer.NativeSpan {
	readonly #exporter: SpanExporter;
	readonly #events: TelemetryEvent[] = [];
	readonly #startSeq: number;
	#request: RequestSpans | undefined;

	constructor(options: Parameters<Tracer.Tracer["span"]>[0], exporter: SpanExporter) {
		super(options);
		this.#exporter = exporter;
		this.#startSeq = exporter.nextSeq();
		const parent = Option.getOrUndefined(options.parent);
		if (parent instanceof ExportingSpan && parent.#exporter === exporter) {
			this.#request = parent.#request;
		}
	}

	get request(): RequestSpans | undefined {
		return this.#request;
	}

	/** Makes this span the root of a new request, unless it already belongs to one. */
	adopt(): RequestSpans | undefined {
		if (this.#request || this.status._tag === "Ended") return undefined;
		this.#request = new RequestSpans(this);
		return this.#request;
	}

	record(event: TelemetryEvent): boolean {
		if (this.status._tag === "Ended") return false;
		this.#events.push(event);
		return true;
	}

	override event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
		this.record({
			attributes: jsonRecord(Object.entries(attributes ?? {})),
			name,
			seq: this.#exporter.nextSeq(),
			time: isoFromNanos(startTime),
			type: "event",
		});
	}

	override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
		if (this.status._tag === "Ended") return;
		super.end(endTime, exit);
		if (!this.sampled) return;
		// Recording a span must never fail the work it describes.
		try {
			this.#exporter.finish(this.#finished(endTime, exit), this.#request);
		} catch (error) {
			console.error("Span could not be recorded", { error: toJsonValue(error), name: this.name });
		}
	}

	#finished(endTime: bigint, exit: Exit.Exit<unknown, unknown>): TelemetrySpan {
		const parent = Option.getOrUndefined(this.parent);
		const attributes = this.attributes;
		const links: TelemetryEvent[] = this.links.map((link) => ({
			attributes: jsonRecord(Object.entries(link.attributes)),
			seq: this.#exporter.nextSeq(),
			span_id: link.span.spanId,
			trace_id: link.span.traceId,
			type: "link",
		}));
		return {
			// A span without its own IDs carries its request's.
			...this.#request?.correlation,
			...rowCorrelation(attributes),
			// The Workers clock only advances on I/O, so many spans share a start time.
			attributes: { ...jsonRecord(attributes), [START_SEQ_ATTRIBUTE]: this.#startSeq },
			duration_ms: Math.max(0, Number(endTime - this.startTime) / 1_000_000),
			end_time: isoFromNanos(endTime),
			events: [...this.#events, ...links],
			kind: this.kind,
			name: this.name,
			...exitDetails(exit),
			...(parent ? { parent_span_id: parent.spanId } : {}),
			...this.#exporter.resourceFields(),
			span_id: this.spanId,
			start_time: isoFromNanos(this.startTime),
			trace_id: this.traceId,
		};
	}
}

/**
 * Makes the current span the root of a request whose spans go to `target` when
 * `target.scope` closes. Run it inside the request's root span; every span under
 * that root joins the request, including work the request leaves running.
 */
export function withTelemetryExport(target: TelemetryExportTarget) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.flatMap(Effect.option(Effect.currentSpan), (span) => {
			const current = Option.getOrUndefined(span);
			const pipeline = target.pipeline;
			if (!pipeline || !(current instanceof ExportingSpan)) return effect;
			const request = current.adopt();
			if (!request) return effect;
			return Effect.andThen(Scope.addFinalizer(target.scope, request.send(pipeline)), effect);
		});
}

function logParts(message: unknown) {
	const texts: string[] = [];
	const fields: Record<string, JsonValue> = {};
	const values: JsonValue[] = [];
	for (const part of Array.isArray(message) ? message : [message]) {
		if (typeof part === "string") texts.push(part);
		else if (isPlainRecord(part)) Object.assign(fields, jsonRecord(Object.entries(part)));
		else values.push(toJsonValue(part));
	}
	return { fields, message: texts.join(" "), values };
}

function makeTelemetryLogger(exporter: SpanExporter) {
	return Logger.make(({ cause, date, fiber, logLevel, message }) => {
		const parts = logParts(message);
		const event: TelemetryLogEvent = {
			annotations: jsonRecord(Object.entries(fiber.getRef(References.CurrentLogAnnotations))),
			...(cause.reasons.length > 0 ? { cause: Cause.pretty(cause) } : {}),
			fields: parts.fields,
			level: logLevel,
			message: parts.message,
			seq: exporter.nextSeq(),
			time: date.toISOString(),
			type: "log",
			...(parts.values.length > 0 ? { values: parts.values } : {}),
		};
		if (logLevel === "Warn") console.warn(event.message, event);
		if (logLevel === "Error" || logLevel === "Fatal") console.error(event.message, event);
		const parent = Context.getOrUndefined(fiber.context, Tracer.ParentSpan);
		if (parent instanceof ExportingSpan && parent.record(event)) return;
		exporter.standalone(event, parent);
	});
}

function normalizedResource(resource: TelemetryResource): TelemetryResource {
	const serviceName = resource.serviceName.trim();
	if (!serviceName) throw new TypeError("Telemetry serviceName must not be empty.");
	const environment = resource.environment?.trim();
	const serviceVersion = resource.serviceVersion?.trim();
	return {
		serviceName,
		...(environment ? { environment } : {}),
		...(serviceVersion ? { serviceVersion } : {}),
	};
}

/**
 * The tracer, logger and metric exporter for a Worker. Spans of a request rooted
 * with `withTelemetryExport` go to that request's stream; `sink` also receives every
 * span as it finishes.
 */
export function makeWorkersTelemetryLayer(options: {
	readonly resource: TelemetryResource;
	readonly sink?: TelemetrySpanSink;
}) {
	return Layer.effectContext(
		Effect.sync(() => {
			const resource = normalizedResource(options.resource);
			const exporter = new SpanExporter(resource, options.sink);
			const tracer = Tracer.make({
				span: (spanOptions) => new ExportingSpan(spanOptions, exporter),
			});
			return Context.empty().pipe(
				Context.add(TelemetryExporter, exporter),
				Context.add(TelemetryResourceContext, resource),
				Context.add(Tracer.Tracer, tracer),
				Context.add(Logger.CurrentLoggers, new Set([makeTelemetryLogger(exporter)])),
				Context.add(Metric.MetricRegistry, new Map()),
			);
		}),
	);
}

export interface TelemetryTestProbe {
	/** Every log, in the order it was written. */
	readonly logs: readonly (TelemetryLogEvent & { readonly span: TelemetrySpan })[];
	/** Every metric update, in the order it was recorded. */
	readonly metrics: readonly (TelemetryMetricEvent & { readonly span: TelemetrySpan })[];
	/** Finished spans, in the order they ended. */
	readonly spans: TelemetrySpan[];
}

function eventsOf<T extends TelemetryEvent["type"]>(spans: readonly TelemetrySpan[], type: T) {
	return spans
		.flatMap((span) =>
			span.events.flatMap((event) =>
				event.type === type ? [{ ...(event as Extract<TelemetryEvent, { type: T }>), span }] : [],
			),
		)
		.sort((left, right) => left.seq - right.seq);
}

export function makeTelemetryTestSink(): {
	readonly probe: TelemetryTestProbe;
	readonly sink: TelemetrySpanSink;
} {
	const spans: TelemetrySpan[] = [];
	return {
		probe: {
			get logs() {
				return eventsOf(spans, "log");
			},
			get metrics() {
				return eventsOf(spans, "metric");
			},
			spans,
		},
		sink: { export: (span) => spans.push(span) },
	};
}
