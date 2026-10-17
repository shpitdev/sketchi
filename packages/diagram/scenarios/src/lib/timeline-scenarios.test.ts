import { describe, expect, it } from "vitest";
import type { TimelineDiagram } from "@sketchi/diagram-core";
import { evaluateScenarioDiagram } from "./evaluate.js";
import { timelineScenarios } from "./timeline-scenarios.js";

type Event = TimelineDiagram["events"][number];
const withEvent = (
	input: TimelineDiagram,
	predicate: (event: Event) => boolean,
	change: (event: Event) => Event,
): TimelineDiagram => {
	const index = input.events.findIndex(predicate);
	return {
		...input,
		events: input.events.map((event, i) => (i === index ? change(event) : event)),
	};
};

describe("prompt-grounded timeline scenarios", () => {
	it("covers the timeline-native variety the renderer supports", () => {
		const diagrams = timelineScenarios.map((scenario) => scenario.expectedDiagram);
		expect(timelineScenarios.length).toBeGreaterThanOrEqual(9);
		expect(diagrams.some((diagram) => diagram.events.some((event) => event.end))).toBe(true);
		expect(diagrams.some((diagram) => diagram.today)).toBe(true);
		expect(diagrams.some((diagram) => diagram.events.some((event) => event.lane))).toBe(true);
		expect(
			diagrams.some((diagram) => diagram.events.some((event) => event.kind === "milestone")),
		).toBe(true);
		expect(diagrams.some((diagram) => diagram.events.length >= 8)).toBe(true);
		expect(
			diagrams.some((diagram) => diagram.events.some((event) => event.date?.length === 4)),
		).toBe(true);
	});
	for (const scenario of timelineScenarios) {
		it(`${scenario.id}: accepts the fixture and reordered dated input`, () => {
			expect(evaluateScenarioDiagram(scenario, scenario.expectedDiagram).ok).toBe(true);
			expect(
				evaluateScenarioDiagram(scenario, {
					...scenario.expectedDiagram,
					events: [...scenario.expectedDiagram.events].reverse(),
				}).ok,
			).toBe(true);
		});
		it(`${scenario.id}: rejects missing, invented and renamed events`, () => {
			const input = scenario.expectedDiagram;
			expect(
				evaluateScenarioDiagram(scenario, { ...input, events: input.events.slice(1) }).ok,
			).toBe(false);
			expect(
				evaluateScenarioDiagram(scenario, {
					...input,
					events: input.events.map((event, i) =>
						i === 0 ? { ...event, label: "Invented event" } : event,
					),
				}).ok,
			).toBe(false);
			expect(
				evaluateScenarioDiagram(scenario, {
					...input,
					events: [...input.events, { ...input.events[0]!, id: "invented" }],
				}).ok,
			).toBe(false);
		});
		it(`${scenario.id}: rejects wrong dates or explicit order on the model output`, () => {
			const input = scenario.expectedDiagram;
			const wrong = withEvent(
				input,
				(event) => event.end === undefined,
				(event) => ({ ...event, ...(event.date ? { date: "2029-12-31" } : { order: 99 }) }),
			);
			expect(evaluateScenarioDiagram(scenario, wrong).ok).toBe(false);
			expect(evaluateScenarioDiagram(scenario, input, wrong).ok).toBe(false);
		});
	}
	const byId = (id: string) => timelineScenarios.find((scenario) => scenario.id === id)!;
	it.each([
		{
			id: "company-history-timeline",
			name: "a month widened to a day",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.date === "2020-03",
					(event) => ({ ...event, date: "2020-03-01" }),
				),
		},
		{
			id: "release-milestones-timeline",
			name: "a day turned into a midnight instant",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					() => true,
					(event) => ({ ...event, date: `${event.date}T00:00:00Z` }),
				),
		},
		{
			id: "checkout-outage-timeline",
			name: "a milestone drawn as an ordinary event",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.kind === "milestone",
					(event) => ({ ...event, kind: "event" }),
				),
		},
		{
			id: "checkout-outage-timeline",
			name: "an ordinary event promoted to milestone",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.kind === "event",
					(event) => ({ ...event, kind: "milestone" }),
				),
		},
		{
			id: "checkout-outage-timeline",
			name: "a shifted instant",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					() => true,
					(event) => ({ ...event, date: "2026-11-03T13:58:00Z" }),
				),
		},
		{
			id: "launch-phases-timeline",
			name: "a phase flattened to a point",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.end !== undefined,
					({ end: _end, ...event }) => event,
				),
		},
		{
			id: "launch-phases-timeline",
			name: "a phase with the wrong end",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.end !== undefined,
					(event) => ({ ...event, end: "2026-03-31" }),
				),
		},
		{
			id: "launch-phases-timeline",
			name: "a missing Today marker",
			mutate: ({ today: _today, ...input }: TimelineDiagram) => input as TimelineDiagram,
		},
		{
			id: "launch-workstreams-timeline",
			name: "an event in the wrong lane",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.lane === "Marketing",
					(event) => ({ ...event, lane: "Engineering" }),
				),
		},
		{
			id: "launch-workstreams-timeline",
			name: "a third invented lane",
			mutate: ({ lanes: _lanes, ...input }: TimelineDiagram) => ({
				...input,
				events: input.events.map((event, index) =>
					index === 0 ? { ...event, lane: "Marketing ops" } : event,
				),
			}),
		},
		{
			id: "lunar-mission-timeline",
			name: "a dropped description",
			mutate: (input: TimelineDiagram) =>
				withEvent(
					input,
					(event) => event.description !== undefined,
					({ description: _d, ...event }) => event,
				),
		},
	])("$id rejects $name", ({ id, mutate }) => {
		const scenario = byId(id);
		const mutated = mutate(scenario.expectedDiagram);
		expect(evaluateScenarioDiagram(scenario, mutated).ok).toBe(false);
	});
	it("accepts simultaneous events in either order and instants written in another offset", () => {
		const lanes = byId("launch-workstreams-timeline");
		const swapped = [...lanes.expectedDiagram.events];
		const sdk = swapped.findIndex((event) => event.id === "sdk");
		const blog = swapped.findIndex((event) => event.id === "blog");
		[swapped[sdk], swapped[blog]] = [swapped[blog]!, swapped[sdk]!];
		expect(evaluateScenarioDiagram(lanes, { ...lanes.expectedDiagram, events: swapped }).ok).toBe(
			true,
		);
		const outage = byId("checkout-outage-timeline");
		const utc = withEvent(
			outage.expectedDiagram,
			() => true,
			(event) => ({ ...event, date: "2026-11-03T18:58:00Z" }),
		);
		expect(evaluateScenarioDiagram(outage, utc).ok).toBe(true);
	});
});
