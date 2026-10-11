import {
	Cause,
	Context,
	Effect,
	Exit,
	Layer,
	Logger,
	Metric,
	Option,
	References,
	Tracer,
} from "effect";

const TELEMETRY_SCHEMA = "sketchi.effect.telemetry.v1";
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 256;

export interface TelemetryCorrelationInput {
	readonly artifactId?: string;
	readonly attemptId?: string;
	readonly projectId?: string;
	readonly requestId?: string;
	readonly runId?: string;
	readonly scenarioId?: string;
	readonly traceId?: string;
}

const correlationFields = [
	["artifactId", "sketchi.artifact_id"],
	["attemptId", "sketchi.attempt_id"],
	["projectId", "sketchi.project_id"],
	["requestId", "sketchi.request_id"],
	["runId", "sketchi.run_id"],
	["scenarioId", "sketchi.scenario_id"],
	["traceId", "sketchi.trace_id"],
] satisfies readonly (readonly [keyof TelemetryCorrelationInput, string])[];

const safeLogMessages = new Set([
	"Browser Rendering session cleanup failed",
	"Code Mode usage capture failed",
	"Retrying diagram generation",
	"Retrying Studio diagram repair",
]);

const safeFieldNames = new Set([
	"artifact_count",
	"artifact_format",
	"artifact_kind",
	"attempt",
	"cache_mode",
	"duration_ms",
	"error_category",
	"error_tag",
	"failure_category",
	"format_count",
	"method",
	"model",
	"operation",
	"outcome",
	"provider",
	"request_kind",
	"retry_kind",
	"sink",
	"status",
	"status_code",
	"surface",
	"timeout_kind",
	"timeout_ms",
]);

const safeAnnotationNames = new Set([
	"request.method",
	"request.route",
	...correlationFields.map(([, annotation]) => annotation),
	...safeFieldNames,
]);

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

interface TelemetryEventBase {
	readonly resource: {
		readonly environment?: string;
		readonly service_name: string;
		readonly service_version?: string;
	};
	readonly schema: typeof TELEMETRY_SCHEMA;
}

export interface TelemetrySpanEvent extends TelemetryEventBase {
	readonly attributes: Readonly<Record<string, boolean | number | string>>;
	readonly duration_ms: number;
	readonly error_category?: string;
	readonly event: "effect.span";
	readonly kind: Tracer.SpanKind;
	readonly name: string;
	readonly outcome: "failure" | "interrupted" | "success";
	readonly parent_span_id?: string;
	readonly span_id: string;
	readonly trace_id: string;
}

export interface TelemetryLogEvent extends TelemetryEventBase {
	readonly annotations: Readonly<Record<string, boolean | number | string>>;
	readonly event: "effect.log";
	readonly fields: Readonly<Record<string, boolean | number | string>>;
	readonly level: string;
	readonly message: string;
	readonly message_dropped?: true;
	readonly span_id?: string;
	readonly trace_id?: string;
}

export interface TelemetryMetricEvent extends TelemetryEventBase {
	readonly attributes: Readonly<Record<string, string>>;
	readonly event: "effect.metric";
	readonly metric: string;
	readonly metric_type: Metric.Metric.Type;
	readonly span_id?: string;
	readonly trace_id?: string;
	readonly value: number;
}

export type TelemetryEvent = TelemetryLogEvent | TelemetryMetricEvent | TelemetrySpanEvent;

export interface TelemetrySink {
	readonly shutdown: (resource: TelemetryResource) => void;
	readonly start: (resource: TelemetryResource) => void;
	readonly write: (event: TelemetryEvent) => void;
}

interface TelemetryExporterShape {
	readonly metric: (input: {
		readonly attributes: Readonly<Record<string, string>>;
		readonly metric: string;
		readonly metricType: Metric.Metric.Type;
		readonly spanId?: string;
		readonly traceId?: string;
		readonly value: number;
	}) => void;
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

function boundedIdentifier(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (
		!trimmed ||
		trimmed.length > MAX_IDENTIFIER_LENGTH ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(trimmed)
	) {
		return undefined;
	}
	return trimmed;
}

function boundedMessage(value: string): string {
	const normalized = value.replaceAll(/\s+/g, " ").trim();
	return normalized.length <= MAX_MESSAGE_LENGTH
		? normalized
		: `${normalized.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
}

function boundedFieldValue(value: string): string | undefined {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.length > MAX_IDENTIFIER_LENGTH ||
		!/^[A-Za-z0-9/][A-Za-z0-9._:/ -]*$/.test(trimmed)
	) {
		return undefined;
	}
	return trimmed;
}

function normalizedCorrelation(input: TelemetryCorrelationInput): TelemetryCorrelationInput {
	const normalized: {
		-readonly [K in keyof TelemetryCorrelationInput]?: string;
	} = {};
	for (const [key] of correlationFields) {
		const value = boundedIdentifier(input[key]);
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

function normalizedMetricAttributes(input: TelemetryMetricAttributes): Record<string, string> {
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
		const bounded = boundedIdentifier(value);
		if (bounded) output[key] = bounded;
	}
	return output;
}

export const recordMetric = Effect.fn(function* (
	metric: Metric.Metric<number, unknown>,
	value: number,
	attributes: TelemetryMetricAttributes = {},
) {
	const normalizedAttributes = normalizedMetricAttributes(attributes);
	yield* Metric.update(Metric.withAttributes(metric, normalizedAttributes), value);
	const exporter = yield* TelemetryExporter;
	const span = Option.getOrUndefined(yield* Effect.currentSpan.pipe(Effect.option));
	yield* Effect.sync(() =>
		exporter.metric({
			attributes: normalizedAttributes,
			metric: metric.id,
			metricType: metric.type,
			...(span ? { spanId: span.spanId, traceId: span.traceId } : {}),
			value,
		}),
	);
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeScalar(value: unknown): boolean | number | string | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") return boundedFieldValue(value);
	return undefined;
}

function safeRecord(
	values: Readonly<Record<string, unknown>>,
	allowedNames: ReadonlySet<string>,
): Record<string, boolean | number | string> {
	const output: Record<string, boolean | number | string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (!allowedNames.has(key)) continue;
		const safeValue = safeScalar(value);
		if (safeValue !== undefined) output[key] = safeValue;
	}
	return output;
}

function safeSpanAttributes(
	attributes: ReadonlyMap<string, unknown>,
): Record<string, boolean | number | string> {
	const output: Record<string, boolean | number | string> = {};
	for (const [key, value] of attributes) {
		if (!safeAnnotationNames.has(key)) continue;
		const safeValue = safeScalar(value);
		if (safeValue !== undefined) output[key] = safeValue;
	}
	return output;
}

function safeLogMessage(message: unknown): {
	readonly fields: Record<string, boolean | number | string>;
	readonly message: string;
	readonly message_dropped?: true;
} {
	const values = Array.isArray(message) ? message : [message];
	let text = "Effect log event";
	const fields: Record<string, boolean | number | string> = {};
	let dropped = false;
	for (const value of values) {
		if (typeof value === "string" && text === "Effect log event") {
			const candidate = boundedMessage(value);
			if (safeLogMessages.has(candidate)) text = candidate;
			else dropped = true;
			continue;
		}
		if (isRecord(value)) {
			Object.assign(fields, safeRecord(value, safeFieldNames));
		}
	}
	return {
		fields,
		message: text,
		...(dropped ? { message_dropped: true } : {}),
	};
}

function errorTag(value: unknown): string | undefined {
	if (isRecord(value) && typeof value["_tag"] === "string") {
		return boundedIdentifier(value["_tag"]);
	}
	if (value instanceof Error) return boundedIdentifier(value.name);
	return undefined;
}

function spanOutcome(exit: Exit.Exit<unknown, unknown>): {
	readonly errorCategory?: string;
	readonly outcome: "failure" | "interrupted" | "success";
} {
	if (Exit.isSuccess(exit)) return { outcome: "success" };
	if (Cause.hasInterrupts(exit.cause)) return { outcome: "interrupted" };
	const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
	return {
		errorCategory: errorTag(failure) ?? "defect",
		outcome: "failure",
	};
}

function resourceFields(resource: TelemetryResource) {
	return {
		service_name: resource.serviceName,
		...(resource.environment ? { environment: resource.environment } : {}),
		...(resource.serviceVersion ? { service_version: resource.serviceVersion } : {}),
	};
}

class ScopedTelemetryExporter implements TelemetryExporterShape {
	readonly #resource: TelemetryResource;
	readonly #sink: TelemetrySink;
	#closed = false;

	constructor(resource: TelemetryResource, sink: TelemetrySink) {
		this.#resource = resource;
		this.#sink = sink;
		sink.start(resource);
	}

	write(event: TelemetryEvent): void {
		if (!this.#closed) this.#sink.write(event);
	}

	metric(input: {
		readonly attributes: Readonly<Record<string, string>>;
		readonly metric: string;
		readonly metricType: Metric.Metric.Type;
		readonly spanId?: string;
		readonly traceId?: string;
		readonly value: number;
	}): void {
		this.write({
			attributes: input.attributes,
			event: "effect.metric",
			metric: input.metric,
			metric_type: input.metricType,
			resource: resourceFields(this.#resource),
			schema: TELEMETRY_SCHEMA,
			...(input.spanId ? { span_id: input.spanId } : {}),
			...(input.traceId ? { trace_id: input.traceId } : {}),
			value: input.value,
		});
	}

	shutdown(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#sink.shutdown(this.#resource);
	}
}

class ExportingSpan extends Tracer.NativeSpan {
	readonly #exporter: ScopedTelemetryExporter;
	readonly #resource: TelemetryResource;
	#ended = false;

	constructor(
		options: Parameters<Tracer.Tracer["span"]>[0],
		exporter: ScopedTelemetryExporter,
		resource: TelemetryResource,
	) {
		super(options);
		this.#exporter = exporter;
		this.#resource = resource;
	}

	override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
		if (this.#ended) return;
		this.#ended = true;
		super.end(endTime, exit);
		if (!this.sampled) return;
		const outcome = spanOutcome(exit);
		const durationMs = Math.max(
			0,
			Math.round((Number(endTime - this.startTime) / 1_000_000) * 1_000) / 1_000,
		);
		const parent = Option.getOrUndefined(this.parent);
		this.#exporter.write({
			attributes: safeSpanAttributes(this.attributes),
			duration_ms: durationMs,
			...(outcome.errorCategory ? { error_category: outcome.errorCategory } : {}),
			event: "effect.span",
			kind: this.kind,
			name: boundedIdentifier(this.name) ?? "effect.operation",
			outcome: outcome.outcome,
			...(parent ? { parent_span_id: parent.spanId } : {}),
			resource: resourceFields(this.#resource),
			schema: TELEMETRY_SCHEMA,
			span_id: this.spanId,
			trace_id: this.traceId,
		});
	}
}

function makeTelemetryLogger(exporter: ScopedTelemetryExporter, resource: TelemetryResource) {
	return Logger.make(({ fiber, logLevel, message }) => {
		const safeMessage = safeLogMessage(message);
		const parentSpan = Context.getOrUndefined(fiber.context, Tracer.ParentSpan);
		const currentSpan = parentSpan?._tag === "Span" ? parentSpan : undefined;
		exporter.write({
			annotations: safeRecord(fiber.getRef(References.CurrentLogAnnotations), safeAnnotationNames),
			event: "effect.log",
			fields: safeMessage.fields,
			level: logLevel,
			message: safeMessage.message,
			...(safeMessage.message_dropped ? { message_dropped: true } : {}),
			resource: resourceFields(resource),
			schema: TELEMETRY_SCHEMA,
			...(currentSpan ? { span_id: currentSpan.spanId, trace_id: currentSpan.traceId } : {}),
		});
	});
}

function normalizedResource(resource: TelemetryResource): TelemetryResource {
	const serviceName = boundedIdentifier(resource.serviceName);
	if (!serviceName) {
		throw new TypeError("Telemetry serviceName must be a bounded identifier.");
	}
	const environment = boundedIdentifier(resource.environment);
	const serviceVersion = boundedIdentifier(resource.serviceVersion);
	return {
		serviceName,
		...(environment ? { environment } : {}),
		...(serviceVersion ? { serviceVersion } : {}),
	};
}

export const WorkersConsoleTelemetrySink: TelemetrySink = {
	shutdown: () => undefined,
	start: () => undefined,
	write: (event) => {
		if (event.event === "effect.log" && event.level === "Warn") {
			console.warn(event);
			return;
		}
		if (event.event === "effect.log" && event.level === "Error") {
			console.error(event);
			return;
		}
		console.log(event);
	},
};

export function makeWorkersTelemetryLayer(options: {
	readonly resource: TelemetryResource;
	readonly sink?: TelemetrySink;
}) {
	return Layer.effectContext(
		Effect.acquireRelease(
			Effect.sync(() => {
				const resource = normalizedResource(options.resource);
				const exporter = new ScopedTelemetryExporter(
					resource,
					options.sink ?? WorkersConsoleTelemetrySink,
				);
				const logger = makeTelemetryLogger(exporter, resource);
				const tracer = Tracer.make({
					span: (spanOptions) => new ExportingSpan(spanOptions, exporter, resource),
				});
				const context = Context.empty().pipe(
					Context.add(TelemetryExporter, exporter),
					Context.add(TelemetryResourceContext, resource),
					Context.add(Tracer.Tracer, tracer),
					Context.add(Logger.CurrentLoggers, new Set([logger])),
					Context.add(Metric.MetricRegistry, new Map()),
				);
				return { context, exporter };
			}),
			({ exporter }) => Effect.sync(() => exporter.shutdown()),
		).pipe(Effect.map(({ context }) => context)),
	);
}

export interface TelemetryTestProbe {
	readonly events: TelemetryEvent[];
	readonly shutdowns: TelemetryResource[];
	readonly starts: TelemetryResource[];
}

export function makeTelemetryTestSink(): {
	readonly probe: TelemetryTestProbe;
	readonly sink: TelemetrySink;
} {
	const probe: TelemetryTestProbe = {
		events: [],
		shutdowns: [],
		starts: [],
	};
	return {
		probe,
		sink: {
			shutdown: (resource) => probe.shutdowns.push(resource),
			start: (resource) => probe.starts.push(resource),
			write: (event) => probe.events.push(event),
		},
	};
}
