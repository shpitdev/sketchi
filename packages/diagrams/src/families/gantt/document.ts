// Maintained fixture literals/factories are trusted: invalid fixture data is a startup defect, not user input.
import { DateTime, Effect, Graph, Schema, Array as Arr, Option, Result } from "effect";
import { cleanToolString, slug } from "../../clean-text.js";
import { DiagramStyle, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import { parseTimelineDate } from "../timeline/document.js";

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
export const GanttTask = Schema.Struct({
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
}).annotate({ identifier: "GanttTask" });

export interface GanttTask extends Schema.Schema.Type<typeof GanttTask> {}

export const GanttDocument = Schema.Struct({
	id: Schema.optionalKey(Schema.NonEmptyString),
	title: Schema.NonEmptyString,
	tasks: Schema.Array(GanttTask).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
	/** Phase order, top to bottom; defaults to first use in task order. */
	phases: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).pipe(Schema.mutable)),
	/** Draws a Today line at this date. There is no ambient clock. */
	today: Schema.optionalKey(Schema.NonEmptyString),
	style: DiagramStyle.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ ...SKETCHI_DIAGRAM_STYLE })),
	),
});
export interface GanttDocument extends Schema.Schema.Type<typeof GanttDocument> {}

/** Authored fields have one owner; rendering adds only the stable id and family tag. */
export const GanttDiagram = GanttDocument.mapFields((fields) => ({
	...fields,
	id: Schema.NonEmptyString,
	type: Schema.Literal(ganttDiagramType),
})).annotate({ identifier: "GanttDiagram" });

export interface GanttDiagram extends Schema.Schema.Type<typeof GanttDiagram> {}

/** Normalize authoring once, preserving task, phase and dependency order. */
export function normalizeGantt(document: GanttDocument): GanttDiagram {
	const title = cleanToolString(document.title);
	return {
		id: (document.id && cleanToolString(document.id)) || slug(title) || "sketchi-gantt",
		title,
		type: ganttDiagramType,
		tasks: Arr.map(document.tasks, (task) => {
			const phase = task.phase && cleanToolString(task.phase);
			return {
				...task,
				id: cleanToolString(task.id),
				label: cleanToolString(task.label),
				start: cleanToolString(task.start),
				...(task.end !== undefined ? { end: cleanToolString(task.end) } : {}),
				...(phase ? { phase } : {}),
				...(task.dependsOn ? { dependsOn: Arr.map(task.dependsOn, cleanToolString) } : {}),
			};
		}),
		...(document.phases ? { phases: Arr.map(document.phases, cleanToolString) } : {}),
		...(document.today ? { today: cleanToolString(document.today) } : {}),
		style: { ...SKETCHI_DIAGRAM_STYLE },
	};
}

/** A calendar day as whole days since 1970-01-01 (UTC), or undefined unless `YYYY-MM-DD`. */
export function parseGanttDay(value: string): number | undefined {
	const date = parseTimelineDate(value);
	return date?.granularity === "day" ? Math.round(date.start / DAY) : undefined;
}

/** The `YYYY-MM-DD` of a day number. */
export function formatGanttDay(day: number): string {
	return DateTime.formatIsoDateUtc(DateTime.makeUnsafe(day * DAY));
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
	if (diagram.phases) return Arr.copy(diagram.phases);
	const phases: string[] = [];
	for (const task of diagram.tasks)
		if (task.phase !== undefined && !Arr.contains(phases, task.phase)) phases.push(task.phase);
	return phases;
}

/** Rows top to bottom: each phase's tasks in input order, or every task in input order. */
export function ganttRows(diagram: GanttDiagram): {
	readonly phase?: string;
	readonly tasks: readonly GanttTask[];
}[] {
	const phases = ganttPhases(diagram);
	if (phases.length === 0) return [{ tasks: diagram.tasks }];
	return Arr.map(phases, (phase) => ({
		phase,
		tasks: Arr.filter(diagram.tasks, (task) => task.phase === phase),
	}));
}

export const GanttValidationIssueCodeSchema = Schema.Literals([
	"gantt_too_large",
	"duplicate_task_id",
	"invalid_gantt_date",
	"invalid_gantt_span",
	"invalid_gantt_phase",
	"invalid_gantt_progress",
	"missing_dependency",
	"self_dependency",
	"gantt_dependency_cycle",
]);
export type GanttValidationIssueCode = typeof GanttValidationIssueCodeSchema.Type;

export const GanttValidationIssue = Schema.Struct({
	code: GanttValidationIssueCodeSchema,
	path: Schema.String,
	message: Schema.String,
	hint: Schema.String,
});
export interface GanttValidationIssue extends Schema.Schema.Type<typeof GanttValidationIssue> {}

const DATE_HINT = "Use YYYY-MM-DD, copied from the source.";

/** Task ids on one dependency cycle, in order, or undefined when the graph is acyclic. */
function dependencyCycle(tasks: readonly GanttTask[]): string[] | undefined {
	const byId = new Map(Arr.map(tasks, (task) => [task.id, task] as const));
	const graph = Graph.directed<string, undefined>((mutable) => {
		const indices = new Map(
			Arr.map(Arr.fromIterable(byId.keys()), (id) => [id, Graph.addNode(mutable, id)] as const),
		);
		for (const task of byId.values()) {
			const from = indices.get(task.id);
			if (from === undefined) continue;
			for (const target of task.dependsOn ?? []) {
				const to = indices.get(target);
				// Self and unknown dependencies have their own actionable issues.
				if (to !== undefined && target !== task.id) Graph.addEdge(mutable, from, to, undefined);
			}
		}
	});
	return Option.getOrUndefined(
		Option.map(Graph.findCycle(graph), (cycle) =>
			Arr.reverse(Arr.map(cycle.path, (index) => Option.getOrThrow(Graph.getNode(graph, index)))),
		),
	);
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
	const phased =
		diagram.phases !== undefined || Arr.some(tasks, (task) => task.phase !== undefined);
	let dependencies = 0;
	Arr.forEach(tasks, (task, index) => {
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
			(task.phase === undefined || (diagram.phases && !Arr.contains(diagram.phases, task.phase)))
		)
			issues.push({
				code: "invalid_gantt_phase",
				path: `${path}.phase`,
				message: `Task "${task.id}" needs one of the chart's phases.`,
				hint: "Give every task a phase listed in phases, or omit phases everywhere.",
			});
		const seen = new Set<string>();
		Arr.forEach(task.dependsOn ?? [], (target, targetIndex) => {
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
			path: `tasks.[${Option.getOrElse(
				Arr.findFirstIndex(tasks, (task) => task.id === cycle[0]),
				() => -1,
			)}].dependsOn`,
			message: `Dependencies form a cycle: ${Arr.join(cycle, " → ")}.`,
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
		Arr.forEach(diagram.phases, (phase, index) => {
			if (!Arr.some(tasks, (task) => task.phase === phase))
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
		...Arr.flatMap(tasks, (task) => {
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
	return Arr.take(issues, 20);
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
	const byId = new Map(Arr.map(diagram.tasks, (task) => [task.id, task] as const));
	return Arr.flatMap(diagram.tasks, (task, index) => {
		const schedule = ganttTaskSchedule(task);
		return Arr.flatMap(task.dependsOn ?? [], (target, targetIndex) => {
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

export class GanttValidationError extends Schema.TaggedError<
	GanttValidationError,
	{ readonly brand: unique symbol }
>()("GanttValidationError", {
	message: Schema.String,
	issues: Schema.Array(GanttValidationIssue),
}) {
	static fromIssues(issues: readonly GanttValidationIssue[]): GanttValidationError {
		return GanttValidationError.make({
			issues,
			message: Option.match(Arr.head(issues), {
				onNone: () => "Gantt chart failed validation.",
				onSome: (issue) => issue.message,
			}),
		});
	}
}
export function validateGanttDiagram(
	diagram: GanttDiagram,
): Result.Result<GanttDiagram, GanttValidationError> {
	const issues = getGanttValidationIssues(diagram);
	return issues.length > 0
		? Result.fail(GanttValidationError.fromIssues(issues))
		: Result.succeed(diagram);
}
export function parseGanttDiagram(
	input: unknown,
): Result.Result<GanttDiagram, Schema.SchemaError | GanttValidationError> {
	return Result.flatMap(
		Schema.decodeUnknownResult(GanttDiagram, { errors: "all" })(input),
		validateGanttDiagram,
	);
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
}).pipe(Result.getOrThrow);

/** Counts and domain nouns shown by generation consumers. */
export function counts(diagram: GanttDiagram) {
	return {
		nodeCount: diagram.tasks.length,
		nodeNoun: "tasks",
		edgeCount: Arr.reduce(diagram.tasks, 0, (count, task) => count + (task.dependsOn?.length ?? 0)),
		edgeNoun: "dependencies",
	};
}
