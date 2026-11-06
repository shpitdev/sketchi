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

const crosstownTram: TimelineDiagram["events"] = [
	{ id: "feasibility-study-starts", label: "Feasibility study starts", date: "2024-01-15" },
	{ id: "public-consultation-opens", label: "Public consultation opens", date: "2024-03-04" },
	{ id: "consultation-closes", label: "Consultation closes", date: "2024-04-29" },
	{ id: "route-options-published", label: "Route options published", date: "2024-06-10" },
	{ id: "preferred-route-chosen", label: "Preferred route chosen", date: "2024-07-22" },
	{ id: "environmental-survey-begins", label: "Environmental survey begins", date: "2024-09-02" },
	{ id: "funding-bid-submitted", label: "Funding bid submitted", date: "2024-10-14" },
	{ id: "federal-grant-awarded", label: "Federal grant awarded", date: "2024-12-09" },
	{ id: "design-consultants-hired", label: "Design consultants hired", date: "2025-01-20" },
	{ id: "station-locations-fixed", label: "Station locations fixed", date: "2025-02-17" },
	{ id: "land-acquisition-starts", label: "Land acquisition starts", date: "2025-03-31" },
	{ id: "utility-relocation-begins", label: "Utility relocation begins", date: "2025-05-12" },
	{ id: "preliminary-design-approved", label: "Preliminary design approved", date: "2025-06-23" },
	{ id: "main-contractor-selected", label: "Main contractor selected", date: "2025-08-04" },
	{ id: "groundbreaking-ceremony", label: "Groundbreaking ceremony", date: "2025-09-15" },
	{ id: "depot-construction-begins", label: "Depot construction begins", date: "2025-10-27" },
	{ id: "first-track-section-laid", label: "First track section laid", date: "2025-12-08" },
	{ id: "bridge-foundations-poured", label: "Bridge foundations poured", date: "2026-01-19" },
	{ id: "tunnel-boring-starts", label: "Tunnel boring starts", date: "2026-03-02" },
	{ id: "first-station-roof-completed", label: "First station roof completed", date: "2026-04-13" },
	{ id: "signalling-contract-signed", label: "Signalling contract signed", date: "2026-05-25" },
	{ id: "tunnel-breakthrough", label: "Tunnel breakthrough", date: "2026-07-06" },
	{
		id: "overhead-power-lines-installed",
		label: "Overhead power lines installed",
		date: "2026-08-17",
	},
	{ id: "first-trams-delivered", label: "First trams delivered", date: "2026-09-28" },
	{ id: "depot-handed-over", label: "Depot handed over", date: "2026-11-09" },
	{ id: "track-welding-complete", label: "Track welding complete", date: "2026-12-21" },
	{ id: "power-on-testing", label: "Power-on testing", date: "2027-02-01" },
	{ id: "first-test-run", label: "First test run", date: "2027-03-15" },
	{ id: "driver-training-begins", label: "Driver training begins", date: "2027-04-26" },
	{ id: "ticketing-system-live", label: "Ticketing system live", date: "2027-06-07" },
	{ id: "safety-certification-granted", label: "Safety certification granted", date: "2027-07-19" },
	{ id: "trial-operations-start", label: "Trial operations start", date: "2027-08-30" },
	{ id: "accessibility-audit-passed", label: "Accessibility audit passed", date: "2027-10-11" },
	{ id: "opening-ceremony", label: "Opening ceremony", date: "2027-11-22" },
	{ id: "passenger-service-begins", label: "Passenger service begins", date: "2027-11-23" },
	{
		id: "timetable-expanded-to-7-minutes",
		label: "Timetable expanded to 7 minutes",
		date: "2028-01-10",
	},
	{ id: "park-and-ride-lot-opens", label: "Park-and-ride lot opens", date: "2028-03-20" },
	{ id: "one-millionth-passenger", label: "One millionth passenger", date: "2028-05-01" },
	{ id: "northern-extension-approved", label: "Northern extension approved", date: "2028-07-03" },
	{ id: "first-year-review-published", label: "First-year review published", date: "2028-09-11" },
];

export const timelineScenarios: readonly TimelineScenario[] = [
	scenario(
		"release-milestones-timeline-v2",
		"Release milestones",
		"timeline: scope agreed 9/1, public beta 9/15, GA 10/1 (2026)",
		releaseMilestones,
		// The prompt says GA, so GA names general availability.
		{ tags: ["real-voice"], aliases: { ga: ["GA"] } },
	),
	scenario(
		"incident-chronology-timeline-v2",
		"Incident chronology",
		"timeline of the incident (oct 12 2026, UTC)\n09:05 alert fired\n09:12 rollback started\n09:18 service recovered\n09:40 incident closed",
		incidentChronology,
		{ tags: ["real-voice"] },
	),
	scenario(
		"project-roadmap-timeline-v2",
		"Project roadmap",
		"roadmap timeline, no dates yet: discovery → prototype → pilot → launch → retrospective",
		projectRoadmap,
		{ tags: ["real-voice"] },
	),
	scenario(
		"company-history-timeline-v2",
		"Company history",
		"timeline of our company history\n2019 founded\nmarch 2020 seed round\njune 14 2021 public launch\nnov 2021 first enterprise customer\n2023 1 million users",
		companyHistory,
		{ tags: ["mixed-granularity", "real-voice"] },
	),
	scenario(
		"checkout-outage-timeline-v2",
		"Checkout outage",
		"timeline for the checkout outage, nov 3 2026, times are ET (UTC-5)\n13:58 error rate alert\n14:03 incident declared\n14:21 bad deploy identified\n14:24 rollback complete\n14:47 all clear\nincident declared and all clear are the milestones",
		checkoutOutage,
		{ tags: ["same-day", "timezone", "milestones", "real-voice"] },
	),
	scenario(
		"library-releases-timeline-v2",
		"Library releases",
		"timeline of our lib's releases\nv0.1  2026-01-05\nv0.2  2026-01-12\nv0.3  2026-01-19\nv1.0  2026-06-30\nv2.0  2028-03-01",
		libraryReleases,
		{ tags: ["uneven-gaps", "real-voice"] },
	),
	scenario(
		"launch-phases-timeline-v2",
		"Launch phases",
		"launch plan timeline (2026)\nphases: discovery jan 5 - feb 13, build feb 16 - may 29, beta jun 1 - jul 31\nmilestones: design freeze feb 13, launch aug 4\ntoday's mar 10, mark it",
		launchPhases,
		{ tags: ["phases", "spans", "today", "real-voice"], today: "2026-03-10" },
	),
	scenario(
		"launch-workstreams-timeline-v2",
		"Launch workstreams",
		"timeline with a lane each for engineering and marketing (2026)\nengineering: API beta 3/2, SDK release 4/15, GA hardening 5/20\nmarketing: waitlist opens 2/16, launch blog 4/15, conference talk 6/10",
		launchWorkstreams,
		{ tags: ["lanes", "real-voice"], lanes: ["Engineering", "Marketing"] },
	),
	scenario(
		"lunar-mission-timeline-v2",
		"Lunar mission",
		"Lunar Pathfinder mission timeline\n\ndate        event                    note\n2027-03-14  Launch\n2027-03-15  Trans-lunar injection\n2027-03-19  Lunar orbit insertion\n2027-03-24  First science image\n2027-04-08  Orbit lowered to 50 km\n2027-05-02  Lander separation\n2027-05-03  Touchdown                First soft landing near the south pole.\n2027-05-10  First rover drive\n2027-11-03  Primary mission ends\n2028-06-30  Extended mission ends",
		lunarMission,
		{ tags: ["long", "descriptions", "real-voice"], difficulty: "challenge" },
	),
	scenario(
		"crosstown-tram-timeline-large",
		"Crosstown tram project",
		"timeline of the Crosstown tram project, all 40 milestones\n\n2024-01-15  Feasibility study starts\n2024-03-04  Public consultation opens\n2024-04-29  Consultation closes\n2024-06-10  Route options published\n2024-07-22  Preferred route chosen\n2024-09-02  Environmental survey begins\n2024-10-14  Funding bid submitted\n2024-12-09  Federal grant awarded\n2025-01-20  Design consultants hired\n2025-02-17  Station locations fixed\n2025-03-31  Land acquisition starts\n2025-05-12  Utility relocation begins\n2025-06-23  Preliminary design approved\n2025-08-04  Main contractor selected\n2025-09-15  Groundbreaking ceremony\n2025-10-27  Depot construction begins\n2025-12-08  First track section laid\n2026-01-19  Bridge foundations poured\n2026-03-02  Tunnel boring starts\n2026-04-13  First station roof completed\n2026-05-25  Signalling contract signed\n2026-07-06  Tunnel breakthrough\n2026-08-17  Overhead power lines installed\n2026-09-28  First trams delivered\n2026-11-09  Depot handed over\n2026-12-21  Track welding complete\n2027-02-01  Power-on testing\n2027-03-15  First test run\n2027-04-26  Driver training begins\n2027-06-07  Ticketing system live\n2027-07-19  Safety certification granted\n2027-08-30  Trial operations start\n2027-10-11  Accessibility audit passed\n2027-11-22  Opening ceremony\n2027-11-23  Passenger service begins\n2028-01-10  Timetable expanded to 7 minutes\n2028-03-20  Park-and-ride lot opens\n2028-05-01  One millionth passenger\n2028-07-03  Northern extension approved\n2028-09-11  First-year review published",
		crosstownTram,
		{ tags: ["long", "large", "real-voice"], difficulty: "challenge" },
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
