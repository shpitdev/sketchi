import { Effect, Schema } from "effect";
import { DiagramStyle, DiagramValidationError, SKETCHI_DIAGRAM_STYLE } from "../intermediate.js";
import { parseTimelineDate } from "./timeline.js";

export const ganttDiagramType = "gantt" as const;
/** More tasks or phases stop reading as one plan; split the plan instead. */
export const GANTT_MAX_TASKS = 60;
export const GANTT_MAX_PHASES = 12;
export const GANTT_MAX_DEPENDENCIES = 120;
/** A chart spans at most a century, from its first day through its last and Today. */
export const GANTT_MAX_SPAN_DAYS = 36_525;

const DAY = 86_400_000;

/**
 * One scheduled row: a bar from `start` through `end` (or for `duration`
 * calendar days), or a milestone diamond on `start`. Never coordinates.
 */
export class GanttTask extends Schema.Class<GanttTask>("GanttTask")({
	id: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	/** First day, YYYY-MM-DD. */
	start: Schema.NonEmptyString,
	/** Last day, inclusive, YYYY-MM-DD. Give `end` or `duration`, not both. */
	end: Schema.optionalKey(Schema.NonEmptyString),
	/** Calendar days, counting `start`. 0 makes a milestone. */
	duration: Schema.optionalKey(Schema.Finite),
	/** A single day marked by a diamond; it takes no `end` or `duration`. */
	milestone: Schema.optionalKey(Schema.Boolean),
	/** Header the row sits under; every task names one when any does. */
	phase: Schema.optionalKey(Schema.NonEmptyString),
	/** Finish-to-start predecessors: task ids that finish before this one starts. */
	dependsOn: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	/** Percent complete, 0–100. */
	progress: Schema.optionalKey(Schema.Finite),
}) {}

export class GanttDiagram extends Schema.Class<GanttDiagram>("GanttDiagram")({
	id: Schema.NonEmptyString,
	title: Schema.NonEmptyString,
	type: Schema.Literal(ganttDiagramType),
	tasks: Schema.Array(GanttTask).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Phase order, top to bottom; defaults to first use in task order. */
	phases: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	/** Draws a Today line at this date. There is no ambient clock. */
	today: Schema.optionalKey(Schema.NonEmptyString),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefault(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
}) {}
export const GanttDiagramSchema = GanttDiagram;

/** A calendar day as whole days since 1970-01-01 (UTC), or undefined unless `YYYY-MM-DD`. */
export function parseGanttDay(value: string): number | undefined {
	const date = parseTimelineDate(value);
	return date?.granularity === "day" ? Math.round(date.start / DAY) : undefined;
}

/** The `YYYY-MM-DD` of a day number. */
export function formatGanttDay(day: number): string {
	return new Date(day * DAY).toISOString().slice(0, 10);
}

export function isGanttMilestone(task: GanttTask): boolean {
	return task.milestone === true || task.duration === 0;
}

/** Where a task sits in days: `[start, end)`, so a milestone has `end === start`. */
export interface GanttSchedule {
	readonly start: number;
	readonly end: number;
	readonly milestone: boolean;
}

/** A valid task's days; undefined when its dates do not parse. */
export function ganttTaskSchedule(task: GanttTask): GanttSchedule | undefined {
	const start = parseGanttDay(task.start);
	if (start === undefined) return undefined;
	if (isGanttMilestone(task)) return { start, end: start, milestone: true };
	if (task.end !== undefined) {
		const end = parseGanttDay(task.end);
		return end === undefined ? undefined : { start, end: end + 1, milestone: false };
	}
	return task.duration === undefined
		? undefined
		: { start, end: start + task.duration, milestone: false };
}

/** The phase order a Gantt renders: explicit `phases`, else first use in task order. */
export function ganttPhases(diagram: GanttDiagram): string[] {
	if (diagram.phases) return [...diagram.phases];
	const phases: string[] = [];
	for (const task of diagram.tasks)
		if (task.phase !== undefined && !phases.includes(task.phase)) phases.push(task.phase);
	return phases;
}

/** Rows top to bottom: each phase's tasks in input order, or every task in input order. */
export function ganttRows(diagram: GanttDiagram): {
	readonly phase?: string;
	readonly tasks: readonly GanttTask[];
}[] {
	const phases = ganttPhases(diagram);
	if (phases.length === 0) return [{ tasks: diagram.tasks }];
	return phases.map((phase) => ({
		phase,
		tasks: diagram.tasks.filter((task) => task.phase === phase),
	}));
}

export type GanttValidationIssueCode =
	| "gantt_too_large"
	| "duplicate_task_id"
	| "invalid_gantt_date"
	| "invalid_gantt_span"
	| "invalid_gantt_phase"
	| "invalid_gantt_progress"
	| "missing_dependency"
	| "self_dependency"
	| "gantt_dependency_cycle";

export interface GanttValidationIssue {
	readonly code: GanttValidationIssueCode;
	readonly path: string;
	readonly message: string;
	readonly hint: string;
}

const DATE_HINT = "Use YYYY-MM-DD, copied from the source.";

/** Task ids on one dependency cycle, in order, or undefined when the graph is acyclic. */
function dependencyCycle(tasks: readonly GanttTask[]): string[] | undefined {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const state = new Map<string, "open" | "done">();
	const stack: string[] = [];
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === "done") return undefined;
		if (state.get(id) === "open") return [...stack.slice(stack.indexOf(id)), id];
		state.set(id, "open");
		stack.push(id);
		for (const next of byId.get(id)?.dependsOn ?? []) {
			if (next === id || !byId.has(next)) continue;
			const cycle = visit(next);
			if (cycle) return cycle;
		}
		stack.pop();
		state.set(id, "done");
		return undefined;
	};
	for (const task of tasks) {
		const cycle = visit(task.id);
		if (cycle) return cycle.toReversed();
	}
	return undefined;
}

export function getGanttValidationIssues(diagram: GanttDiagram): GanttValidationIssue[] {
	const issues: GanttValidationIssue[] = [];
	const { tasks } = diagram;
	if (tasks.length === 0 || tasks.length > GANTT_MAX_TASKS)
		issues.push({
			code: "gantt_too_large",
			path: "tasks",
			message: `A Gantt chart needs 1–${GANTT_MAX_TASKS} tasks.`,
			hint: "Provide at least one task, or split a longer plan into several charts.",
		});
	const ids = new Set<string>();
	for (const [index, task] of tasks.entries()) {
		if (ids.has(task.id))
			issues.push({
				code: "duplicate_task_id",
				path: `tasks.[${index}].id`,
				message: `Task id "${task.id}" is duplicated.`,
				hint: "Give each task a unique stable id.",
			});
		ids.add(task.id);
	}
	const phased = diagram.phases !== undefined || tasks.some((task) => task.phase !== undefined);
	let dependencies = 0;
	tasks.forEach((task, index) => {
		const path = `tasks.[${index}]`;
		const start = parseGanttDay(task.start);
		if (start === undefined)
			issues.push({
				code: "invalid_gantt_date",
				path: `${path}.start`,
				message: `Task "${task.id}" has invalid start "${task.start}".`,
				hint: DATE_HINT,
			});
		const end = task.end === undefined ? undefined : parseGanttDay(task.end);
		if (task.end !== undefined && end === undefined)
			issues.push({
				code: "invalid_gantt_date",
				path: `${path}.end`,
				message: `Task "${task.id}" has invalid end "${task.end}".`,
				hint: `${DATE_HINT} end is the last day, inclusive.`,
			});
		const span = (message: string, hint: string, field = "") =>
			issues.push({ code: "invalid_gantt_span", path: `${path}${field}`, message, hint });
		if (isGanttMilestone(task)) {
			if (task.milestone === true && task.duration !== undefined && task.duration !== 0)
				span(
					`Milestone "${task.id}" cannot have a duration.`,
					"A milestone is one day: give it start only.",
					".duration",
				);
			if (task.end !== undefined && end !== undefined && start !== undefined && end !== start)
				span(
					`Milestone "${task.id}" cannot end on another day.`,
					"A milestone is one day: give it start only, or drop milestone to draw a bar.",
					".end",
				);
		} else if ((task.end === undefined) === (task.duration === undefined)) {
			span(
				`Task "${task.id}" needs exactly one of end or duration.`,
				"Give end (last day, inclusive) or duration (calendar days), or set milestone: true.",
			);
		} else if (
			task.duration !== undefined &&
			(!Number.isInteger(task.duration) || task.duration < 0)
		) {
			span(
				`Task "${task.id}" has duration ${task.duration}; durations are whole calendar days.`,
				"Use a whole number of days counting start, such as 5 for start through start + 4.",
				".duration",
			);
		} else if (end !== undefined && start !== undefined && end < start) {
			span(
				`Task "${task.id}" ends before it starts.`,
				"end is the last day, inclusive, on or after start.",
				".end",
			);
		} else if (task.duration !== undefined && task.duration > GANTT_MAX_SPAN_DAYS) {
			span(
				`Task "${task.id}" has duration ${task.duration}; a chart spans at most ${GANTT_MAX_SPAN_DAYS} days.`,
				"Give the task's real length in calendar days, or split a longer plan into several charts.",
				".duration",
			);
		}
		if (
			task.progress !== undefined &&
			(task.progress < 0 || task.progress > 100 || isGanttMilestone(task))
		)
			issues.push({
				code: "invalid_gantt_progress",
				path: `${path}.progress`,
				message: `Task "${task.id}" has progress ${task.progress}.`,
				hint: "progress is a percent from 0 to 100, on tasks only, never milestones.",
			});
		if (
			phased &&
			(task.phase === undefined || (diagram.phases && !diagram.phases.includes(task.phase)))
		)
			issues.push({
				code: "invalid_gantt_phase",
				path: `${path}.phase`,
				message: `Task "${task.id}" needs one of the chart's phases.`,
				hint: "Give every task a phase listed in phases, or omit phases everywhere.",
			});
		const seen = new Set<string>();
		(task.dependsOn ?? []).forEach((target, targetIndex) => {
			dependencies += 1;
			const targetPath = `${path}.dependsOn.[${targetIndex}]`;
			if (target === task.id)
				issues.push({
					code: "self_dependency",
					path: targetPath,
					message: `Task "${task.id}" depends on itself.`,
					hint: "List only the tasks that must finish before this one starts.",
				});
			else if (!ids.has(target))
				issues.push({
					code: "missing_dependency",
					path: targetPath,
					message: `Task "${task.id}" depends on unknown task "${target}".`,
					hint: "Use the id of a task declared in tasks.",
				});
			else if (seen.has(target))
				issues.push({
					code: "missing_dependency",
					path: targetPath,
					message: `Task "${task.id}" lists "${target}" more than once.`,
					hint: "List each predecessor once.",
				});
			seen.add(target);
		});
	});
	if (dependencies > GANTT_MAX_DEPENDENCIES)
		issues.push({
			code: "gantt_too_large",
			path: "tasks",
			message: `A Gantt chart supports at most ${GANTT_MAX_DEPENDENCIES} dependencies.`,
			hint: "Keep the dependencies the plan states, or split it into several charts.",
		});
	const cycle = dependencyCycle(tasks);
	if (cycle)
		issues.push({
			code: "gantt_dependency_cycle",
			path: `tasks.[${tasks.findIndex((task) => task.id === cycle[0])}].dependsOn`,
			message: `Dependencies form a cycle: ${cycle.join(" → ")}.`,
			hint: "A task cannot wait, directly or indirectly, for itself. Remove one dependency on the cycle.",
		});
	if (diagram.phases) {
		if (new Set(diagram.phases).size !== diagram.phases.length)
			issues.push({
				code: "invalid_gantt_phase",
				path: "phases",
				message: "Phase names must be unique.",
				hint: "List each phase once, in top-to-bottom order.",
			});
		diagram.phases.forEach((phase, index) => {
			if (!tasks.some((task) => task.phase === phase))
				issues.push({
					code: "invalid_gantt_phase",
					path: `phases.[${index}]`,
					message: `Phase "${phase}" has no tasks.`,
					hint: "List only phases that tasks name.",
				});
		});
	}
	if (ganttPhases(diagram).length > GANTT_MAX_PHASES)
		issues.push({
			code: "gantt_too_large",
			path: "phases",
			message: `A Gantt chart supports at most ${GANTT_MAX_PHASES} phases.`,
			hint: "Merge related phases or split the plan into several charts.",
		});
	const today = diagram.today === undefined ? undefined : parseGanttDay(diagram.today);
	if (diagram.today !== undefined && today === undefined)
		issues.push({
			code: "invalid_gantt_date",
			path: "today",
			message: `Today "${diagram.today}" must be a YYYY-MM-DD date.`,
			hint: `${DATE_HINT} Omit today unless the source states it.`,
		});
	const days = [
		...tasks.flatMap((task) => {
			const schedule = ganttTaskSchedule(task);
			return schedule && Number.isFinite(schedule.end) ? [schedule.start, schedule.end] : [];
		}),
		...(today === undefined ? [] : [today, today + 1]),
	];
	if (days.length && Math.max(...days) - Math.min(...days) > GANTT_MAX_SPAN_DAYS)
		issues.push({
			code: "gantt_too_large",
			path: "tasks",
			message: `A Gantt chart spans at most ${GANTT_MAX_SPAN_DAYS} days, first task through last and Today.`,
			hint: "Check the dates for a typo, or split a longer plan into several charts.",
		});
	return issues.slice(0, 20);
}

/** A finish-to-start dependency whose successor starts before its predecessor finishes. */
export interface GanttScheduleConflict {
	readonly task: string;
	readonly dependsOn: string;
	/** The predecessor's last day, YYYY-MM-DD. */
	readonly finishes: string;
	readonly path: string;
}

/**
 * Dependencies whose successor starts before its predecessor finishes. They
 * draw as stated and are reported, so computed dates can be checked. A
 * milestone may fall on its predecessor's last day.
 */
export function ganttScheduleConflicts(diagram: GanttDiagram): GanttScheduleConflict[] {
	const byId = new Map(diagram.tasks.map((task) => [task.id, task]));
	return diagram.tasks.flatMap((task, index) => {
		const schedule = ganttTaskSchedule(task);
		return (task.dependsOn ?? []).flatMap((target, targetIndex) => {
			const predecessor = byId.get(target);
			const before = predecessor && ganttTaskSchedule(predecessor);
			if (!schedule || !before) return [];
			const finish = before.milestone ? before.start : before.end - (schedule.milestone ? 1 : 0);
			if (schedule.start >= finish) return [];
			return [
				{
					task: task.id,
					dependsOn: target,
					finishes: formatGanttDay(before.milestone ? before.start : before.end - 1),
					path: `tasks.[${index}].dependsOn.[${targetIndex}]`,
				},
			];
		});
	});
}

export class GanttValidationError extends DiagramValidationError {
	constructor(readonly issues: readonly GanttValidationIssue[]) {
		super(issues[0]?.message ?? "Gantt chart failed validation.");
		this.name = "GanttValidationError";
	}
}
export function validateGanttDiagram(diagram: GanttDiagram): GanttDiagram {
	const issues = getGanttValidationIssues(diagram);
	if (issues.length) throw new GanttValidationError(issues);
	return diagram;
}
export function parseGanttDiagram(input: unknown): GanttDiagram {
	return validateGanttDiagram(Schema.decodeUnknownSync(GanttDiagram, { errors: "all" })(input));
}

export const ganttFixture = parseGanttDiagram({
	id: "release-plan",
	title: "Release plan",
	type: "gantt",
	tasks: [
		{ id: "design", label: "Design", start: "2026-03-02", end: "2026-03-06", phase: "Build" },
		{
			id: "api",
			label: "API",
			start: "2026-03-09",
			duration: 10,
			phase: "Build",
			dependsOn: ["design"],
			progress: 40,
		},
		{
			id: "web",
			label: "Web app",
			start: "2026-03-09",
			end: "2026-03-20",
			phase: "Build",
			dependsOn: ["design"],
		},
		{
			id: "qa",
			label: "QA",
			start: "2026-03-23",
			duration: 5,
			phase: "Launch",
			dependsOn: ["api", "web"],
		},
		{
			id: "release",
			label: "Release",
			start: "2026-03-30",
			milestone: true,
			phase: "Launch",
			dependsOn: ["qa"],
		},
	],
});
