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
import {
	readTimelineAxis,
	readTimelineGaps,
	readTimelineMomentGaps,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
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
		/** Event id to other labels that name it, such as the abbreviation a prompt uses. */
		readonly aliases?: Readonly<Record<string, readonly string[]>>;
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
				labels: [event.label, ...(options.aliases?.[event.id] ?? [])],
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
const releaseMilestones: TimelineDiagram["events"] = [
	{ id: "scope", label: "Scope agreed", date: "2026-09-01" },
	{ id: "beta", label: "Public beta", date: "2026-09-15" },
	{ id: "ga", label: "General availability", date: "2026-10-01" },
];
const incidentChronology: TimelineDiagram["events"] = [
	{ id: "alert", label: "Alert fired", date: "2026-10-12T09:05:00Z" },
	{ id: "rollback", label: "Rollback started", date: "2026-10-12T09:12:00Z" },
	{ id: "recovered", label: "Service recovered", date: "2026-10-12T09:18:00Z" },
	{ id: "closed", label: "Incident closed", date: "2026-10-12T09:40:00Z" },
];
const projectRoadmap: TimelineDiagram["events"] = [
	{ id: "discovery", label: "Discovery", order: 1 },
	{ id: "prototype", label: "Prototype", order: 2 },
	{ id: "pilot", label: "Pilot", order: 3 },
	{ id: "launch", label: "Launch", order: 4 },
	{ id: "retro", label: "Retrospective", order: 5 },
];
const companyHistory: TimelineDiagram["events"] = [
	{ id: "founded", label: "Founded", date: "2019" },
	{ id: "seed", label: "Seed round", date: "2020-03" },
	{ id: "launch", label: "Public launch", date: "2021-06-14" },
	{ id: "enterprise", label: "First enterprise customer", date: "2021-11" },
	{ id: "users", label: "1 million users", date: "2023" },
];
const checkoutOutage: TimelineDiagram["events"] = [
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
];
const libraryReleases: TimelineDiagram["events"] = [
	{ id: "v01", label: "v0.1", date: "2026-01-05" },
	{ id: "v02", label: "v0.2", date: "2026-01-12" },
	{ id: "v03", label: "v0.3", date: "2026-01-19" },
	{ id: "v10", label: "v1.0", date: "2026-06-30" },
	{ id: "v20", label: "v2.0", date: "2028-03-01" },
];
const launchPhases: TimelineDiagram["events"] = [
	{ id: "discovery", label: "Discovery", date: "2026-01-05", end: "2026-02-13" },
	{ id: "freeze", label: "Design freeze", date: "2026-02-13", kind: "milestone" },
	{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29" },
	{ id: "beta", label: "Beta", date: "2026-06-01", end: "2026-07-31" },
	{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone" },
];
const launchWorkstreams: TimelineDiagram["events"] = [
	{ id: "waitlist", label: "Waitlist opens", date: "2026-02-16", lane: "Marketing" },
	{ id: "api", label: "API beta", date: "2026-03-02", lane: "Engineering" },
	{ id: "sdk", label: "SDK release", date: "2026-04-15", lane: "Engineering" },
	{ id: "blog", label: "Launch blog", date: "2026-04-15", lane: "Marketing" },
	{ id: "hardening", label: "GA hardening", date: "2026-05-20", lane: "Engineering" },
	{ id: "talk", label: "Conference talk", date: "2026-06-10", lane: "Marketing" },
];
const lunarMission: TimelineDiagram["events"] = [
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
];

export const timelineScenarios: readonly TimelineScenario[] = [
	scenario(
		"release-milestones-timeline",
		"Release milestones",
		"Draw a timeline with exactly these release milestones: Scope agreed on 2026-09-01, Public beta on 2026-09-15, General availability on 2026-10-01. Preserve each date and show them chronologically; do not add events.",
		releaseMilestones,
	),
	scenario(
		"release-milestones-timeline-v2",
		"Release milestones",
		"timeline: scope agreed 9/1, public beta 9/15, GA 10/1 (2026)",
		releaseMilestones,
		// The prompt says GA, so GA names general availability.
		{ tags: ["real-voice"], aliases: { ga: ["GA"] } },
	),
	scenario(
		"incident-chronology-timeline",
		"Incident chronology",
		"Timeline of exactly four incident events on 2026-10-12 (all UTC): Alert fired at 09:05:00, Rollback started at 09:12:00, Service recovered at 09:18:00, Incident closed at 09:40:00. Preserve the times and chronology. No invented steps.",
		incidentChronology,
	),
	scenario(
		"incident-chronology-timeline-v2",
		"Incident chronology",
		"timeline of the incident (oct 12 2026, UTC)\n09:05 alert fired\n09:12 rollback started\n09:18 service recovered\n09:40 incident closed",
		incidentChronology,
		{ tags: ["real-voice"] },
	),
	scenario(
		"project-roadmap-timeline",
		"Project roadmap",
		"Draw a timeline for this project roadmap without calendar dates. In order: Discovery (order 1), Prototype (order 2), Pilot (order 3), Launch (order 4), Retrospective (order 5). Use exactly these five events and their explicit order; do not invent dates or events.",
		projectRoadmap,
	),
	scenario(
		"project-roadmap-timeline-v2",
		"Project roadmap",
		"roadmap timeline, no dates yet: discovery → prototype → pilot → launch → retrospective",
		projectRoadmap,
		{ tags: ["real-voice"] },
	),
	scenario(
		"company-history-timeline",
		"Company history",
		"Draw a timeline of our company history and keep each date at the precision I give: Founded in 2019, Seed round in March 2020, Public launch on 2021-06-14, First enterprise customer in November 2021, and 1 million users in 2023. Use exactly these five events.",
		companyHistory,
		{ tags: ["mixed-granularity"] },
	),
	scenario(
		"company-history-timeline-v2",
		"Company history",
		"timeline of our company history\n2019 founded\nmarch 2020 seed round\njune 14 2021 public launch\nnov 2021 first enterprise customer\n2023 1 million users",
		companyHistory,
		{ tags: ["mixed-granularity", "real-voice"] },
	),
	scenario(
		"checkout-outage-timeline",
		"Checkout outage",
		"Timeline of the checkout outage on 2026-11-03. All times are US Eastern, UTC-05:00: 13:58 Error rate alert, 14:03 Incident declared, 14:21 Bad deploy identified, 14:24 Rollback complete, 14:47 All clear. Mark Incident declared and All clear as milestones; the rest are ordinary events. Use exactly these five events.",
		checkoutOutage,
		{ tags: ["same-day", "timezone", "milestones"] },
	),
	scenario(
		"checkout-outage-timeline-v2",
		"Checkout outage",
		"timeline for the checkout outage, nov 3 2026, times are ET (UTC-5)\n13:58 error rate alert\n14:03 incident declared\n14:21 bad deploy identified\n14:24 rollback complete\n14:47 all clear\nincident declared and all clear are the milestones",
		checkoutOutage,
		{ tags: ["same-day", "timezone", "milestones", "real-voice"] },
	),
	scenario(
		"library-releases-timeline",
		"Library releases",
		"Show the release history of our open-source library on a timeline whose spacing reflects the real time between releases: v0.1 on 2026-01-05, v0.2 on 2026-01-12, v0.3 on 2026-01-19, v1.0 on 2026-06-30, and v2.0 on 2028-03-01. Use exactly these five releases.",
		libraryReleases,
		{ tags: ["uneven-gaps"] },
	),
	scenario(
		"library-releases-timeline-v2",
		"Library releases",
		"timeline of our lib's releases\nv0.1  2026-01-05\nv0.2  2026-01-12\nv0.3  2026-01-19\nv1.0  2026-06-30\nv2.0  2028-03-01",
		libraryReleases,
		{ tags: ["uneven-gaps", "real-voice"] },
	),
	scenario(
		"launch-phases-timeline",
		"Launch phases",
		"Plan our product launch as a timeline with three phases: Discovery from 2026-01-05 to 2026-02-13, Build from 2026-02-16 to 2026-05-29, and Beta from 2026-06-01 to 2026-07-31. Add two milestones: Design freeze on 2026-02-13 and Launch on 2026-08-04. Today is 2026-03-10, so mark today. Use exactly these five items.",
		launchPhases,
		{ tags: ["phases", "spans", "today"], today: "2026-03-10" },
	),
	scenario(
		"launch-phases-timeline-v2",
		"Launch phases",
		"launch plan timeline (2026)\nphases: discovery jan 5 - feb 13, build feb 16 - may 29, beta jun 1 - jul 31\nmilestones: design freeze feb 13, launch aug 4\ntoday's mar 10, mark it",
		launchPhases,
		{ tags: ["phases", "spans", "today", "real-voice"], today: "2026-03-10" },
	),
	scenario(
		"launch-workstreams-timeline",
		"Launch workstreams",
		"Draw a timeline with two lanes, Engineering and Marketing. Engineering: API beta on 2026-03-02, SDK release on 2026-04-15, GA hardening on 2026-05-20. Marketing: Waitlist opens on 2026-02-16, Launch blog on 2026-04-15, Conference talk on 2026-06-10. Use exactly these six events, each in its own lane.",
		launchWorkstreams,
		{ tags: ["lanes"], lanes: ["Engineering", "Marketing"] },
	),
	scenario(
		"launch-workstreams-timeline-v2",
		"Launch workstreams",
		"timeline with a lane each for engineering and marketing (2026)\nengineering: API beta 3/2, SDK release 4/15, GA hardening 5/20\nmarketing: waitlist opens 2/16, launch blog 4/15, conference talk 6/10",
		launchWorkstreams,
		{ tags: ["lanes", "real-voice"], lanes: ["Engineering", "Marketing"] },
	),
	scenario(
		"lunar-mission-timeline",
		"Lunar mission",
		"Make a timeline of the Lunar Pathfinder mission with these ten events: Launch on 2027-03-14; Trans-lunar injection on 2027-03-15; Lunar orbit insertion on 2027-03-19; First science image on 2027-03-24; Orbit lowered to 50 km on 2027-04-08; Lander separation on 2027-05-02; Touchdown on 2027-05-03; First rover drive on 2027-05-10; Primary mission ends on 2027-11-03; Extended mission ends on 2028-06-30. Give Touchdown the description 'First soft landing near the south pole.' Keep exactly these ten events.",
		lunarMission,
		{ tags: ["long", "descriptions"], difficulty: "challenge" },
	),
	scenario(
		"lunar-mission-timeline-v2",
		"Lunar mission",
		"Lunar Pathfinder mission timeline\n\ndate        event                    note\n2027-03-14  Launch\n2027-03-15  Trans-lunar injection\n2027-03-19  Lunar orbit insertion\n2027-03-24  First science image\n2027-04-08  Orbit lowered to 50 km\n2027-05-02  Lander separation\n2027-05-03  Touchdown                First soft landing near the south pole.\n2027-05-10  First rover drive\n2027-11-03  Primary mission ends\n2028-06-30  Extended mission ends",
		lunarMission,
		{ tags: ["long", "descriptions", "real-voice"], difficulty: "challenge" },
	),
];

/** Same period at the same precision; instants may use any offset. */
function sameTimelineDate(actual: string | undefined, expected: string): boolean {
	const a = actual === undefined ? undefined : parseTimelineDate(actual);
	const b = parseTimelineDate(expected);
	return Boolean(a && b && a.granularity === b.granularity && a.start === b.start);
}

const normalize = (label: string) =>
	label
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Keep field matching; inline text must be exactly name + separator + description. */
function matchesTimelineDescription(
	event: TimelineEvent,
	expected: TimelineScenarioEvent,
): boolean {
	if (expected.description === undefined) return true;
	const description = normalize(expected.description);
	if (normalize(event.description ?? "").includes(description)) return true;
	// Require punctuation or a line break, not just the name somewhere in the label.
	for (const separator of event.label.matchAll(/[^\p{L}\p{N}\s]|\n/gu)) {
		const name = normalize(event.label.slice(0, separator.index));
		const detail = normalize(event.label.slice(separator.index + separator[0].length));
		if (expected.labels.some((label) => normalize(label) === name) && detail === description)
			return true;
	}
	return false;
}

/** Each prompt event's distinct model event, in prompt order, matched by label. */
function matchTimelineEvents(
	scenario: TimelineScenario,
	actual: readonly TimelineEvent[],
): (TimelineEvent | undefined)[] {
	const used = new Set<string>();
	return scenario.assertions.events.map((expected) => {
		const event = actual.find(
			(candidate) =>
				!used.has(candidate.id) &&
				expected.labels.some((label) => normalize(candidate.label).includes(normalize(label))),
		);
		if (event) used.add(event.id);
		return event;
	});
}

/** Match each prompt event to a distinct model event, with its actual date/order. */
export function timelineScenarioChecks(
	scenario: TimelineScenario,
	diagram: TimelineDiagram,
): ScenarioCheck[] {
	const actual = orderedTimelineEvents(diagram);
	const matched = matchTimelineEvents(scenario, actual);
	let previous: TimelineEvent | undefined;
	let ordered = true;
	const checks = scenario.assertions.events.map((expected, index) => {
		const event = matched[index];
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
			matchesTimelineDescription(event, expected);
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

/** Drawn gaps may differ from one shared scale by this fraction. */
const SPACING_TOLERANCE = 0.05;

/** Each matched model event's moment by the prompt's own dates. */
function promptMoments(scenario: TimelineScenario, diagram: TimelineDiagram) {
	const matched = matchTimelineEvents(scenario, orderedTimelineEvents(diagram));
	return new Map(
		scenario.assertions.events.flatMap((expected, index) => {
			const event = matched[index];
			const start = expected.date === undefined ? undefined : parseTimelineDate(expected.date);
			if (!event || !start) return [];
			const end = expected.end === undefined ? undefined : parseTimelineDate(expected.end);
			return [[event.id, { start: start.start, ...(end ? { end: end.end } : {}) }] as const];
		}),
	);
}

/**
 * Dated prompts: every drawn gap between the prompt's events is to one scale,
 * measured against the prompt's own dates, unless an axis break marks that gap.
 */
export function timelineSpacingCheck(
	scenario: TimelineScenario,
	diagram: TimelineDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const moments = promptMoments(scenario, diagram);
	const gaps = readTimelineGaps(scene, moments).filter((gap) => !gap.broken);
	const rates = gaps.map((gap) => gap.drawn / gap.elapsed);
	const low = Math.min(...rates);
	const high = Math.max(...rates);
	const typical = rates.toSorted((a, b) => a - b)[Math.floor(rates.length / 2)]!;
	const offness = rates.map((rate) => Math.abs(Math.log(rate / typical)));
	const worst = gaps[offness.indexOf(Math.max(...offness))];
	const passed = gaps.length < 2 || (low > 0 && high / low <= 1 + SPACING_TOLERANCE);
	return {
		id: "timeline-spacing",
		passed,
		message: passed
			? `${gaps.length} unbroken gap(s) are drawn to one scale of the prompt's real time.`
			: `Unbroken gaps differ from one time scale by ${Math.round((high / low - 1) * 100)}% (${worst?.from} → ${worst?.to}); compress a gap only with an axis break there.`,
	};
}

/** A break's stated time may differ from its gap's by this rounding. */
const BREAK_LABEL_TOLERANCE = 0.25;

/**
 * Dated prompts: gaps between the prompt's events, across lanes, are drawn in
 * the order of their real elapsed time, broken or not, and every axis break
 * states the time it leaves out. A break that stretches a gap past the shared
 * scale, to make room for crowded labels, stays out of the order.
 */
export function timelineGapOrderCheck(
	scenario: TimelineScenario,
	diagram: TimelineDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const gaps = readTimelineMomentGaps(scene, promptMoments(scenario, diagram));
	const rate = Math.max(
		0,
		...gaps.filter((gap) => !gap.breaks.length).map((gap) => gap.drawn / gap.elapsed),
	);
	const ordered = gaps.filter(
		(gap) => !gap.breaks.length || !rate || gap.drawn <= gap.elapsed * rate * 1.01,
	);
	const name = (gap: (typeof gaps)[number]) => `${gap.from} → ${gap.to}`;
	const result = (passed: boolean, message: string): ScenarioCheck => ({
		id: "timeline-gap-order",
		passed,
		message,
	});
	// Half again the time beside a break must draw longer, not just as long.
	for (const longer of ordered)
		for (const shorter of ordered)
			if (
				longer.elapsed > shorter.elapsed &&
				(longer.drawn < shorter.drawn - 0.5 ||
					(longer.elapsed >= 1.5 * shorter.elapsed &&
						(longer.breaks.length > 0 || shorter.breaks.length > 0) &&
						longer.drawn < shorter.drawn + 1))
			)
				return result(
					false,
					`${name(longer)} has more time than ${name(shorter)} but draws no longer; break long gaps on an increasing scale.`,
				);
	const lanes = readTimelineAxis(scene);
	const breaks = lanes.flatMap((lane) => lane.breaks);
	const bars = lanes.flatMap((lane) =>
		[...lane.markers.values()].flatMap((marker) =>
			marker.end === undefined ? [] : [{ start: marker.start, end: marker.end }],
		),
	);
	const unlabeled = breaks.find((mark) => mark.duration === undefined);
	if (unlabeled)
		return result(
			false,
			`An axis break${unlabeled.label ? ` labeled "${unlabeled.label}"` : ""} does not state the time it leaves out.`,
		);
	for (const gap of gaps)
		for (const mark of gap.breaks) {
			const ratio = mark.duration! / gap.elapsed;
			// Today, a phase's label stem or a second break splits the gap, so its
			// break states only a part of it.
			const part =
				gap.today ||
				gap.breaks.length > 1 ||
				bars.some((bar) => bar.start < mark.at && bar.end > mark.at);
			if (ratio > 1 + BREAK_LABEL_TOLERANCE || (!part && ratio < 1 - BREAK_LABEL_TOLERANCE))
				return result(
					false,
					`The break in ${name(gap)} states "${mark.label}", not its real time.`,
				);
		}
	return result(
		true,
		`${gaps.length} gap(s) are drawn in elapsed order, and ${breaks.length} break mark(s) state their time.`,
	);
}
