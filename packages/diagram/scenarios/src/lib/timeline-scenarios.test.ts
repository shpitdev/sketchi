import { describe, expect, it } from "vitest";
import type { TimelineDiagram } from "@sketchi/diagram-core";
import { renderDiagram, type RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { evaluateScenarioDiagram } from "./evaluate.js";
import {
	timelineGapOrderCheck,
	timelineScenarios,
	timelineSpacingCheck,
} from "./timeline-scenarios.js";

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
	it("checks every dated scenario's drawn spacing and gap order against the prompt's real time", () => {
		for (const scenario of timelineScenarios) {
			const { checks } = evaluateScenarioDiagram(scenario, scenario.expectedDiagram);
			const dated = scenario.expectedDiagram.events.some((event) => event.date !== undefined);
			for (const id of ["timeline-spacing", "timeline-gap-order"])
				expect(checks.find((check) => check.id === id)?.passed, `${scenario.id} ${id}`).toBe(
					dated ? true : undefined,
				);
		}
	});
	it("library-releases rejects equal breaks for unequal gaps and breaks that hide their time", () => {
		const scenario = byId("library-releases-timeline");
		const scene = renderDiagram(scenario.expectedDiagram);
		const check = (candidate: RenderedDiagramScene) =>
			timelineGapOrderCheck(scenario, scenario.expectedDiagram, candidate);
		expect(check(scene)).toMatchObject({ passed: true });
		const texts = scene.elements.filter((element) => element.type === "text");
		expect(
			texts
				.filter((element) => element.id.startsWith("break-label:"))
				.map((element) => element.text),
		).toEqual(["5 months", "20 months"]);
		type Element = RenderedDiagramScene["elements"][number];
		const markerX = (id: string) => {
			const marker = scene.elements.find(
				(element) => element.type === "node" && element.nodeId === `event:${id}`,
			)!;
			return marker.type === "node" ? marker.x : 0;
		};
		// As #422 drew it: the 610-day gap no longer than the 162-day one.
		const shift = markerX("v10") - markerX("v03") - (markerX("v20") - markerX("v10"));
		const equal = {
			...scene,
			elements: scene.elements.map((element): Element =>
				element.type === "node" && element.nodeId === "event:v20"
					? { ...element, x: element.x + shift }
					: element,
			),
		};
		expect(check(equal)).toMatchObject({ passed: false });
		expect(check(equal).message).toContain(
			"v10 → v20 has more time than v03 → v10 but draws no longer",
		);
		const unlabeled = {
			...scene,
			elements: scene.elements.filter((element) => !element.id.startsWith("break-label:")),
		};
		expect(check(unlabeled)).toMatchObject({ passed: false });
		expect(check(unlabeled).message).toContain("does not state the time");
		const mislabeled = {
			...scene,
			elements: scene.elements.map((element): Element =>
				element.type === "text" && element.text === "20 months"
					? { ...element, text: "5 months" }
					: element,
			),
		};
		expect(check(mislabeled)).toMatchObject({ passed: false });
		expect(check(mislabeled).message).toContain('v10 → v20 states "5 months"');
	});
	it("library-releases rejects a gap compressed without a break and accepts one marked by a break", () => {
		const scenario = byId("library-releases-timeline");
		const scene = renderDiagram(scenario.expectedDiagram);
		expect(timelineSpacingCheck(scenario, scenario.expectedDiagram, scene).passed).toBe(true);
		// Draw v1.0 at about 5x a 7-day gap after v0.3, with the break there removed.
		const position = (id: string) => {
			const marker = scene.elements.find(
				(element) => element.type === "node" && element.nodeId === `event:${id}`,
			)!;
			return marker.type === "node" ? marker.x : 0;
		};
		const week = position("v02") - position("v01");
		const shift = position("v03") + 5 * week - position("v10");
		type Element = RenderedDiagramScene["elements"][number];
		type Line = Extract<Element, { type: "line" }>;
		const tick = (id: string, from: number, to: number): Line => ({
			type: "line",
			id,
			points: [
				{ x: from, y: 0 },
				{ x: to, y: 0 },
			],
		});
		const moved = (element: Element): Element =>
			element.type === "node" && (element.nodeId === "event:v10" || element.nodeId === "event:v20")
				? { ...element, x: element.x + shift }
				: element.type === "line" && element.id.startsWith("break:")
					? tick(element.id, element.points[0].x + shift, element.points[1].x + shift)
					: element;
		const beforeV10 = (element: Element) =>
			element.type === "line" &&
			element.id.startsWith("break:") &&
			element.points[0].x > position("v03") &&
			element.points[0].x < position("v10");
		const compressed = {
			...scene,
			elements: scene.elements.filter((element) => !beforeV10(element)).map(moved),
		};
		const check = timelineSpacingCheck(scenario, scenario.expectedDiagram, compressed);
		expect(check.passed).toBe(false);
		expect(check.message).toContain("v03 → v10");
		// The same compression with a break drawn in that gap is honest.
		const breakAt = (position("v03") + position("v10") + shift) / 2;
		const marked = {
			...compressed,
			elements: [
				...compressed.elements,
				tick("break:0:0:9:a", breakAt - 7, breakAt - 1),
				tick("break:0:0:9:b", breakAt + 1, breakAt + 7),
			],
		};
		expect(timelineSpacingCheck(scenario, scenario.expectedDiagram, marked).passed).toBe(true);
	});
});
