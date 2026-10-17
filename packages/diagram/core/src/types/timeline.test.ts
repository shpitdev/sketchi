import { describe, expect, it } from "vitest";
import { orderedTimelineEvents, parseTimelineDiagram } from "./timeline.js";

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
});
