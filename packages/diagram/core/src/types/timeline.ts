import { Effect, Schema } from "effect";
import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";

export const timelineDiagramType = "timeline" as const;
export const TIMELINE_MAX_EVENTS = 60;

/** A point in time, never a scheduled duration or dependency. */
export class TimelineEvent extends Schema.Class<TimelineEvent>("TimelineEvent")({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** ISO calendar day or UTC instant, preserved exactly as supplied. */
	date: Schema.optionalKey(Schema.NonEmptyString),
	/** Use explicit order only when the source supplies no calendar dates. */
	order: Schema.optionalKey(Schema.Finite),
	description: Schema.optionalKey(Schema.NonEmptyString),
}) {}

export class TimelineDiagram extends Schema.Class<TimelineDiagram>("TimelineDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(timelineDiagramType),
	events: Schema.Array(TimelineEvent).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const TimelineDiagramSchema = TimelineDiagram;

export interface TimelineValidationIssue {
	readonly code:
		| "invalid_timeline_date"
		| "duplicate_event_id"
		| "invalid_timeline_order"
		| "timeline_too_large";
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

/** Reject overflow days and timezone-dependent inputs, not just Date.parse failures. */
export function isTimelineDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u.test(value)) return false;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return false;
	const canonical = new Date(timestamp).toISOString();
	return value.length === 10
		? canonical.slice(0, 10) === value
		: canonical === (value.includes(".") ? value : value.replace("Z", ".000Z"));
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
		if (event.date !== undefined && !isTimelineDate(event.date))
			issues.push({
				code: "invalid_timeline_date",
				path: `${path}.date`,
				message: `Event "${event.id}" has invalid date "${event.date}".`,
				hint: "Use a real YYYY-MM-DD day or YYYY-MM-DDTHH:mm:ss[.sss]Z UTC instant.",
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
/** Equal timestamps/orders keep input order. Authored arrays are never mutated. */
export function orderedTimelineEvents(diagram: TimelineDiagram): TimelineEvent[] {
	return diagram.events.toSorted(
		(a, b) =>
			(a.date !== undefined ? Date.parse(a.date) : (a.order ?? 0)) -
			(b.date !== undefined ? Date.parse(b.date) : (b.order ?? 0)),
	);
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
		{ id: "release", label: "General availability", date: "2026-10-01" },
	],
});
