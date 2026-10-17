import {
	parseTimelineDiagram,
	orderedTimelineEvents,
	type TimelineDiagram,
} from "@sketchi/diagram-core";
import type { DiagramScenarioDifficulty } from "./scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

export interface TimelineScenario {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly diagramType: "timeline";
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly logos: readonly [];
	readonly expectedDiagram: TimelineDiagram;
	readonly assertions: {
		readonly events: readonly {
			readonly labels: readonly string[];
			readonly date?: string;
			readonly order?: number;
		}[];
	};
}
function scenario(
	id: string,
	title: string,
	prompt: string,
	events: TimelineDiagram["events"],
): TimelineScenario {
	return {
		id,
		title,
		prompt,
		description: title,
		difficulty: "standard",
		diagramType: "timeline",
		tags: ["timeline", "chronology"],
		logos: [],
		expectedDiagram: parseTimelineDiagram({ id, title, type: "timeline", events }),
		assertions: {
			events: events.map((event) => ({
				labels: [event.label],
				...(event.date !== undefined ? { date: event.date } : { order: event.order ?? 0 }),
			})),
		},
	};
}
export const timelineScenarios: readonly TimelineScenario[] = [
	scenario(
		"release-milestones-timeline",
		"Release milestones",
		"Draw a timeline with exactly these release milestones: Scope agreed on 2026-09-01, Public beta on 2026-09-15, General availability on 2026-10-01. Preserve each date and show them chronologically; do not add events.",
		[
			{ id: "scope", label: "Scope agreed", date: "2026-09-01" },
			{ id: "beta", label: "Public beta", date: "2026-09-15" },
			{ id: "ga", label: "General availability", date: "2026-10-01" },
		],
	),
	scenario(
		"incident-chronology-timeline",
		"Incident chronology",
		"Timeline of exactly four incident events on 2026-10-12 (all UTC): Alert fired at 09:05:00, Rollback started at 09:12:00, Service recovered at 09:18:00, Incident closed at 09:40:00. Preserve the times and chronology. No invented steps.",
		[
			{ id: "alert", label: "Alert fired", date: "2026-10-12T09:05:00Z" },
			{ id: "rollback", label: "Rollback started", date: "2026-10-12T09:12:00Z" },
			{ id: "recovered", label: "Service recovered", date: "2026-10-12T09:18:00Z" },
			{ id: "closed", label: "Incident closed", date: "2026-10-12T09:40:00Z" },
		],
	),
	scenario(
		"project-roadmap-timeline",
		"Project roadmap",
		"Draw a timeline for this project roadmap without calendar dates. In order: Discovery (order 1), Prototype (order 2), Pilot (order 3), Launch (order 4), Retrospective (order 5). Use exactly these five events and their explicit order; do not invent dates or events.",
		[
			{ id: "discovery", label: "Discovery", order: 1 },
			{ id: "prototype", label: "Prototype", order: 2 },
			{ id: "pilot", label: "Pilot", order: 3 },
			{ id: "launch", label: "Launch", order: 4 },
			{ id: "retro", label: "Retrospective", order: 5 },
		],
	),
];

/** Match each prompt event to a distinct model event, with its actual date/order. */
export function timelineScenarioChecks(
	scenario: TimelineScenario,
	diagram: TimelineDiagram,
): ScenarioCheck[] {
	const actual = orderedTimelineEvents(diagram);
	const normalize = (label: string) =>
		label
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim();
	const used = new Set<string>();
	let cursor = -1;
	let ordered = true;
	const checks = scenario.assertions.events.map((expected, index) => {
		const found = actual.findIndex(
			(event) =>
				!used.has(event.id) &&
				expected.labels.some((label) => normalize(event.label).includes(normalize(label))),
		);
		const event = actual[found];
		if (event) used.add(event.id);
		if (found <= cursor || !event) ordered = false;
		cursor = Math.max(cursor, found);
		const chronology =
			event &&
			(expected.date !== undefined
				? event.date !== undefined && Date.parse(event.date) === Date.parse(expected.date)
				: event.date === undefined && event.order === expected.order);
		return {
			id: `timeline-event:${index + 1}`,
			passed: Boolean(event && chronology),
			message: `Expected ${expected.labels.join("|")} at ${expected.date ?? `order ${expected.order}`}.`,
		};
	});
	return [
		{
			id: "timeline-event-count",
			passed: actual.length === scenario.assertions.events.length,
			message: `Expected exactly ${scenario.assertions.events.length} prompt-grounded events.`,
		},
		...checks,
		{
			id: "timeline-event-order",
			passed: ordered,
			message: "Prompt events must appear in chronological order.",
		},
	];
}
