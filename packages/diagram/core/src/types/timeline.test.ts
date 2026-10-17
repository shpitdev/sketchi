import { describe, expect, it } from "vitest";
import {
	orderedTimelineEvents,
	parseTimelineDate,
	parseTimelineDiagram,
	timelineLanes,
	TimelineValidationError,
} from "./timeline.js";

const input = {
	id: "release",
	title: "Release",
	type: "timeline",
	events: [
		{ id: "ship", label: "Ship", date: "2026-10-17" },
		{ id: "plan", label: "Plan", date: "2026-09-01", description: "Keep the user's scope." },
		{ id: "review", label: "Review", date: "2026-10-17" },
	],
};
describe("canonical timeline", () => {
	it("orders chronologically, retains equal-date input order and preserves authored content", () => {
		const diagram = parseTimelineDiagram(input);
		expect(orderedTimelineEvents(diagram).map((event) => event.id)).toEqual([
			"plan",
			"ship",
			"review",
		]);
		expect(diagram.events).toEqual(input.events);
	});
	it("supports explicit order without inventing calendar dates", () => {
		const diagram = parseTimelineDiagram({
			...input,
			events: [
				{ id: "later", label: "Later", order: 2 },
				{ id: "first", label: "First", order: 1 },
			],
		});
		expect(orderedTimelineEvents(diagram).map((event) => event.label)).toEqual(["First", "Later"]);
		expect(diagram.events.every((event) => event.date === undefined)).toBe(true);
	});
	it.each([
		"2026-02-30",
		"2025-02-29",
		"2026-13-01",
		"October 17",
		"2026-10-17T25:00:00Z",
		"2026-10-17T09:00:00",
		"2026-10-17T09:00+15:00",
		"2026-10-17T09:00+02:60",
		"2026-10-17T09:00:61Z",
		"2026-00",
		"26",
		"2026-10-17T09Z",
	])("rejects invalid or ambiguous date %s", (date) => {
		expect(() =>
			parseTimelineDiagram({ ...input, events: [{ id: "a", label: "A", date }] }),
		).toThrow(Error);
	});
	it("accepts leap days and UTC incident timestamps", () => {
		expect(
			parseTimelineDiagram({
				...input,
				events: [
					{ id: "a", label: "A", date: "2024-02-29" },
					{ id: "b", label: "B", date: "2024-02-29T09:05:00Z" },
				],
			}).events,
		).toHaveLength(2);
	});
	it.each(
		[
			[],
			[
				{ id: "a", label: "A", date: "2026-10-17" },
				{ id: "a", label: "B", date: "2026-10-18" },
			],
			[{ id: "a", label: "A" }],
			[{ id: "a", label: "A", date: "2026-10-17", order: 1 }],
			[
				{ id: "a", label: "A", order: 1 },
				{ id: "b", label: "B", date: "2026-10-17" },
			],
		].map((events) => ({ events })),
	)("rejects empty, duplicate, absent or mixed chronology", ({ events }) => {
		expect(() => parseTimelineDiagram({ ...input, events })).toThrow(Error);
	});

	it.each([
		["2019", "year", "2019-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"],
		["2020-03", "month", "2020-03-01T00:00:00.000Z", "2020-04-01T00:00:00.000Z"],
		["2024-02-29", "day", "2024-02-29T00:00:00.000Z", "2024-03-01T00:00:00.000Z"],
		["2026-10-12T09:05Z", "instant", "2026-10-12T09:05:00.000Z", "2026-10-12T09:05:00.000Z"],
		[
			"2026-11-03T13:58:00-05:00",
			"instant",
			"2026-11-03T18:58:00.000Z",
			"2026-11-03T18:58:00.000Z",
		],
		[
			"2026-10-12T09:05:00.5+05:30",
			"instant",
			"2026-10-12T03:35:00.500Z",
			"2026-10-12T03:35:00.500Z",
		],
	])("parses %s as the %s it names", (value, granularity, start, end) => {
		const date = parseTimelineDate(value);
		expect(date?.granularity).toBe(granularity);
		expect(new Date(date!.start).toISOString()).toBe(start);
		expect(new Date(date!.end).toISOString()).toBe(end);
	});
	it("sorts mixed granularity by period start and zoned instants by real time", () => {
		const diagram = parseTimelineDiagram({
			...input,
			events: [
				{ id: "launch", label: "Launch", date: "2021-06-14" },
				{ id: "founded", label: "Founded", date: "2019" },
				{ id: "seed", label: "Seed", date: "2020-03" },
				{ id: "late", label: "Late", date: "2021-06-14T01:00:00+02:00" },
			],
		});
		expect(orderedTimelineEvents(diagram).map((event) => event.id)).toEqual([
			"founded",
			"seed",
			"late",
			"launch",
		]);
	});
	it("accepts dated spans, milestones, lanes and a stated today, preserving them", () => {
		const events = [
			{ id: "build", label: "Build", date: "2026-02", end: "2026-05", lane: "Eng" },
			{ id: "ship", label: "Ship", date: "2026-06-01", kind: "milestone", lane: "Eng" },
			{ id: "blog", label: "Blog", date: "2026-06-01", lane: "Marketing" },
		];
		const diagram = parseTimelineDiagram({ ...input, events, today: "2026-03-10" });
		expect(diagram.events).toEqual(events);
		expect(diagram.today).toBe("2026-03-10");
		expect(timelineLanes(diagram)).toEqual(["Eng", "Marketing"]);
		expect(
			timelineLanes(parseTimelineDiagram({ ...input, events, lanes: ["Marketing", "Eng"] })),
		).toEqual(["Marketing", "Eng"]);
		// A one-month phase: start and inclusive end name the same month.
		expect(() =>
			parseTimelineDiagram({
				...input,
				events: [{ id: "m", label: "M", date: "2026-09", end: "2026-09" }],
			}),
		).not.toThrow();
	});
	it.each([
		{
			name: "span ending before it starts",
			code: "invalid_timeline_span",
			spec: { events: [{ id: "a", label: "A", date: "2026-05-01", end: "2026-04-30" }] },
		},
		{
			name: "span in order mode",
			code: "invalid_timeline_span",
			spec: { events: [{ id: "a", label: "A", order: 1, end: "2026-04-30" }] },
		},
		{
			name: "milestone with an end",
			code: "invalid_timeline_span",
			spec: {
				events: [{ id: "a", label: "A", date: "2026-04-01", end: "2026-04-30", kind: "milestone" }],
			},
		},
		{
			name: "invalid end",
			code: "invalid_timeline_date",
			spec: { events: [{ id: "a", label: "A", date: "2026-04-01", end: "April 30" }] },
		},
		{
			name: "event without a lane on a laned timeline",
			code: "invalid_timeline_lane",
			spec: {
				events: [
					{ id: "a", label: "A", date: "2026-04-01", lane: "Eng" },
					{ id: "b", label: "B", date: "2026-04-02" },
				],
			},
		},
		{
			name: "lane missing from lanes",
			code: "invalid_timeline_lane",
			spec: { lanes: ["Eng"], events: [{ id: "a", label: "A", date: "2026-04-01", lane: "Ops" }] },
		},
		{
			name: "duplicate lanes",
			code: "invalid_timeline_lane",
			spec: {
				lanes: ["Eng", "Eng"],
				events: [{ id: "a", label: "A", date: "2026-04-01", lane: "Eng" }],
			},
		},
		{
			name: "too many lanes",
			code: "timeline_too_large",
			spec: {
				events: Array.from({ length: 7 }, (_, index) => ({
					id: `e${index}`,
					label: "E",
					date: "2026-04-01",
					lane: `Lane ${index}`,
				})),
			},
		},
		{
			name: "today on an ordered timeline",
			code: "invalid_timeline_date",
			spec: { today: "2026-04-01", events: [{ id: "a", label: "A", order: 1 }] },
		},
		{
			name: "invalid today",
			code: "invalid_timeline_date",
			spec: { today: "now", events: [{ id: "a", label: "A", date: "2026-04-01" }] },
		},
	])("rejects $name with $code and a repair hint", ({ code, spec }) => {
		const error = (() => {
			try {
				parseTimelineDiagram({ ...input, ...spec });
			} catch (caught) {
				return caught;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(TimelineValidationError);
		const { issues } = error as TimelineValidationError;
		expect(issues.map((issue) => issue.code)).toContain(code);
		expect(issues.every((issue) => issue.hint.length > 0)).toBe(true);
	});
});
