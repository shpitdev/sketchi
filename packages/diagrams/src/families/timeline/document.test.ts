// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
	orderedTimelineEvents,
	parseTimelineDate,
	parseTimelineDiagram,
	TimelineValidationError,
} from "./document.js";

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
		expect(
			parseTimelineDiagram({ ...input, events: [{ id: "a", label: "A", date }] }),
		).toMatchObject({ failure: expect.any(Error) });
	});
	it("accepts leap days and UTC incident timestamps", () => {
		expect(
			parseTimelineDiagram({
				...input,
				events: [
					{ id: "a", label: "A", date: "2024-02-29" },
					{ id: "b", label: "B", date: "2024-02-29T09:05:00Z" },
				],
			}).pipe(Result.getOrThrow).events,
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
		expect(parseTimelineDiagram({ ...input, events })).toMatchObject({
			failure: expect.any(Error),
		});
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
		}).pipe(Result.getOrThrow);
		expect(orderedTimelineEvents(diagram).map((event) => event.id)).toEqual([
			"founded",
			"seed",
			"late",
			"launch",
		]);
	});
	it("accepts a phase whose inclusive start and end name the same month", () => {
		const diagram = parseTimelineDiagram({
			...input,
			events: [{ id: "m", label: "M", date: "2026-09", end: "2026-09" }],
		}).pipe(Result.getOrThrow);
		expect(diagram.events[0]).toMatchObject({ date: "2026-09", end: "2026-09" });
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
		const error = parseTimelineDiagram({ ...input, ...spec }).pipe(Result.flip, Result.getOrThrow);
		expect(error).toBeInstanceOf(TimelineValidationError);
		if (error._tag !== "TimelineValidationError") return expect.fail(error.message);
		const { issues } = error;
		expect(issues.map((issue) => issue.code)).toContain(code);
		expect(issues.every((issue) => issue.hint.length > 0)).toBe(true);
	});
});
