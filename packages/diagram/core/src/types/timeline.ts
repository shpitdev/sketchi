import { Effect, Schema } from "effect";
import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const timelineDiagramType = "timeline" as const;
export const TIMELINE_MAX_EVENTS = 60;
export const TIMELINE_MAX_LANES = 6;
export const TIMELINE_EVENT_KINDS = ["event", "milestone"] as const;
export const TimelineEventKindSchema = Schema.Literals(TIMELINE_EVENT_KINDS);
export type TimelineEventKind = (typeof TIMELINE_EVENT_KINDS)[number];

/** A dated or ordered point, or a dated span when `end` is present. Never a dependency. */
export class TimelineEvent extends Schema.Class<TimelineEvent>("TimelineEvent")({
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
}) {}

export class TimelineDiagram extends Schema.Class<TimelineDiagram>("TimelineDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(timelineDiagramType),
	events: Schema.Array(TimelineEvent).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Track order, top to bottom; defaults to first chronological appearance. */
	lanes: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	/** Draws a Today marker at this date. There is no ambient clock. */
	today: Schema.optionalKey(Schema.NonEmptyString),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const TimelineDiagramSchema = TimelineDiagram;

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
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hour, minute, second, millisecond);
	return date.getTime();
}

function daysInMonth(year: number, month: number): number {
	return new Date(utc(year, month + 1, 0)).getUTCDate();
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
	const millisecond = ms === undefined ? 0 : Number(ms.padEnd(3, "0"));
	if (hour > 23 || minute > 59 || second > 59 || zone === undefined) return undefined;
	let offsetMinutes = 0;
	if (zone !== "Z") {
		const offsetHours = Number(zone.slice(1, 3));
		const offsetRest = Number(zone.slice(4, 6));
		if (offsetHours > 14 || offsetRest > 59) return undefined;
		offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetRest);
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

export interface TimelineValidationIssue {
	readonly code:
		| "invalid_timeline_date"
		| "duplicate_event_id"
		| "invalid_timeline_order"
		| "invalid_timeline_span"
		| "invalid_timeline_lane"
		| "timeline_too_large";
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

const DATE_HINT =
	"Use YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH:mm[:ss] with Z or ±HH:MM, copied from the source.";

/** The lane order a timeline renders: explicit `lanes`, else first chronological use. */
export function timelineLanes(diagram: TimelineDiagram): string[] {
	if (diagram.lanes) return [...diagram.lanes];
	const lanes: string[] = [];
	for (const event of orderedTimelineEvents(diagram))
		if (event.lane !== undefined && !lanes.includes(event.lane)) lanes.push(event.lane);
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
	const ids = new Set<string>();
	const dated = diagram.events[0]?.date !== undefined;
	const laned = diagram.lanes !== undefined || diagram.events.some((event) => event.lane);
	diagram.events.forEach((event, index) => {
		const path = `events.[${index}]`;
		if (ids.has(event.id))
			issues.push({
				code: "duplicate_event_id",
				path: `${path}.id`,
				message: `Event id "${event.id}" is duplicated.`,
				hint: "Give each event a unique stable id.",
			});
		ids.add(event.id);
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
			(event.lane === undefined || (diagram.lanes && !diagram.lanes.includes(event.lane)))
		)
			issues.push({
				code: "invalid_timeline_lane",
				path: `${path}.lane`,
				message: `Event "${event.id}" needs one of the timeline's lanes.`,
				hint: "Give every event a lane listed in lanes, or omit lanes everywhere.",
			});
	});
	if (diagram.lanes && new Set(diagram.lanes).size !== diagram.lanes.length)
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
	return issues.slice(0, 20);
}

export class TimelineValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly TimelineValidationIssue[]) {
		super(issues[0]?.message ?? "Timeline failed validation.");
		this.name = "TimelineValidationError";
	}
}
export function validateTimelineDiagram(diagram: TimelineDiagram): TimelineDiagram {
	const issues = getTimelineValidationIssues(diagram);
	if (issues.length) throw new TimelineValidationError(issues);
	return diagram;
}
export function parseTimelineDiagram(input: unknown): TimelineDiagram {
	return validateTimelineDiagram(
		Schema.decodeUnknownSync(TimelineDiagram, { errors: "all" })(input),
	);
}
/** Sort key: a date's period start, else the explicit order. */
export function timelineEventTime(event: TimelineEvent): number {
	return event.date !== undefined
		? (parseTimelineDate(event.date)?.start ?? Number.NaN)
		: (event.order ?? 0);
}
/** Equal timestamps/orders keep input order. Authored arrays are never mutated. */
export function orderedTimelineEvents(diagram: TimelineDiagram): TimelineEvent[] {
	return diagram.events.toSorted((a, b) => timelineEventTime(a) - timelineEventTime(b) || 0);
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
});
