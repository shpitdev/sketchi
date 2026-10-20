import {
	estimateTextWidth,
	formatGanttDay,
	ganttPhases,
	ganttTaskSchedule,
	parseGanttDay,
	parseGanttDiagram,
	type GanttDiagram,
	type GanttTask,
} from "@sketchi/diagram-core";
import {
	GANTT_MIN_BAR_WIDTH,
	ganttCaptions,
	readGanttScene,
	type RenderedDiagramScene,
	type ScenePoint,
} from "@sketchi/diagram-renderer";
import type { DiagramScenarioDifficulty } from "./scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

/** One task the prompt states, with everything about it the prompt fixes. */
export interface GanttScenarioTask {
	/** The key the scenario uses for it; model ids may differ. */
	readonly key: string;
	/** Accepted labels; the first is the prompt's own. */
	readonly labels: readonly string[];
	readonly start: string;
	/** Last day, inclusive; equal to start for a milestone. */
	readonly last: string;
	readonly milestone: boolean;
	readonly phase?: string;
	/** Keys of the tasks that must finish first. */
	readonly dependsOn: readonly string[];
	readonly progress?: number;
}

export interface GanttScenario {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly difficulty: DiagramScenarioDifficulty;
	readonly diagramType: "gantt";
	readonly prompt: string;
	readonly tags: readonly string[];
	readonly logos: readonly [];
	readonly expectedDiagram: GanttDiagram;
	readonly assertions: {
		readonly tasks: readonly GanttScenarioTask[];
		/** Phase names in the prompt's order. */
		readonly phases: readonly string[];
		readonly today?: string;
	};
}

interface ScenarioTaskInput {
	readonly key: string;
	readonly label: string;
	readonly aliases?: readonly string[];
	readonly start: string;
	readonly end?: string;
	readonly duration?: number;
	readonly milestone?: boolean;
	readonly phase?: string;
	readonly after?: readonly string[];
	readonly progress?: number;
}

interface ScenarioInput {
	readonly tasks: readonly ScenarioTaskInput[];
	readonly today?: string;
	readonly tags?: readonly string[];
	readonly difficulty?: DiagramScenarioDifficulty;
}

function scenario(id: string, title: string, prompt: string, input: ScenarioInput): GanttScenario {
	const expectedDiagram = parseGanttDiagram({
		id,
		title,
		type: "gantt",
		tasks: input.tasks.map((task) => ({
			id: task.key,
			label: task.label,
			start: task.start,
			...(task.end !== undefined ? { end: task.end } : {}),
			...(task.duration !== undefined ? { duration: task.duration } : {}),
			...(task.milestone ? { milestone: true } : {}),
			...(task.phase !== undefined ? { phase: task.phase } : {}),
			...(task.after?.length ? { dependsOn: [...task.after] } : {}),
			...(task.progress !== undefined ? { progress: task.progress } : {}),
		})),
		...(input.today ? { today: input.today } : {}),
	});
	return {
		id,
		title,
		prompt,
		description: title,
		difficulty: input.difficulty ?? "standard",
		diagramType: "gantt",
		tags: ["gantt", ...(input.tags ?? [])],
		logos: [],
		expectedDiagram,
		assertions: {
			tasks: expectedDiagram.tasks.map((task, index) => {
				const schedule = ganttTaskSchedule(task)!;
				const source = input.tasks[index]!;
				return {
					key: task.id,
					labels: [task.label, ...(source.aliases ?? [])],
					start: task.start,
					last: formatGanttDay(schedule.milestone ? schedule.start : schedule.end - 1),
					milestone: schedule.milestone,
					...(task.phase !== undefined ? { phase: task.phase } : {}),
					dependsOn: task.dependsOn ?? [],
					...(task.progress !== undefined ? { progress: task.progress } : {}),
				};
			}),
			phases: ganttPhases(expectedDiagram),
			...(input.today ? { today: input.today } : {}),
		},
	};
}

export const ganttScenarios: readonly GanttScenario[] = [
	scenario(
		"app-release-gantt",
		"Mobile app 3.0 release",
		"Draw a Gantt chart of our mobile app 3.0 release. Requirements sign-off runs 2026-04-06 to 2026-04-10 and is 100% done. UX design takes 8 days starting 2026-04-13, after requirements sign-off. Backend API runs 2026-04-13 to 2026-04-30, after requirements sign-off, and is 40% done. iOS app takes 15 days starting 2026-04-21, after UX design. Android app runs 2026-04-21 to 2026-05-08, after UX design. Integration testing takes 5 days starting 2026-05-11, after backend API, iOS app and Android app. Beta release is a milestone on 2026-05-18, after integration testing. App store review runs 2026-05-18 to 2026-05-22, after beta release. Launch is a milestone on 2026-05-26, after app store review.",
		{
			tags: ["dependencies", "milestones", "progress"],
			tasks: [
				{
					key: "requirements",
					label: "Requirements sign-off",
					start: "2026-04-06",
					end: "2026-04-10",
					progress: 100,
				},
				{
					key: "ux",
					label: "UX design",
					start: "2026-04-13",
					duration: 8,
					after: ["requirements"],
				},
				{
					key: "api",
					label: "Backend API",
					start: "2026-04-13",
					end: "2026-04-30",
					after: ["requirements"],
					progress: 40,
				},
				{ key: "ios", label: "iOS app", start: "2026-04-21", duration: 15, after: ["ux"] },
				{
					key: "android",
					label: "Android app",
					start: "2026-04-21",
					end: "2026-05-08",
					after: ["ux"],
				},
				{
					key: "integration",
					label: "Integration testing",
					start: "2026-05-11",
					duration: 5,
					after: ["api", "ios", "android"],
				},
				{
					key: "beta",
					label: "Beta release",
					start: "2026-05-18",
					milestone: true,
					after: ["integration"],
				},
				{
					key: "review",
					label: "App store review",
					start: "2026-05-18",
					end: "2026-05-22",
					after: ["beta"],
				},
				{ key: "launch", label: "Launch", start: "2026-05-26", milestone: true, after: ["review"] },
			],
		},
	),
	scenario(
		"cafe-fit-out-gantt",
		"Harbor Street café fit-out",
		'Make a Gantt chart of the Harbor Street café fit-out in four phases, and mark today as 2026-07-15. Phase "Permits": Building permit runs 2026-06-01 to 2026-06-19; Book inspection takes 3 days starting 2026-06-15. Phase "Demolition": Strip-out runs 2026-06-22 to 2026-06-26, after building permit; Waste removal takes 2 days starting 2026-06-29, after strip-out. Phase "Build-out": Plumbing rough-in runs 2026-06-29 to 2026-07-10, after strip-out; Electrical rough-in runs 2026-06-29 to 2026-07-08, after strip-out; Drywall takes 7 days starting 2026-07-13, after plumbing rough-in and electrical rough-in; Kitchen install runs 2026-07-20 to 2026-07-31, after drywall. Phase "Opening": Health inspection is a milestone on 2026-08-03, after kitchen install and book inspection; Soft opening is a milestone on 2026-08-07, after health inspection.',
		{
			tags: ["phases", "milestones", "today"],
			today: "2026-07-15",
			tasks: [
				{
					key: "permit",
					label: "Building permit",
					start: "2026-06-01",
					end: "2026-06-19",
					phase: "Permits",
				},
				{
					key: "booking",
					label: "Book inspection",
					start: "2026-06-15",
					duration: 3,
					phase: "Permits",
				},
				{
					key: "strip",
					label: "Strip-out",
					aliases: ["Strip out"],
					start: "2026-06-22",
					end: "2026-06-26",
					phase: "Demolition",
					after: ["permit"],
				},
				{
					key: "waste",
					label: "Waste removal",
					start: "2026-06-29",
					duration: 2,
					phase: "Demolition",
					after: ["strip"],
				},
				{
					key: "plumbing",
					label: "Plumbing rough-in",
					start: "2026-06-29",
					end: "2026-07-10",
					phase: "Build-out",
					after: ["strip"],
				},
				{
					key: "electrical",
					label: "Electrical rough-in",
					start: "2026-06-29",
					end: "2026-07-08",
					phase: "Build-out",
					after: ["strip"],
				},
				{
					key: "drywall",
					label: "Drywall",
					start: "2026-07-13",
					duration: 7,
					phase: "Build-out",
					after: ["plumbing", "electrical"],
				},
				{
					key: "kitchen",
					label: "Kitchen install",
					start: "2026-07-20",
					end: "2026-07-31",
					phase: "Build-out",
					after: ["drywall"],
				},
				{
					key: "inspection",
					label: "Health inspection",
					start: "2026-08-03",
					milestone: true,
					phase: "Opening",
					after: ["kitchen", "booking"],
				},
				{
					key: "opening",
					label: "Soft opening",
					start: "2026-08-07",
					milestone: true,
					phase: "Opening",
					after: ["inspection"],
				},
			],
		},
	),
	scenario(
		"data-platform-migration-gantt",
		"Data platform migration",
		'Draw a Gantt chart of our data platform migration, grouped into six phases. Phase "Discovery": Inventory data sources runs 2026-01-05 to 2026-01-16; Stakeholder interviews run 2026-01-05 to 2026-01-23; Target architecture takes 10 days starting 2026-01-26, after inventory data sources and stakeholder interviews; Architecture approved is a milestone on 2026-02-06, after target architecture. Phase "Foundation": Cloud accounts runs 2026-02-09 to 2026-02-13, after architecture approved; Network and VPN runs 2026-02-16 to 2026-02-27, after cloud accounts; Identity and access takes 10 days starting 2026-02-16, after cloud accounts; Data lake storage runs 2026-03-02 to 2026-03-13, after network and VPN and identity and access; Orchestration runs 2026-03-02 to 2026-03-20, after network and VPN; Monitoring takes 7 days starting 2026-03-16, after data lake storage; Foundation ready is a milestone on 2026-03-23, after orchestration and monitoring. Phase "Wave 1": Migrate CRM runs 2026-03-23 to 2026-04-10, after foundation ready; Migrate billing runs 2026-03-30 to 2026-04-17, after foundation ready; Finance reports take 15 days starting 2026-04-13, after migrate CRM; Wave 1 validation runs 2026-04-20 to 2026-04-30, after migrate billing; Wave 1 sign-off is a milestone on 2026-05-01, after finance reports and wave 1 validation. Phase "Wave 2": Migrate catalog runs 2026-05-04 to 2026-05-22, after wave 1 sign-off; Migrate order history runs 2026-05-04 to 2026-06-05, after wave 1 sign-off; Migrate clickstream takes 20 days starting 2026-05-11, after wave 1 sign-off; Marketing dashboards run 2026-06-01 to 2026-06-12, after migrate clickstream; Wave 2 validation runs 2026-06-08 to 2026-06-19, after migrate catalog and migrate order history. Phase "Cutover": Freeze legacy writes is a milestone on 2026-06-22, after wave 2 validation and marketing dashboards; Final delta sync takes 3 days starting 2026-06-22, after freeze legacy writes; Switch traffic runs 2026-06-25 to 2026-06-26, after final delta sync; Go-live is a milestone on 2026-06-29, after switch traffic. Phase "Decommission": Archive legacy data runs 2026-06-29 to 2026-07-17, after go-live; Shut down legacy cluster takes 5 days starting 2026-07-20, after archive legacy data; Project closed is a milestone on 2026-07-31, after shut down legacy cluster.',
		{
			tags: ["phases", "dependencies", "milestones", "long"],
			difficulty: "challenge",
			tasks: [
				{
					key: "inventory",
					label: "Inventory data sources",
					start: "2026-01-05",
					end: "2026-01-16",
					phase: "Discovery",
				},
				{
					key: "interviews",
					label: "Stakeholder interviews",
					start: "2026-01-05",
					end: "2026-01-23",
					phase: "Discovery",
				},
				{
					key: "architecture",
					label: "Target architecture",
					start: "2026-01-26",
					duration: 10,
					phase: "Discovery",
					after: ["inventory", "interviews"],
				},
				{
					key: "approved",
					label: "Architecture approved",
					start: "2026-02-06",
					milestone: true,
					phase: "Discovery",
					after: ["architecture"],
				},
				{
					key: "accounts",
					label: "Cloud accounts",
					start: "2026-02-09",
					end: "2026-02-13",
					phase: "Foundation",
					after: ["approved"],
				},
				{
					key: "network",
					label: "Network and VPN",
					start: "2026-02-16",
					end: "2026-02-27",
					phase: "Foundation",
					after: ["accounts"],
				},
				{
					key: "identity",
					label: "Identity and access",
					start: "2026-02-16",
					duration: 10,
					phase: "Foundation",
					after: ["accounts"],
				},
				{
					key: "lake",
					label: "Data lake storage",
					start: "2026-03-02",
					end: "2026-03-13",
					phase: "Foundation",
					after: ["network", "identity"],
				},
				{
					key: "orchestration",
					label: "Orchestration",
					start: "2026-03-02",
					end: "2026-03-20",
					phase: "Foundation",
					after: ["network"],
				},
				{
					key: "monitoring",
					label: "Monitoring",
					start: "2026-03-16",
					duration: 7,
					phase: "Foundation",
					after: ["lake"],
				},
				{
					key: "foundation",
					label: "Foundation ready",
					start: "2026-03-23",
					milestone: true,
					phase: "Foundation",
					after: ["orchestration", "monitoring"],
				},
				{
					key: "crm",
					label: "Migrate CRM",
					start: "2026-03-23",
					end: "2026-04-10",
					phase: "Wave 1",
					after: ["foundation"],
				},
				{
					key: "billing",
					label: "Migrate billing",
					start: "2026-03-30",
					end: "2026-04-17",
					phase: "Wave 1",
					after: ["foundation"],
				},
				{
					key: "finance",
					label: "Finance reports",
					start: "2026-04-13",
					duration: 15,
					phase: "Wave 1",
					after: ["crm"],
				},
				{
					key: "validation-1",
					label: "Wave 1 validation",
					start: "2026-04-20",
					end: "2026-04-30",
					phase: "Wave 1",
					after: ["billing"],
				},
				{
					key: "signoff-1",
					label: "Wave 1 sign-off",
					start: "2026-05-01",
					milestone: true,
					phase: "Wave 1",
					after: ["finance", "validation-1"],
				},
				{
					key: "catalog",
					label: "Migrate catalog",
					start: "2026-05-04",
					end: "2026-05-22",
					phase: "Wave 2",
					after: ["signoff-1"],
				},
				{
					key: "orders",
					label: "Migrate order history",
					start: "2026-05-04",
					end: "2026-06-05",
					phase: "Wave 2",
					after: ["signoff-1"],
				},
				{
					key: "clickstream",
					label: "Migrate clickstream",
					start: "2026-05-11",
					duration: 20,
					phase: "Wave 2",
					after: ["signoff-1"],
				},
				{
					key: "dashboards",
					label: "Marketing dashboards",
					start: "2026-06-01",
					end: "2026-06-12",
					phase: "Wave 2",
					after: ["clickstream"],
				},
				{
					key: "validation-2",
					label: "Wave 2 validation",
					start: "2026-06-08",
					end: "2026-06-19",
					phase: "Wave 2",
					after: ["catalog", "orders"],
				},
				{
					key: "freeze",
					label: "Freeze legacy writes",
					start: "2026-06-22",
					milestone: true,
					phase: "Cutover",
					after: ["validation-2", "dashboards"],
				},
				{
					key: "sync",
					label: "Final delta sync",
					start: "2026-06-22",
					duration: 3,
					phase: "Cutover",
					after: ["freeze"],
				},
				{
					key: "switch",
					label: "Switch traffic",
					start: "2026-06-25",
					end: "2026-06-26",
					phase: "Cutover",
					after: ["sync"],
				},
				{
					key: "golive",
					label: "Go-live",
					aliases: ["Go live"],
					start: "2026-06-29",
					milestone: true,
					phase: "Cutover",
					after: ["switch"],
				},
				{
					key: "archive",
					label: "Archive legacy data",
					start: "2026-06-29",
					end: "2026-07-17",
					phase: "Decommission",
					after: ["golive"],
				},
				{
					key: "shutdown",
					label: "Shut down legacy cluster",
					start: "2026-07-20",
					duration: 5,
					phase: "Decommission",
					after: ["archive"],
				},
				{
					key: "closed",
					label: "Project closed",
					start: "2026-07-31",
					milestone: true,
					phase: "Decommission",
					after: ["shutdown"],
				},
			],
		},
	),
];

const normalize = (value: string) =>
	value
		.toLowerCase()
		.replace(/[‐-―]/gu, "-")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** The model's task for each prompt task, matched by label. */
function matchTasks(
	scenario: GanttScenario,
	diagram: GanttDiagram,
): ReadonlyMap<string, GanttTask | undefined> {
	const used = new Set<string>();
	return new Map(
		scenario.assertions.tasks.map((expected) => {
			const labels = expected.labels.map(normalize);
			const task = diagram.tasks.find(
				(candidate) => !used.has(candidate.id) && labels.includes(normalize(candidate.label)),
			);
			if (task) used.add(task.id);
			return [expected.key, task] as const;
		}),
	);
}

function lastDay(task: GanttTask): string | undefined {
	const schedule = ganttTaskSchedule(task);
	if (!schedule) return undefined;
	return formatGanttDay(schedule.milestone ? schedule.start : schedule.end - 1);
}

/**
 * The model's own spec states every task, date, duration, milestone, phase,
 * dependency and percent the prompt gives, and invents no dependency.
 */
export function ganttScenarioChecks(
	scenario: GanttScenario,
	diagram: GanttDiagram,
): ScenarioCheck[] {
	const { assertions } = scenario;
	const matched = matchTasks(scenario, diagram);
	const keyOf = new Map(
		[...matched].flatMap(([key, task]) => (task ? [[task.id, key] as const] : [])),
	);
	const describe = (key: string) =>
		assertions.tasks.find((task) => task.key === key)?.labels[0] ?? key;
	const checks: ScenarioCheck[] = [
		{
			id: "gantt-task-count",
			passed: diagram.tasks.length === assertions.tasks.length,
			message: `Expected exactly ${assertions.tasks.length} tasks; found ${diagram.tasks.length}.`,
		},
	];
	for (const expected of assertions.tasks) {
		const task = matched.get(expected.key);
		const name = expected.labels[0]!;
		checks.push({
			id: `gantt-task:${expected.key}`,
			passed: task !== undefined,
			message: `Expected a task labeled "${name}".`,
		});
		const schedule = task && ganttTaskSchedule(task);
		checks.push({
			id: `gantt-dates:${expected.key}`,
			passed:
				task !== undefined &&
				schedule?.milestone === expected.milestone &&
				task.start === expected.start &&
				lastDay(task) === expected.last,
			message: expected.milestone
				? `Expected "${name}" as a milestone on ${expected.start}.`
				: `Expected "${name}" from ${expected.start} through ${expected.last}.`,
		});
		if (expected.phase !== undefined)
			checks.push({
				id: `gantt-phase:${expected.key}`,
				passed: task?.phase !== undefined && normalize(task.phase) === normalize(expected.phase),
				message: `Expected "${name}" in phase "${expected.phase}".`,
			});
		if (expected.progress !== undefined)
			checks.push({
				id: `gantt-progress:${expected.key}`,
				passed: task?.progress === expected.progress,
				message: `Expected "${name}" at ${expected.progress}% done.`,
			});
		for (const before of expected.dependsOn) {
			const predecessor = matched.get(before);
			checks.push({
				id: `gantt-dependency:${before}>${expected.key}`,
				passed:
					task !== undefined &&
					predecessor !== undefined &&
					(task.dependsOn ?? []).includes(predecessor.id),
				message: `Expected "${name}" to depend on "${describe(before)}".`,
			});
		}
	}
	const invented = diagram.tasks.flatMap((task) =>
		(task.dependsOn ?? []).flatMap((before) => {
			const to = keyOf.get(task.id);
			const from = keyOf.get(before);
			const stated = assertions.tasks.find((entry) => entry.key === to)?.dependsOn ?? [];
			return to !== undefined && from !== undefined && stated.includes(from)
				? []
				: [`${before} → ${task.id}`];
		}),
	);
	checks.push({
		id: "gantt-no-invented-dependencies",
		passed: invented.length === 0,
		message:
			invented.length === 0
				? "Every dependency is one the prompt states."
				: `Dependencies the prompt does not state: ${invented.join(", ")}.`,
	});
	if (assertions.phases.length > 0) {
		const phases = ganttPhases(diagram).map(normalize);
		checks.push({
			id: "gantt-phase-order",
			passed:
				phases.length === assertions.phases.length &&
				assertions.phases.every((phase, index) => phases[index] === normalize(phase)),
			message: `Expected phases in order: ${assertions.phases.join(", ")}.`,
		});
	}
	if (assertions.today !== undefined)
		checks.push({
			id: "gantt-today",
			passed: diagram.today === assertions.today,
			message: `Expected today on ${assertions.today}.`,
		});
	return checks;
}

/** Marks may sit this far off their dates, in days. */
const DAY_TOLERANCE = 0.02;

/**
 * The drawn chart is to scale and connected: each bar spans its dates and each
 * milestone sits on its day, read off the axis gridlines, the gridlines cover
 * the plan, and every dependency is an arrow from its predecessor's mark to
 * its successor's.
 */
export function ganttGeometryCheck(
	diagram: GanttDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const readout = readGanttScene(scene);
	const problems: string[] = [];
	const schedules = diagram.tasks.map((task) => ({ task, schedule: ganttTaskSchedule(task)! }));
	for (const { task, schedule } of schedules) {
		const mark = readout.marks.get(task.id);
		if (!mark) {
			problems.push(`${task.id} has no mark`);
			continue;
		}
		if (mark.milestone !== schedule.milestone) problems.push(`${task.id} has the wrong shape`);
		// A bar narrower than the renderer's minimum draws at the minimum.
		const end = schedule.milestone
			? schedule.end
			: Math.max(schedule.end, schedule.start + GANTT_MIN_BAR_WIDTH / readout.pxPerDay);
		if (
			Math.abs(mark.start - schedule.start) > DAY_TOLERANCE ||
			Math.abs(mark.end - end) > DAY_TOLERANCE
		)
			problems.push(
				`${task.id} draws ${formatGanttDay(Math.round(mark.start))} not ${formatGanttDay(schedule.start)}`,
			);
	}
	const first = Math.min(...schedules.map(({ schedule }) => schedule.start));
	const last = Math.max(
		...schedules.map(({ schedule }) => Math.max(schedule.end, schedule.start + 1)),
	);
	const lines = readout.gridlines;
	if (lines.length < 2 || lines[0]!.day > first || lines.at(-1)!.day < last)
		problems.push("the axis does not cover the plan");
	const drawn = new Set(readout.dependencies.map((entry) => `${entry.from}>${entry.to}`));
	for (const task of diagram.tasks)
		for (const before of task.dependsOn ?? [])
			if (!drawn.has(`${before}>${task.id}`)) problems.push(`no arrow ${before} → ${task.id}`);
	return {
		id: "gantt-geometry",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "Every bar and milestone sits on its dates, the axis covers the plan, and every dependency is drawn."
				: `Geometry problems: ${problems.slice(0, 6).join("; ")}.`,
	};
}

/**
 * Fidelity graded on what is drawn: every prompt task's label and date caption,
 * each under its phase's header in the prompt's order, every milestone as a
 * diamond, every stated dependency as an arrow, and the Today line on its day.
 */
export function ganttDrawnDataCheck(
	scenario: GanttScenario,
	diagram: GanttDiagram,
	scene: RenderedDiagramScene,
): ScenarioCheck {
	const readout = readGanttScene(scene);
	const matched = matchTasks(scenario, diagram);
	const captions = ganttCaptions(diagram);
	const missing: string[] = [];
	const arrows = new Set(readout.dependencies.map((entry) => `${entry.from}>${entry.to}`));
	for (const expected of scenario.assertions.tasks) {
		const name = expected.labels[0]!;
		const task = matched.get(expected.key);
		const drawnLabel = task && readout.labels.get(task.id)?.replace(/\n/gu, " ");
		if (
			!task ||
			!drawnLabel ||
			!expected.labels.some((label) => normalize(label) === normalize(drawnLabel))
		) {
			missing.push(`label "${name}"`);
			continue;
		}
		const caption = readout.captions.get(task.id);
		if (caption === undefined || caption !== captions.tasks.get(task.id))
			missing.push(`dates of "${name}"`);
		const mark = readout.marks.get(task.id);
		if (!mark || mark.milestone !== expected.milestone)
			missing.push(`${expected.milestone ? "diamond" : "bar"} for "${name}"`);
		if (expected.phase !== undefined) {
			const header = readout.phases.find((phase) => phase.tasks.includes(task.id));
			if (!header || normalize(header.name) !== normalize(expected.phase))
				missing.push(`"${name}" under "${expected.phase}"`);
		}
		for (const before of expected.dependsOn) {
			const predecessor = matched.get(before);
			if (!predecessor || !arrows.has(`${predecessor.id}>${task.id}`))
				missing.push(`arrow into "${name}"`);
		}
	}
	const headers = readout.phases.map((phase) => normalize(phase.name));
	if (
		scenario.assertions.phases.length > 0 &&
		!scenario.assertions.phases.every((phase, index) => headers[index] === normalize(phase))
	)
		missing.push("phase headers in order");
	if (scenario.assertions.today !== undefined) {
		const day = parseGanttDay(scenario.assertions.today);
		if (readout.today !== day) missing.push("Today line");
		if (
			!readout.texts.some((text) => text.id === "gantt:today-label" && text.text === captions.today)
		)
			missing.push("Today label");
	}
	return {
		id: "gantt-drawn-data",
		passed: missing.length === 0,
		message:
			missing.length === 0
				? "Every task, date, milestone, phase and dependency the prompt states is drawn."
				: `Not drawn: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}.`,
	};
}

interface Box {
	readonly id: string;
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** Strictly inside a mark: its rectangle, or for a milestone its diamond. */
function inside(box: Box & { readonly diamond?: boolean }, x: number, y: number, slack = 0.5) {
	if (box.diamond) {
		const halfWidth = (box.right - box.left) / 2;
		const halfHeight = (box.bottom - box.top) / 2;
		const dx = Math.abs(x - (box.left + halfWidth)) / halfWidth;
		const dy = Math.abs(y - (box.top + halfHeight)) / halfHeight;
		return dx + dy < 1 - slack / halfWidth;
	}
	return (
		x > box.left + slack && x < box.right - slack && y > box.top + slack && y < box.bottom - slack
	);
}

function segmentEnters(box: Box, from: { x: number; y: number }, to: { x: number; y: number }) {
	const horizontal = Math.abs(from.y - to.y) < 0.01;
	return horizontal
		? from.y > box.top + 0.5 &&
				from.y < box.bottom - 0.5 &&
				Math.max(from.x, to.x) > box.left + 0.5 &&
				Math.min(from.x, to.x) < box.right - 0.5
		: from.x > box.left + 0.5 &&
				from.x < box.right - 0.5 &&
				Math.max(from.y, to.y) > box.top + 0.5 &&
				Math.min(from.y, to.y) < box.bottom - 0.5;
}

/**
 * Nothing collides: no text overlaps other text or a mark,
 * no dependency runs through a mark or text, and no gridline, axis or Today
 * line crosses text.
 */
export function ganttClearanceCheck(scene: RenderedDiagramScene): ScenarioCheck {
	const texts: Box[] = scene.elements.flatMap((element) => {
		if (element.type !== "text") return [];
		const width = element.maxWidth ?? estimateTextWidth(element.text, element.fontSize);
		const height = element.text.split("\n").length * element.fontSize * 1.35;
		return [
			{
				id: element.id,
				left: element.x - width / 2,
				right: element.x + width / 2,
				top: element.y - height / 2,
				bottom: element.y + height / 2,
			},
		];
	});
	const marks: (Box & { readonly diamond: boolean })[] = scene.elements.flatMap((element) =>
		element.type === "node"
			? [
					{
						id: element.nodeId,
						diamond: element.shape === "diamond",
						left: element.x,
						right: element.x + element.width,
						top: element.y,
						bottom: element.y + element.height,
					},
				]
			: [],
	);
	const problems: string[] = [];
	texts.forEach((text, index) => {
		for (const other of texts.slice(index + 1))
			if (
				text.left < other.right - 0.5 &&
				other.left < text.right - 0.5 &&
				text.top < other.bottom - 0.5 &&
				other.top < text.bottom - 0.5
			)
				problems.push(`${text.id} overlaps ${other.id}`);
		for (const mark of marks)
			if (
				text.left < mark.right - 0.5 &&
				mark.left < text.right - 0.5 &&
				text.top < mark.bottom - 0.5 &&
				mark.top < text.bottom - 0.5
			)
				problems.push(`${text.id} overlaps ${mark.id}`);
	});
	for (const element of scene.elements) {
		if (element.type === "arrow") {
			const ends = new Set([element.sourceNodeId, element.targetNodeId]);
			element.points.slice(1).forEach((to, index) => {
				const from = element.points[index]!;
				for (const box of [...marks.filter((mark) => !ends.has(mark.id)), ...texts])
					if (segmentEnters(box, from, to)) problems.push(`${element.id} crosses ${box.id}`);
			});
			for (const point of element.points)
				for (const mark of marks.filter((entry) => ends.has(entry.id)))
					if (inside(mark, point.x, point.y)) problems.push(`${element.id} enters ${mark.id}`);
		}
		if (element.type === "line" && /^gantt:(grid|minor|axis|band-edge|today)/u.test(element.id)) {
			const [from, to] = element.points;
			for (const box of texts)
				if (segmentEnters(box, from, to)) problems.push(`${element.id} crosses ${box.id}`);
		}
	}
	problems.push(...ganttRouteProblems(scene, marks));
	return {
		id: "gantt-clearance",
		passed: problems.length === 0,
		message:
			problems.length === 0
				? "No text overlaps; every dependency keeps off other marks, text, arrowheads and routes, and runs forward where it can; no rule crosses text."
				: `Collisions: ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? "; …" : ""}.`,
	};
}

/** Bars narrower than this, with this many dependencies arriving or leaving, have no room for each apart. */
const SLIVER_WIDTH = 12;
const SLIVER_ROUTES = 4;
/** Another route keeps this far from an arrowhead's last 12 pixels. */
const HEAD_GAP = 4;
const HEAD_LENGTH = 12;

type Run = { readonly from: ScenePoint; readonly to: ScenePoint };

/** How far two parallel runs overlap along their length, when they lie closer than `gap`. */
function sideBySide(a: Run, b: Run, gap: number): number {
	const horizontal = Math.abs(a.from.y - a.to.y) < 0.01;
	if (horizontal !== Math.abs(b.from.y - b.to.y) < 0.01) return 0;
	const offset = horizontal ? Math.abs(a.from.y - b.from.y) : Math.abs(a.from.x - b.from.x);
	if (offset >= gap) return 0;
	const span = (run: Run) =>
		horizontal
			? [Math.min(run.from.x, run.to.x), Math.max(run.from.x, run.to.x)]
			: [Math.min(run.from.y, run.to.y), Math.max(run.from.y, run.to.y)];
	const [aLow, aHigh] = span(a);
	const [bLow, bHigh] = span(b);
	return Math.min(aHigh!, bHigh!) - Math.max(aLow!, bLow!);
}

/** Where a route's last straight stretch begins: the index of its first run in line with its last. */
function stemStart(runs: readonly Run[]): number {
	const level = (run: Run) => Math.abs(run.from.y - run.to.y) < 0.01;
	let index = runs.length - 1;
	while (
		index > 0 &&
		level(runs[index - 1]!) === level(runs[index]!) &&
		(level(runs[index]!)
			? Math.abs(runs[index - 1]!.from.y - runs[index]!.from.y) < 0.01
			: Math.abs(runs[index - 1]!.from.x - runs[index]!.from.x) < 0.01)
	)
		index -= 1;
	return index;
}

/**
 * Dependencies that read ambiguously: a route through another's arrowhead, two routes on one
 * line (routes out of one predecessor may share their first run, and routes into one successor
 * their last, all of it and their arrowhead when one joined the other's), or a loop back behind
 * a predecessor its successor alone waits on, in the next row and starting after it ends, which
 * always has a forward route unless the predecessor is a sliver crowded by its other
 * dependencies.
 */
function ganttRouteProblems(scene: RenderedDiagramScene, marks: readonly Box[]): string[] {
	const arrows = scene.elements.flatMap((element) => (element.type === "arrow" ? [element] : []));
	const runs = (points: readonly ScenePoint[]): Run[] =>
		points.slice(1).map((to, index) => ({ from: points[index]!, to }));
	const problems: string[] = [];
	const rows = marks
		.filter((mark) => mark.id.startsWith("gantt:task:"))
		.toSorted((a, b) => a.top - b.top)
		.map((mark) => mark.id);
	for (const arrow of arrows) {
		const end = arrow.points.at(-1)!;
		const before = arrow.points.at(-2)!;
		const length = Math.abs(end.x - before.x) + Math.abs(end.y - before.y);
		const ratio = Math.min(1, HEAD_LENGTH / length);
		const start = { x: end.x + (before.x - end.x) * ratio, y: end.y + (before.y - end.y) * ratio };
		const head: Box = {
			id: arrow.id,
			left: Math.min(start.x, end.x) - HEAD_GAP,
			right: Math.max(start.x, end.x) + HEAD_GAP,
			top: Math.min(start.y, end.y) - HEAD_GAP,
			bottom: Math.max(start.y, end.y) + HEAD_GAP,
		};
		const own = runs(arrow.points);
		for (const other of arrows) {
			if (other === arrow) continue;
			const theirs = runs(other.points);
			const otherEnd = other.points.at(-1)!;
			// One route joined the other's last run: both end in one arrowhead.
			const joint =
				arrow.targetNodeId === other.targetNodeId &&
				Math.hypot(end.x - otherEnd.x, end.y - otherEnd.y) < 0.01;
			if (
				theirs.some(
					(run, at) => !(joint && at >= stemStart(theirs)) && segmentEnters(head, run.from, run.to),
				)
			)
				problems.push(`${other.id} runs through the head of ${arrow.id}`);
			if (other.id < arrow.id) continue;
			const together = own.some((run, index) =>
				theirs.some((them, at) => {
					const leaving = arrow.sourceNodeId === other.sourceNodeId && index === 0 && at === 0;
					const arriving =
						arrow.targetNodeId === other.targetNodeId &&
						((index === own.length - 1 && at === theirs.length - 1) ||
							(joint && index >= stemStart(own) && at >= stemStart(theirs)));
					return !leaving && !arriving && sideBySide(run, them, 2) > 1;
				}),
			);
			if (together) problems.push(`${arrow.id} runs along ${other.id}`);
		}
		const from = marks.find((mark) => mark.id === arrow.sourceNodeId);
		const to = marks.find((mark) => mark.id === arrow.targetNodeId);
		const alone = arrows.filter((entry) => entry.targetNodeId === arrow.targetNodeId).length === 1;
		// A sliver with four or more dependencies arriving or leaving has no room left for a
		// forward exit.
		const sliver =
			from !== undefined &&
			from.right - from.left < SLIVER_WIDTH &&
			arrows.filter((entry) => entry.targetNodeId === from.id || entry.sourceNodeId === from.id)
				.length >= SLIVER_ROUTES;
		if (
			from &&
			to &&
			alone &&
			!sliver &&
			rows.indexOf(to.id) === rows.indexOf(from.id) + 1 &&
			to.left >= from.right &&
			arrow.points.some((point) => point.x < Math.min(from.left, to.left - 40) - 0.5)
		)
			problems.push(`${arrow.id} loops back behind ${from.id}`);
	}
	return problems;
}
