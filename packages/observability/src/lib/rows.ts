import type { Tracer } from "effect";

import { fittingPrefix, type JsonValue, utf8Length } from "./json.js";

export const SPAN_ROW_SCHEMA = "sketchi.telemetry.span.v1";

/**
 * Pipelines rejects a record over 1 MB ("Individual message must not exceed 1 MB")
 * and a request over 5 MB. A span larger than one row continues in further rows.
 */
export const MAX_ROW_BYTES = 900_000;
export const MAX_BATCH_BYTES = 4_500_000;

export interface TelemetryLogEvent {
	readonly annotations: Readonly<Record<string, JsonValue>>;
	readonly cause?: string;
	readonly fields: Readonly<Record<string, JsonValue>>;
	readonly level: string;
	readonly message: string;
	readonly seq: number;
	readonly time: string;
	readonly type: "log";
	/** Message parts that were neither text nor a record of fields. */
	readonly values?: readonly JsonValue[];
}

export interface TelemetryMetricEvent {
	readonly attributes: Readonly<Record<string, string>>;
	readonly metric: string;
	readonly metric_type: string;
	readonly seq: number;
	readonly time: string;
	readonly type: "metric";
	readonly value: number;
}

export interface TelemetrySpanEvent {
	readonly attributes: Readonly<Record<string, JsonValue>>;
	readonly name: string;
	readonly seq: number;
	readonly time: string;
	readonly type: "event";
}

export interface TelemetryLinkEvent {
	readonly attributes: Readonly<Record<string, JsonValue>>;
	readonly seq: number;
	readonly span_id: string;
	readonly trace_id: string;
	readonly type: "link";
}

export type TelemetryEvent =
	| TelemetryLinkEvent
	| TelemetryLogEvent
	| TelemetryMetricEvent
	| TelemetrySpanEvent;

export type TelemetryOutcome = "failure" | "interrupted" | "success";

/** One finished span, with everything it recorded. */
export interface TelemetrySpan {
	readonly attempt_id?: string;
	readonly attributes: Readonly<Record<string, JsonValue>>;
	readonly cause?: string;
	readonly duration_ms: number;
	readonly end_time: string;
	readonly environment?: string;
	readonly error?: JsonValue;
	readonly error_message?: string;
	readonly error_tag?: string;
	readonly events: readonly TelemetryEvent[];
	readonly kind: Tracer.SpanKind;
	readonly name: string;
	readonly outcome: TelemetryOutcome;
	readonly parent_span_id?: string;
	readonly ray_id?: string;
	readonly run_id?: string;
	readonly service: string;
	readonly service_version?: string;
	readonly span_id: string;
	readonly start_time: string;
	readonly trace_id: string;
}

/** The stream's record: `scripts/telemetry/spans.schema.json`. */
export interface TelemetrySpanRow {
	readonly attempt_id?: string;
	readonly attributes: string;
	readonly cause?: string;
	readonly duration_ms: number;
	readonly end_time: string;
	readonly environment?: string;
	readonly error?: string;
	readonly error_message?: string;
	readonly error_tag?: string;
	readonly events: string;
	readonly kind: string;
	readonly name: string;
	readonly outcome: TelemetryOutcome;
	readonly parent_span_id?: string;
	readonly part_count: number;
	readonly part_index: number;
	readonly ray_id?: string;
	readonly run_id?: string;
	readonly schema: typeof SPAN_ROW_SCHEMA;
	readonly service: string;
	readonly service_version?: string;
	readonly span_id: string;
	readonly start_time: string;
	readonly trace_id: string;
}

type ContentColumn = "attributes" | "cause" | "error" | "error_message" | "events";
const contentColumns: readonly ContentColumn[] = [
	"attributes",
	"events",
	"error_message",
	"error",
	"cause",
];

// Room for the part numbers and the content columns' quotes and keys.
const ROW_OVERHEAD_BYTES = 256;

function rowBytes(row: TelemetrySpanRow): number {
	return utf8Length(JSON.stringify(row));
}

/**
 * The rows that hold `span`. Usually one. When the span is larger than a row, its
 * attributes, events, error message, error and cause continue in order across rows
 * that share the span's other columns; concatenating each by `part_index` restores it.
 */
export function spanRows(span: TelemetrySpan, maxRowBytes = MAX_ROW_BYTES): TelemetrySpanRow[] {
	const content: Record<ContentColumn, string | undefined> = {
		attributes: JSON.stringify(span.attributes),
		cause: span.cause,
		error: span.error === undefined ? undefined : JSON.stringify(span.error),
		error_message: span.error_message,
		events: JSON.stringify(span.events),
	};
	const base = {
		...(span.attempt_id === undefined ? {} : { attempt_id: span.attempt_id }),
		duration_ms: span.duration_ms,
		end_time: span.end_time,
		...(span.environment === undefined ? {} : { environment: span.environment }),
		...(span.error_tag === undefined ? {} : { error_tag: span.error_tag }),
		kind: span.kind,
		name: span.name,
		outcome: span.outcome,
		...(span.parent_span_id === undefined ? {} : { parent_span_id: span.parent_span_id }),
		...(span.ray_id === undefined ? {} : { ray_id: span.ray_id }),
		...(span.run_id === undefined ? {} : { run_id: span.run_id }),
		schema: SPAN_ROW_SCHEMA,
		service: span.service,
		...(span.service_version === undefined ? {} : { service_version: span.service_version }),
		span_id: span.span_id,
		start_time: span.start_time,
		trace_id: span.trace_id,
	} as const;
	const whole: TelemetrySpanRow = {
		...base,
		attributes: content.attributes ?? "{}",
		...(content.cause === undefined ? {} : { cause: content.cause }),
		...(content.error === undefined ? {} : { error: content.error }),
		...(content.error_message === undefined ? {} : { error_message: content.error_message }),
		events: content.events ?? "[]",
		part_count: 1,
		part_index: 0,
	};
	if (rowBytes(whole) <= maxRowBytes) return [whole];

	const empty = { ...base, attributes: "", events: "", part_count: 1, part_index: 0 };
	const budget = maxRowBytes - rowBytes(empty) - ROW_OVERHEAD_BYTES;
	if (budget <= 0) throw new RangeError(`Span "${span.name}" has columns too large for one row.`);
	const parts: Array<Partial<Record<ContentColumn, string>>> = [{}];
	let remaining = budget;
	for (const column of contentColumns) {
		const text = content[column];
		if (text === undefined) continue;
		let start = 0;
		while (start < text.length) {
			const { bytes, end } = fittingPrefix(text, start, remaining);
			if (end === start) {
				parts.push({});
				remaining = budget;
				continue;
			}
			const part = parts[parts.length - 1]!;
			part[column] = (part[column] ?? "") + text.slice(start, end);
			remaining -= bytes;
			start = end;
		}
	}
	return parts.map((part, index) => ({
		...base,
		attributes: part.attributes ?? "",
		...(part.cause === undefined ? {} : { cause: part.cause }),
		...(part.error === undefined ? {} : { error: part.error }),
		...(part.error_message === undefined ? {} : { error_message: part.error_message }),
		events: part.events ?? "",
		part_count: parts.length,
		part_index: index,
	}));
}

/** Groups rows into requests that each stay within Pipelines' request limit. */
export function rowBatches(
	rows: readonly TelemetrySpanRow[],
	maxBatchBytes = MAX_BATCH_BYTES,
): TelemetrySpanRow[][] {
	const batches: TelemetrySpanRow[][] = [];
	let current: TelemetrySpanRow[] = [];
	let currentBytes = 2;
	for (const row of rows) {
		const bytes = rowBytes(row) + 1;
		if (current.length > 0 && currentBytes + bytes > maxBatchBytes) {
			batches.push(current);
			current = [];
			currentBytes = 2;
		}
		current.push(row);
		currentBytes += bytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}
