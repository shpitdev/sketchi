import {
	parseTimelineDate,
	parseTimelineDiagram,
	orderedTimelineEvents,
	timelineEventTime,
	timelineLanes,
	type TimelineDiagram,
	type TimelineEvent,
	type TimelineEventKind,
} from "@sketchi/diagram-core";
import type { DiagramScenarioDifficulty } from "./scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

export interface TimelineScenarioEvent {
	readonly labels: readonly string[];
	readonly date?: string;
	readonly order?: number;
	readonly end?: string;
	readonly kind?: TimelineEventKind;
	readonly lane?: string;
	readonly description?: string;
}

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
		readonly events: readonly TimelineScenarioEvent[];
		readonly today?: string;
		readonly laneCount?: number;
	};
}
function scenario(
	id: string,
	title: string,
	prompt: string,
	events: TimelineDiagram["events"],
	options: {
		readonly tags?: readonly string[];
		readonly today?: string;
		readonly lanes?: readonly string[];
		readonly difficulty?: DiagramScenarioDifficulty;
	} = {},
): TimelineScenario {
	const laneCount = new Set(events.flatMap((event) => (event.lane ? [event.lane] : []))).size;
	return {
		id,
		title,
		prompt,
		description: title,
		difficulty: options.difficulty ?? "standard",
		diagramType: "timeline",
		tags: ["timeline", "chronology", ...(options.tags ?? [])],
		logos: [],
		expectedDiagram: parseTimelineDiagram({
			id,
			title,
			type: "timeline",
			events,
			...(options.lanes ? { lanes: options.lanes } : {}),
			...(options.today ? { today: options.today } : {}),
		}),
		assertions: {
			events: events.map((event) => ({
				labels: [event.label],
				...(event.date !== undefined ? { date: event.date } : { order: event.order ?? 0 }),
				...(event.end ? { end: event.end } : {}),
				...(event.kind ? { kind: event.kind } : {}),
				...(event.lane ? { lane: event.lane } : {}),
				...(event.description ? { description: event.description } : {}),
			})),
			...(options.today ? { today: options.today } : {}),
			...(laneCount ? { laneCount } : {}),
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
	scenario(
		"company-history-timeline",
		"Company history",
		"Draw a timeline of our company history and keep each date at the precision I give: Founded in 2019, Seed round in March 2020, Public launch on 2021-06-14, First enterprise customer in November 2021, and 1 million users in 2023. Use exactly these five events.",
		[
			{ id: "founded", label: "Founded", date: "2019" },
			{ id: "seed", label: "Seed round", date: "2020-03" },
			{ id: "launch", label: "Public launch", date: "2021-06-14" },
			{ id: "enterprise", label: "First enterprise customer", date: "2021-11" },
			{ id: "users", label: "1 million users", date: "2023" },
		],
		{ tags: ["mixed-granularity"] },
	),
	scenario(
		"checkout-outage-timeline",
		"Checkout outage",
		"Timeline of the checkout outage on 2026-11-03. All times are US Eastern, UTC-05:00: 13:58 Error rate alert, 14:03 Incident declared, 14:21 Bad deploy identified, 14:24 Rollback complete, 14:47 All clear. Mark Incident declared and All clear as milestones; the rest are ordinary events. Use exactly these five events.",
		[
			{ id: "alert", label: "Error rate alert", date: "2026-11-03T13:58:00-05:00", kind: "event" },
			{
				id: "declared",
				label: "Incident declared",
				date: "2026-11-03T14:03:00-05:00",
				kind: "milestone",
			},
			{
				id: "cause",
				label: "Bad deploy identified",
				date: "2026-11-03T14:21:00-05:00",
				kind: "event",
			},
			{
				id: "rollback",
				label: "Rollback complete",
				date: "2026-11-03T14:24:00-05:00",
				kind: "event",
			},
			{ id: "clear", label: "All clear", date: "2026-11-03T14:47:00-05:00", kind: "milestone" },
		],
		{ tags: ["same-day", "timezone", "milestones"] },
	),
	scenario(
		"library-releases-timeline",
		"Library releases",
		"Show the release history of our open-source library on a timeline whose spacing reflects the real time between releases: v0.1 on 2026-01-05, v0.2 on 2026-01-12, v0.3 on 2026-01-19, v1.0 on 2026-06-30, and v2.0 on 2028-03-01. Use exactly these five releases.",
		[
			{ id: "v01", label: "v0.1", date: "2026-01-05" },
			{ id: "v02", label: "v0.2", date: "2026-01-12" },
			{ id: "v03", label: "v0.3", date: "2026-01-19" },
			{ id: "v10", label: "v1.0", date: "2026-06-30" },
			{ id: "v20", label: "v2.0", date: "2028-03-01" },
		],
		{ tags: ["uneven-gaps"] },
	),
	scenario(
		"launch-phases-timeline",
		"Launch phases",
		"Plan our product launch as a timeline with three phases: Discovery from 2026-01-05 to 2026-02-13, Build from 2026-02-16 to 2026-05-29, and Beta from 2026-06-01 to 2026-07-31. Add two milestones: Design freeze on 2026-02-13 and Launch on 2026-08-04. Today is 2026-03-10, so mark today. Use exactly these five items.",
		[
			{ id: "discovery", label: "Discovery", date: "2026-01-05", end: "2026-02-13" },
			{ id: "freeze", label: "Design freeze", date: "2026-02-13", kind: "milestone" },
			{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29" },
			{ id: "beta", label: "Beta", date: "2026-06-01", end: "2026-07-31" },
			{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone" },
		],
		{ tags: ["phases", "spans", "today"], today: "2026-03-10" },
	),
	scenario(
		"launch-workstreams-timeline",
		"Launch workstreams",
		"Draw a timeline with two lanes, Engineering and Marketing. Engineering: API beta on 2026-03-02, SDK release on 2026-04-15, GA hardening on 2026-05-20. Marketing: Waitlist opens on 2026-02-16, Launch blog on 2026-04-15, Conference talk on 2026-06-10. Use exactly these six events, each in its own lane.",
		[
			{ id: "waitlist", label: "Waitlist opens", date: "2026-02-16", lane: "Marketing" },
			{ id: "api", label: "API beta", date: "2026-03-02", lane: "Engineering" },
			{ id: "sdk", label: "SDK release", date: "2026-04-15", lane: "Engineering" },
			{ id: "blog", label: "Launch blog", date: "2026-04-15", lane: "Marketing" },
			{ id: "hardening", label: "GA hardening", date: "2026-05-20", lane: "Engineering" },
			{ id: "talk", label: "Conference talk", date: "2026-06-10", lane: "Marketing" },
		],
		{ tags: ["lanes"], lanes: ["Engineering", "Marketing"] },
	),
	scenario(
		"lunar-mission-timeline",
		"Lunar mission",
		"Make a timeline of the Lunar Pathfinder mission with these ten events: Launch on 2027-03-14; Trans-lunar injection on 2027-03-15; Lunar orbit insertion on 2027-03-19; First science image on 2027-03-24; Orbit lowered to 50 km on 2027-04-08; Lander separation on 2027-05-02; Touchdown on 2027-05-03; First rover drive on 2027-05-10; Primary mission ends on 2027-11-03; Extended mission ends on 2028-06-30. Give Touchdown the description 'First soft landing near the south pole.' Keep exactly these ten events.",
		[
			{ id: "launch", label: "Launch", date: "2027-03-14" },
			{ id: "tli", label: "Trans-lunar injection", date: "2027-03-15" },
			{ id: "loi", label: "Lunar orbit insertion", date: "2027-03-19" },
			{ id: "image", label: "First science image", date: "2027-03-24" },
			{ id: "lowered", label: "Orbit lowered to 50 km", date: "2027-04-08" },
			{ id: "separation", label: "Lander separation", date: "2027-05-02" },
			{
				id: "touchdown",
				label: "Touchdown",
				date: "2027-05-03",
				description: "First soft landing near the south pole.",
			},
			{ id: "drive", label: "First rover drive", date: "2027-05-10" },
			{ id: "primary", label: "Primary mission ends", date: "2027-11-03" },
			{ id: "extended", label: "Extended mission ends", date: "2028-06-30" },
		],
		{ tags: ["long", "descriptions"], difficulty: "challenge" },
	),
];

/** Same period at the same precision; instants may use any offset. */
function sameTimelineDate(actual: string | undefined, expected: string): boolean {
	const a = actual === undefined ? undefined : parseTimelineDate(actual);
	const b = parseTimelineDate(expected);
	return Boolean(a && b && a.granularity === b.granularity && a.start === b.start);
}

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
	let previous: TimelineEvent | undefined;
	let ordered = true;
	const checks = scenario.assertions.events.map((expected, index) => {
		const found = actual.findIndex(
			(event) =>
				!used.has(event.id) &&
				expected.labels.some((label) => normalize(event.label).includes(normalize(label))),
		);
		const event = actual[found];
		if (event) used.add(event.id);
		// Simultaneous events may appear in either order.
		if (!event || (previous && timelineEventTime(event) < timelineEventTime(previous)))
			ordered = false;
		previous = event ?? previous;
		const chronology =
			event &&
			(expected.date !== undefined
				? sameTimelineDate(event.date, expected.date)
				: event.date === undefined && event.order === expected.order);
		const details =
			event &&
			(expected.end === undefined
				? event.end === undefined
				: sameTimelineDate(event.end, expected.end)) &&
			(expected.kind === undefined ||
				(expected.kind === "milestone") === (event.kind === "milestone")) &&
			(expected.lane === undefined ||
				normalize(event.lane ?? "").includes(normalize(expected.lane))) &&
			(expected.description === undefined ||
				normalize(event.description ?? "").includes(normalize(expected.description)));
		return {
			id: `timeline-event:${index + 1}`,
			passed: Boolean(event && chronology && details),
			message: `Expected ${expected.labels.join("|")} at ${expected.date ?? `order ${expected.order}`}${expected.end ? ` until ${expected.end}` : ""}${expected.kind ? ` as ${expected.kind}` : ""}${expected.lane ? ` in lane ${expected.lane}` : ""}${expected.description ? ` described "${expected.description}"` : ""}.`,
		};
	});
	const { today, laneCount } = scenario.assertions;
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
		...(today === undefined
			? []
			: [
					{
						id: "timeline-today",
						passed: sameTimelineDate(diagram.today, today),
						message: `Expected the Today marker at ${today}.`,
					},
				]),
		...(laneCount === undefined
			? []
			: [
					{
						id: "timeline-lane-count",
						passed: timelineLanes(diagram).length === laneCount,
						message: `Expected exactly ${laneCount} lanes.`,
					},
				]),
	];
}
