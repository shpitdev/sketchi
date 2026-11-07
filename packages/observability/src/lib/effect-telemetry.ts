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
	Tracer,
} from "effect";

import { type JsonValue, toJsonValue } from "./json.js";
import {
	rowBatches,
	spanRows,
	type TelemetryEvent,
	type TelemetryLogEvent,
	type TelemetryMetricEvent,
	type TelemetryOutcome,
	type TelemetrySpan,
} from "./rows.js";

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

/** Where one request's spans go, and how the request keeps running until they are sent. */
export interface TelemetryExportTarget {
	/** The spans stream. Without one, the request's spans are not stored. */
	readonly pipeline: TelemetryPipeline | undefined;
	readonly waitUntil: (promise: Promise<unknown>) => void;
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

// A request's held spans, kept for its next flush. Spans outside every request, such as
// those of a layer built before the first request, wait for the next request's flush.
const MAX_HELD_SPANS = 1_000;

/**
 * One request's spans. It sends what has finished when the request's root span
 * ends, then sends spans that end later, such as work the request left running,
 * each time none of the request's spans is still open.
 */
class SpanBatch {
	readonly #exporter: SpanExporter;
	readonly #root: Tracer.Span;
	readonly #target: TelemetryExportTarget;
	#open = 0;
	#rootEnded = false;
	#spans: TelemetrySpan[] = [];

	constructor(exporter: SpanExporter, target: TelemetryExportTarget, root: Tracer.Span) {
		this.#exporter = exporter;
		this.#root = root;
		this.#target = target;
	}

	/** The request's ray, run and attempt IDs, as its root span records them. */
	get correlation(): RowCorrelation {
		return rowCorrelation(this.#root.attributes);
	}

	enter(): void {
		this.#open += 1;
	}

	leave(span: TelemetrySpan | undefined, root: boolean): void {
		this.#open -= 1;
		if (span) this.#spans.push(span);
		if (root) this.#rootEnded = true;
		if (root || (this.#rootEnded && this.#open <= 0)) this.flush();
	}

	add(span: TelemetrySpan): void {
		this.#spans.push(span);
		if (this.#rootEnded && this.#open <= 0) this.flush();
	}

	flush(): void {
		const spans = [...this.#exporter.takeHeld(), ...this.#spans];
		this.#spans = [];
		const pipeline = this.#target.pipeline;
		if (spans.length === 0 || !pipeline) return;
		const failed = (error: unknown) => {
			console.error("Span export failed", {
				error: toJsonValue(error),
				names: [...new Set(spans.map((span) => span.name))],
				spans: spans.length,
			});
		};
		try {
			const rows = spans.flatMap((span) => spanRows(span));
			const sends = rowBatches(rows).map((batch) => pipeline.send(batch));
			this.#target.waitUntil(Promise.all(sends).then(() => undefined, failed));
		} catch (error) {
			failed(error);
		}
	}
}

class SpanExporter implements TelemetryExporterShape {
	readonly resource: TelemetryResource;
	readonly #sink: TelemetrySpanSink | undefined;
	#held: TelemetrySpan[] = [];
	#sequence = 0;

	constructor(resource: TelemetryResource, sink: TelemetrySpanSink | undefined) {
		this.resource = resource;
		this.#sink = sink;
	}

	nextSeq(): number {
		this.#sequence += 1;
		return this.#sequence;
	}

	batch(target: TelemetryExportTarget, root: Tracer.Span): SpanBatch {
		return new SpanBatch(this, target, root);
	}

	takeHeld(): TelemetrySpan[] {
		const held = this.#held;
		this.#held = [];
		return held;
	}

	/**
	 * Hands a finished span to the sink, its request, or the next request's flush.
	 * `entered` says the span counted as open in `batch`; `root` that it is the request's root.
	 */
	finish(
		span: TelemetrySpan,
		batch: SpanBatch | undefined,
		{ entered, root }: { readonly entered: boolean; readonly root: boolean },
	): void {
		this.#sink?.export(span);
		if (batch) {
			if (entered) batch.leave(span, root);
			else batch.add(span);
			return;
		}
		if (this.#sink) return;
		this.#held.push(span);
		if (this.#held.length > MAX_HELD_SPANS) {
			const dropped = this.#held.splice(0, this.#held.length - MAX_HELD_SPANS);
			console.warn("Dropped spans that no request flushed", {
				dropped: dropped.length,
				names: [...new Set(dropped.map((droppedSpan) => droppedSpan.name))],
			});
		}
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
		const batch = parent instanceof ExportingSpan ? parent.batch : undefined;
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
				...batch?.correlation,
				...this.resourceFields(),
				span_id: randomHex(8),
				start_time: time,
				trace_id: parent?.traceId ?? randomHex(16),
			},
			batch,
			{ entered: false, root: false },
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
	#batch: SpanBatch | undefined;
	#root = false;

	constructor(options: Parameters<Tracer.Tracer["span"]>[0], exporter: SpanExporter) {
		super(options);
		this.#exporter = exporter;
		this.#startSeq = exporter.nextSeq();
		const parent = Option.getOrUndefined(options.parent);
		if (parent instanceof ExportingSpan && parent.#exporter === exporter && parent.#batch) {
			this.#batch = parent.#batch;
			this.#batch.enter();
		}
	}

	get batch(): SpanBatch | undefined {
		return this.#batch;
	}

	/** Makes this span the root of a request whose spans go to `target`. */
	adopt(target: TelemetryExportTarget): void {
		if (this.#batch || this.status._tag === "Ended") return;
		this.#batch = this.#exporter.batch(target, this);
		this.#batch.enter();
		this.#root = true;
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
		let span: TelemetrySpan | undefined;
		// Recording a span must never fail the work it describes.
		try {
			if (this.sampled) span = this.#finished(endTime, exit);
		} catch (error) {
			console.error("Span could not be recorded", { error: toJsonValue(error), name: this.name });
		}
		if (span) {
			this.#exporter.finish(span, this.#batch, {
				entered: this.#batch !== undefined,
				root: this.#root,
			});
		} else {
			this.#batch?.leave(undefined, this.#root);
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
			...this.#batch?.correlation,
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
 * Sends the spans of `effect`'s request to `target` when the request ends. Run it
 * inside the request's root span; every span under that root joins the request.
 */
export function withTelemetryExport(target: TelemetryExportTarget) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.flatMap(Effect.option(Effect.currentSpan), (span) => {
			const current = Option.getOrUndefined(span);
			if (current instanceof ExportingSpan) current.adopt(target);
			return effect;
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
 * The tracer, logger and metric exporter for a Worker. Spans of a request wrapped
 * in `withTelemetryExport` go to that request's stream; `sink` also receives every
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
