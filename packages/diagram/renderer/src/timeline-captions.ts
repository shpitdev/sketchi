import {
	orderedTimelineEvents,
	parseTimelineDate,
	type TimelineDate,
	type TimelineDiagram,
} from "@sketchi/diagram-core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Captions at each date's own granularity, with shared context stated once. */
export interface TimelineCaptions {
	/** The shared day and/or timezone, shown once above the axis. */
	readonly header?: string;
	/** Caption per event id; ordered timelines have none. */
	readonly events: ReadonlyMap<string, string>;
	readonly today?: string;
}

interface LocalDate {
	readonly granularity: TimelineDate["granularity"];
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
	readonly millisecond: number;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function zoneName(offsetMinutes: number): string {
	if (offsetMinutes === 0) return "UTC";
	const minutes = Math.abs(offsetMinutes);
	return `UTC${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Instants show in their shared offset, or in UTC when offsets differ. */
function localDate(date: TimelineDate, offsetMinutes: number): LocalDate {
	if (date.granularity !== "instant") return { granularity: date.granularity, ...date.fields };
	const shifted = new Date(date.start + offsetMinutes * 60_000);
	return {
		granularity: "instant",
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		second: shifted.getUTCSeconds(),
		millisecond: shifted.getUTCMilliseconds(),
	};
}

/**
 * Human captions: `09:05` under a shared-day header, otherwise `Sep 1` with
 * the year on the first caption and wherever it changes. Never raw ISO.
 */
export function timelineCaptions(diagram: TimelineDiagram): TimelineCaptions {
	const parsed = new Map<string, TimelineDate>();
	for (const value of [
		...diagram.events.flatMap((event) => [event.date, event.end]),
		diagram.today,
	]) {
		const date = value === undefined ? undefined : parseTimelineDate(value);
		if (value !== undefined && date) parsed.set(value, date);
	}
	if (parsed.size === 0) return { events: new Map() };
	const offsets = new Set(
		[...parsed.values()].flatMap((date) =>
			date.offsetMinutes === undefined ? [] : [date.offsetMinutes],
		),
	);
	const offset = offsets.size === 1 ? ([...offsets][0] ?? 0) : 0;
	const zone = offsets.size > 0 ? zoneName(offset) : undefined;
	const local = new Map([...parsed].map(([value, date]) => [value, localDate(date, offset)]));
	const dates = [...local.values()];
	const first = dates[0]!;
	const sameDay =
		dates.some((date) => date.granularity === "instant") &&
		dates.every(
			(date) =>
				(date.granularity === "day" || date.granularity === "instant") &&
				date.year === first.year &&
				date.month === first.month &&
				date.day === first.day,
		);
	const multiYear = dates.some((date) => date.year !== first.year);
	const seconds = dates.some((date) => date.granularity === "instant" && date.second > 0);
	const millis = dates.some((date) => date.granularity === "instant" && date.millisecond > 0);
	const time = (date: LocalDate) =>
		`${pad(date.hour)}:${pad(date.minute)}${seconds || millis ? `:${pad(date.second)}` : ""}${millis ? `.${pad(date.millisecond, 3)}` : ""}`;
	const monthDay = (date: LocalDate) => `${MONTHS[date.month - 1]} ${date.day}`;
	const format = (date: LocalDate, withYear: boolean): string => {
		if (sameDay) return date.granularity === "instant" ? time(date) : monthDay(date);
		const year = withYear ? ` ${date.year}` : "";
		switch (date.granularity) {
			case "year":
				return String(date.year);
			case "month":
				return `${MONTHS[date.month - 1]}${year}`;
			case "day":
				return `${monthDay(date)}${withYear ? `, ${date.year}` : ""}`;
			case "instant":
				return `${monthDay(date)}${withYear ? `, ${date.year}` : ""}, ${time(date)}`;
		}
	};
	const range = (start: LocalDate, end: LocalDate, withYear: boolean): string => {
		if (sameDay) return `${format(start, false)}–${format(end, false)}`;
		if (start.year !== end.year) return `${format(start, true)} – ${format(end, true)}`;
		const tail = withYear && end.granularity !== "year" ? `, ${end.year}` : "";
		if (start.granularity === "day" && end.granularity === "day" && start.month === end.month)
			return `${monthDay(start)}–${end.day}${tail}`;
		if (start.granularity === "month" && end.granularity === "month")
			return `${MONTHS[start.month - 1]} – ${MONTHS[end.month - 1]}${withYear ? ` ${end.year}` : ""}`;
		return `${format(start, false)} – ${format(end, false)}${tail}`;
	};
	const events = new Map<string, string>();
	let previous: LocalDate | undefined;
	for (const event of orderedTimelineEvents(diagram)) {
		const start = event.date === undefined ? undefined : local.get(event.date);
		if (!start) continue;
		const end = event.end === undefined ? undefined : local.get(event.end);
		// A bare month reads ambiguously after a caption of another precision.
		const withYear =
			start.year !== previous?.year ||
			(start.granularity === "month" && previous.granularity !== "month");
		events.set(event.id, end ? range(start, end, withYear) : format(start, withYear));
		previous = end ?? start;
	}
	const header = sameDay
		? `${monthDay(first)}, ${first.year}${zone ? ` · ${zone}` : ""}`
		: zone
			? `Times in ${zone}`
			: undefined;
	const today = diagram.today === undefined ? undefined : local.get(diagram.today);
	return {
		...(header ? { header } : {}),
		events,
		...(today ? { today: `Today · ${format(today, multiYear)}` } : {}),
	};
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365.2425 * DAY;

/** Milliseconds in each unit a break states its time in. */
export const TIMELINE_DURATION_UNITS = {
	millisecond: 1,
	second: SECOND,
	minute: MINUTE,
	hour: HOUR,
	day: DAY,
	month: YEAR / 12,
	year: YEAR,
} as const;

/**
 * A span of time in the unit a reader would use for it, rounded: `99
 * milliseconds`, `1.5 seconds`, `45 minutes`, `36 hours`, `24 days`,
 * `5 months`, `4.3 years`.
 */
export function timelineDurationCaption(milliseconds: number): string {
	const count = (value: number, unit: keyof typeof TIMELINE_DURATION_UNITS) =>
		`${value} ${unit}${value === 1 ? "" : "s"}`;
	const whole = (unit: keyof typeof TIMELINE_DURATION_UNITS) =>
		count(Math.max(1, Math.round(milliseconds / TIMELINE_DURATION_UNITS[unit])), unit);
	// Under ten of a unit, one decimal keeps the rounding within 5%.
	const tenths = (unit: "second" | "year") => {
		const value = milliseconds / TIMELINE_DURATION_UNITS[unit];
		return count(value < 10 ? Math.round(value * 10) / 10 : Math.round(value), unit);
	};
	if (milliseconds < SECOND) return whole("millisecond");
	if (milliseconds < 2 * MINUTE) return tenths("second");
	if (milliseconds < 2 * HOUR) return whole("minute");
	if (milliseconds < 2 * DAY) return whole("hour");
	if (milliseconds < 60 * DAY) return whole("day");
	if (milliseconds < 2 * YEAR) return whole("month");
	return tenths("year");
}
