// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import {
	DateTime,
	Effect,
	Schema,
	Array as Arr,
	String as Str,
	MutableHashSet as Set,
	Option,
	Result,
} from "effect";
import { cleanToolString, slug } from "../../clean-text";
import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";

export const timelineDiagramType = "timeline" as const;
export const TIMELINE_MAX_EVENTS = 60;
export const TIMELINE_MAX_LANES = 6;
export const TIMELINE_EVENT_KINDS = ["event", "milestone"] as const;
export const TimelineEventKindSchema = Schema.Literals(TIMELINE_EVENT_KINDS);
export type TimelineEventKind = (typeof TIMELINE_EVENT_KINDS)[number];

/** A dated or ordered point, or a dated span when `end` is present. Never a dependency. */
export const TimelineEvent = Schema.Struct({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** Year, month, day, or zoned instant, preserved exactly as supplied. */
	date: Schema.optionalKey(Schema.NonEmptyString),
	/** Inclusive end of a span (phase) that starts at `date`. */
	end: Schema.optionalKey(Schema.NonEmptyString),
	/** Use explicit order only when the source supplies no calendar dates. */
	order: Schema.optionalKey(Schema.Finite),
	kind: Schema.optionalKey(TimelineEventKindSchema),
	/** Track name; every event names one when any does. */
	lane: Schema.optionalKey(Schema.NonEmptyString),
	description: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "TimelineEvent" });

export interface TimelineEvent extends Schema.Schema.Type<typeof TimelineEvent> {}

export const TimelineDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	events: Schema.Array(TimelineEvent).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Track order, top to bottom; defaults to first chronological appearance. */
	lanes: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	/** Draws a Today marker at this date. There is no ambient clock. */
	today: Schema.optionalKey(Schema.NonEmptyString),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface TimelineDocument extends Schema.Schema.Type<typeof TimelineDocument> {}

/** Rendering adds only its stable id and family tag; authored fields have one owner. */
export const TimelineDiagram = TimelineDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(timelineDiagramType),
})).annotate({ identifier: "TimelineDiagram" });

export interface TimelineDiagram extends Schema.Schema.Type<typeof TimelineDiagram> {}

/** Normalize authoring once, retaining dates at their supplied precision and stable ties. */
export function normalizeTimeline(document: TimelineDocument): TimelineDiagram {
	const title = cleanToolString(document.title);
	return {
		id: (document.id && cleanToolString(document.id)) || slug(title) || "sketchi-timeline",
		title,
		type: timelineDiagramType,
		events: orderedTimelineEvents(document),
		...(document.lanes ? { lanes: Arr.copy(document.lanes) } : {}),
		...(document.today ? { today: document.today } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

export type TimelineDateGranularity = "year" | "month" | "day" | "instant";

/** A parsed timeline date: the period it names, in UTC epoch milliseconds. */
export interface TimelineDate {
	readonly granularity: TimelineDateGranularity;
	/** Start of the named period. */
	readonly start: number;
	/** Exclusive end of the named period; equal to `start` for instants. */
	readonly end: number;
	/** Calendar fields as written, in the instant's own offset. */
	readonly fields: {
		readonly year: number;
		readonly month: number;
		readonly day: number;
		readonly hour: number;
		readonly minute: number;
		readonly second: number;
		readonly millisecond: number;
	};
	/** Minutes east of UTC; instants only. */
	readonly offsetMinutes?: number;
}

const TIMELINE_DATE_PATTERN =
	/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/u;

function utc(
	year: number,
	month: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0,
	millisecond = 0,
) {
	return DateTime.toEpochMillis(
		DateTime.makeUnsafe({ year, month, day, hour, minute, second, millisecond }),
	);
}

function daysInMonth(year: number, month: number): number {
	return DateTime.getPartUtc(DateTime.makeUnsafe(utc(year, month + 1, 0)), "day");
}

/**
 * Parse a year (`2026`), month (`2026-09`), day (`2026-09-01`), or instant with
 * an explicit zone (`2026-09-01T09:05Z`, `2026-09-01T09:05:00-07:00`).
 * Overflow fields and zone-less instants are rejected.
 */
export function parseTimelineDate(value: string): TimelineDate | undefined {
	const match = TIMELINE_DATE_PATTERN.exec(value);
	if (!match) return undefined;
	const [, y, mo, d, h, mi, s, ms, zone] = match;
	const year = Number(y);
	const month = mo === undefined ? 1 : Number(mo);
	const day = d === undefined ? 1 : Number(d);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
	if (h === undefined) {
		const granularity = d !== undefined ? "day" : mo !== undefined ? "month" : "year";
		const start = utc(year, month, day);
		const end =
			granularity === "day"
				? utc(year, month, day + 1)
				: granularity === "month"
					? utc(year, month + 1, 1)
					: utc(year + 1, 1, 1);
		return {
			granularity,
			start,
			end,
			fields: { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
		};
	}
	const hour = Number(h);
	const minute = Number(mi);
	const second = s === undefined ? 0 : Number(s);
	const millisecond = ms === undefined ? 0 : Number(Str.padEnd(3, "0")(ms));
	if (hour > 23 || minute > 59 || second > 59 || zone === undefined) return undefined;
	let offsetMinutes = 0;
	if (zone !== "Z") {
		const offsetHours = Number(Str.slice(1, 3)(zone));
		const offsetRest = Number(Str.slice(4, 6)(zone));
		if (offsetHours > 14 || offsetRest > 59) return undefined;
		offsetMinutes = (Str.startsWith("-")(zone) ? -1 : 1) * (offsetHours * 60 + offsetRest);
	}
	const start = utc(year, month, day, hour, minute, second, millisecond) - offsetMinutes * 60_000;
	return {
		granularity: "instant",
		start,
		end: start,
		fields: { year, month, day, hour, minute, second, millisecond },
		offsetMinutes,
	};
}

export function isTimelineDate(value: string): boolean {
	return parseTimelineDate(value) !== undefined;
}

export const TimelineValidationIssueCodeSchema = Schema.Literals([
	"invalid_timeline_date",
	"duplicate_event_id",
	"invalid_timeline_order",
	"invalid_timeline_span",
	"invalid_timeline_lane",
	"timeline_too_large",
]);
export type TimelineValidationIssueCode = typeof TimelineValidationIssueCodeSchema.Type;
export const TimelineValidationIssue = Schema.Struct({
	code: TimelineValidationIssueCodeSchema,
	path: Schema.String,
	message: Schema.String,
	hint: Schema.String,
});
export interface TimelineValidationIssue extends Schema.Schema.Type<
	typeof TimelineValidationIssue
> {}

const DATE_HINT =
	"Use YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or ±HH:MM, copied from the source.";

/** The lane order a timeline renders: explicit `lanes`, else first chronological use. */
export function timelineLanes(diagram: TimelineDiagram): string[] {
	if (diagram.lanes) return Arr.copy(diagram.lanes);
	const lanes: string[] = [];
	for (const event of orderedTimelineEvents(diagram))
		if (event.lane !== undefined && !Arr.contains(lanes, event.lane)) lanes.push(event.lane);
	return lanes;
}

export function getTimelineValidationIssues(diagram: TimelineDiagram): TimelineValidationIssue[] {
	const issues: TimelineValidationIssue[] = [];
	if (diagram.events.length === 0 || diagram.events.length > TIMELINE_MAX_EVENTS)
		issues.push({
			code: "timeline_too_large",
			path: "events",
			message: `Timeline needs 1–${TIMELINE_MAX_EVENTS} events.`,
			hint: "Provide at least one event, or split a longer chronology into timelines.",
		});
	const ids = Set.empty<string>();
	const dated = diagram.events[0]?.date !== undefined;
	const laned =
		diagram.lanes !== undefined || Arr.some(diagram.events, (event) => event.lane !== undefined);
	Arr.forEach(diagram.events, (event, index) => {
		const path = `events.[${index}]`;
		if (Set.has(ids, event.id))
			issues.push({
				code: "duplicate_event_id",
				path: `${path}.id`,
				message: `Event id "${event.id}" is duplicated.`,
				hint: "Give each event a unique stable id.",
			});
		Set.add(ids, event.id);
		const start = event.date === undefined ? undefined : parseTimelineDate(event.date);
		if (event.date !== undefined && !start)
			issues.push({
				code: "invalid_timeline_date",
				path: `${path}.date`,
				message: `Event "${event.id}" has invalid date "${event.date}".`,
				hint: DATE_HINT,
			});
		if (
			(event.date !== undefined) === (event.order !== undefined) ||
			(event.date !== undefined) !== dated
		)
			issues.push({
				code: "invalid_timeline_order",
				path,
				message:
					"Every event must use exactly one chronology field, with the same date or order mode throughout.",
				hint: "Supply dates for all events, or numeric order for all events; never invent a missing date.",
			});
		if (event.end !== undefined) {
			const end = parseTimelineDate(event.end);
			if (!end)
				issues.push({
					code: "invalid_timeline_date",
					path: `${path}.end`,
					message: `Event "${event.id}" has invalid end "${event.end}".`,
					hint: DATE_HINT,
				});
			else if (
				event.date === undefined ||
				event.kind === "milestone" ||
				(start && end.end <= start.start)
			)
				issues.push({
					code: "invalid_timeline_span",
					path: `${path}.end`,
					message: `Span "${event.id}" needs a date, an end on or after it, and no milestone kind.`,
					hint: "Use end only for dated phases; a milestone is a single point.",
				});
		}
		if (
			laned &&
			(event.lane === undefined || (diagram.lanes && !Arr.contains(diagram.lanes, event.lane)))
		)
			issues.push({
				code: "invalid_timeline_lane",
				path: `${path}.lane`,
				message: `Event "${event.id}" needs one of the timeline's lanes.`,
				hint: "Give every event a lane listed in lanes, or omit lanes everywhere.",
			});
	});
	if (diagram.lanes && Set.size(Set.fromIterable(diagram.lanes)) !== diagram.lanes.length)
		issues.push({
			code: "invalid_timeline_lane",
			path: "lanes",
			message: "Lane names must be unique.",
			hint: "List each lane once, in top-to-bottom order.",
		});
	if (timelineLanes(diagram).length > TIMELINE_MAX_LANES)
		issues.push({
			code: "timeline_too_large",
			path: "lanes",
			message: `Timeline supports at most ${TIMELINE_MAX_LANES} lanes.`,
			hint: "Merge related tracks or split the chronology into timelines.",
		});
	if (diagram.today !== undefined && (!dated || !isTimelineDate(diagram.today)))
		issues.push({
			code: "invalid_timeline_date",
			path: "today",
			message: `Today "${diagram.today}" must be a valid date on a dated timeline.`,
			hint: `${DATE_HINT} Omit today unless the source states it.`,
		});
	return Arr.take(issues, 20);
}

export class TimelineValidationError extends Schema.TaggedError<
	TimelineValidationError,
	{ readonly brand: unique symbol }
>()("TimelineValidationError", {
	message: Schema.String,
	issues: Schema.Array(TimelineValidationIssue),
}) {
	static fromIssues(issues: readonly TimelineValidationIssue[]): TimelineValidationError {
		return TimelineValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Timeline failed validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}
export function validateTimelineDiagram(
	diagram: TimelineDiagram,
): Result.Result<TimelineDiagram, TimelineValidationError> {
	const issues = getTimelineValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(TimelineValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}
export function parseTimelineDiagram(
	input: unknown,
): Result.Result<TimelineDiagram, Schema.SchemaError | TimelineValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(TimelineDiagram, { errors: "all" })(input),
		validateTimelineDiagram,
	);
}
/** Sort key: a date's period start, else the explicit order. */
export function timelineEventTime(event: TimelineEvent): number {
	return event.date !== undefined
		? (parseTimelineDate(event.date)?.start ?? Number.NaN)
		: (event.order ?? 0);
}
/** Equal timestamps/orders keep input order. Authored arrays are never mutated. */
export function orderedTimelineEvents(diagram: Pick<TimelineDocument, "events">): TimelineEvent[] {
	return Arr.sort(diagram.events, (a: TimelineEvent, b: TimelineEvent) => {
		const delta = timelineEventTime(a) - timelineEventTime(b);
		return delta < 0 ? -1 : delta > 0 ? 1 : 0;
	});
}
export const timelineFixture = parseTimelineDiagram({
	id: "release-timeline",
	title: "Release milestones",
	type: "timeline",
	events: [
		{ id: "plan", label: "Scope agreed", date: "2026-09-01" },
		{
			id: "beta",
			label: "Public beta",
			date: "2026-09-15",
			description: "Collect feedback from early users.",
		},
		{ id: "release", label: "General availability", date: "2026-10-01", kind: "milestone" },
	],
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: TimelineDiagram) {
	return {
		nodeCount: diagram.events.length,
		nodeNoun: "events",
		edgeCount: Arr.filter(diagram.events, (event) => event.end !== undefined).length,
		edgeNoun: "phases",
	};
}
