import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram.js";
import {
	formatGanttDay,
	GANTT_MAX_TASKS,
	ganttFixture,
	ganttRows,
	ganttScheduleConflicts,
	ganttTaskSchedule,
	GanttValidationError,
	parseGanttDay,
	parseGanttDiagram,
	type GanttValidationIssue,
} from "./gantt.js";

const plan = {
	id: "plan",
	title: "Plan",
	type: "gantt",
	tasks: [
		{ id: "a", label: "Design", start: "2026-03-02", end: "2026-03-06" },
		{ id: "b", label: "Build", start: "2026-03-09", duration: 10, dependsOn: ["a"] },
		{ id: "c", label: "Ship", start: "2026-03-19", milestone: true, dependsOn: ["b"] },
	],
};

function issuesOf(input: object): readonly GanttValidationIssue[] {
	try {
		parseGanttDiagram(input);
		return [];
	} catch (error) {
		if (error instanceof GanttValidationError) return error.issues;
		throw error;
	}
}

/** The plan with one task patched; an undefined field is removed. */
const withTask = (index: number, patch: object) => ({
	...plan,
	tasks: plan.tasks.map((task, at) =>
		at === index
			? Object.fromEntries(
					Object.entries({ ...task, ...patch }).filter(([, value]) => value !== undefined),
				)
			: task,
	),
});

describe("canonical Gantt chart", () => {
	it("round-trips the fixture through the canonical union", () => {
		expect(parseCanonicalDiagram(ganttFixture)).toEqual(ganttFixture);
		expect(parseGanttDiagram(plan).tasks).toHaveLength(3);
	});

	it("schedules end as the inclusive last day and duration in calendar days", () => {
		const diagram = parseGanttDiagram(plan);
		const [design, build, ship] = diagram.tasks.map((task) => ganttTaskSchedule(task)!);
		expect(formatGanttDay(design!.start)).toBe("2026-03-02");
		expect(design!.end - design!.start).toBe(5);
		expect(formatGanttDay(build!.end - 1)).toBe("2026-03-18");
		expect(ship).toEqual({ start: parseGanttDay("2026-03-19"), end: ship!.start, milestone: true });
		// Zero duration is a milestone too.
		expect(ganttTaskSchedule({ ...diagram.tasks[1]!, duration: 0 })?.milestone).toBe(true);
	});

	it("parses calendar days only", () => {
		expect(parseGanttDay("2026-02-29")).toBeUndefined();
		expect(parseGanttDay("2026-03")).toBeUndefined();
		expect(parseGanttDay("2026-03-01T09:00Z")).toBeUndefined();
		expect(formatGanttDay(parseGanttDay("2028-02-29")!)).toBe("2028-02-29");
	});

	it("groups rows by phase in phase order, keeping task order inside a phase", () => {
		const rows = ganttRows(
			parseGanttDiagram({
				...plan,
				phases: ["Ship", "Make"],
				tasks: [
					{ ...plan.tasks[0], phase: "Make" },
					{ ...plan.tasks[2], phase: "Ship", dependsOn: [] },
					{ ...plan.tasks[1], phase: "Make" },
				],
			}),
		);
		expect(rows.map((row) => [row.phase, row.tasks.map((task) => task.id)])).toEqual([
			["Ship", ["c"]],
			["Make", ["a", "b"]],
		]);
	});

	it.each([
		["an unparseable start", withTask(0, { start: "March 2" }), "invalid_gantt_date"],
		["an end before the start", withTask(0, { end: "2026-03-01" }), "invalid_gantt_span"],
		["both end and duration", withTask(0, { duration: 5 }), "invalid_gantt_span"],
		["neither end nor duration", withTask(1, { duration: undefined }), "invalid_gantt_span"],
		["a fractional duration", withTask(1, { duration: 2.5 }), "invalid_gantt_span"],
		["a milestone with a duration", withTask(2, { duration: 3 }), "invalid_gantt_span"],
		["a milestone ending later", withTask(2, { end: "2026-03-20" }), "invalid_gantt_span"],
		["progress over 100", withTask(1, { progress: 140 }), "invalid_gantt_progress"],
		["progress on a milestone", withTask(2, { progress: 50 }), "invalid_gantt_progress"],
		["a duplicate id", withTask(1, { id: "a", dependsOn: [] }), "duplicate_task_id"],
		["an unknown predecessor", withTask(1, { dependsOn: ["x"] }), "missing_dependency"],
		["a self dependency", withTask(1, { dependsOn: ["b"] }), "self_dependency"],
		["a cycle", withTask(0, { dependsOn: ["c"] }), "gantt_dependency_cycle"],
		["a task outside the phases", withTask(0, { phase: "Make" }), "invalid_gantt_phase"],
		["an invalid today", { ...plan, today: "now" }, "invalid_gantt_date"],
		["a billion-day duration", withTask(1, { duration: 1_000_000_000 }), "invalid_gantt_span"],
		["an end centuries out", withTask(0, { end: "2400-03-06" }), "gantt_too_large"],
		["a today centuries away", { ...plan, today: "1800-01-01" }, "gantt_too_large"],
		[
			"too many tasks",
			{
				...plan,
				tasks: Array.from({ length: GANTT_MAX_TASKS + 1 }, (_, index) => ({
					id: `t${index}`,
					label: `Task ${index}`,
					start: "2026-01-01",
					duration: 1,
				})),
			},
			"gantt_too_large",
		],
	])("rejects %s with a repair hint", (_name, input, code) => {
		const issues = issuesOf(input);
		expect(issues.map((issue) => issue.code)).toContain(code);
		expect(issues.every((issue) => issue.hint.length > 0)).toBe(true);
	});

	it("names the cycle it rejects", () => {
		const [issue] = issuesOf(withTask(0, { dependsOn: ["c"] }));
		expect(issue?.message).toBe("Dependencies form a cycle: a → b → c → a.");
	});

	it("accepts a milestone that ends without its own end date or with end on the same day", () => {
		expect(issuesOf(withTask(2, { end: "2026-03-19" }))).toEqual([]);
		expect(issuesOf(withTask(2, { milestone: undefined, duration: 0 }))).toEqual([]);
	});

	it("reports successors that start before a predecessor finishes, without rejecting them", () => {
		const early = parseGanttDiagram(withTask(1, { start: "2026-03-05" }));
		expect(ganttScheduleConflicts(early)).toEqual([
			{ task: "b", dependsOn: "a", finishes: "2026-03-06", path: "tasks.[1].dependsOn.[0]" },
		]);
		expect(ganttScheduleConflicts(parseGanttDiagram(plan))).toEqual([]);
		// A milestone may fall on its predecessor's last day.
		expect(ganttScheduleConflicts(parseGanttDiagram(withTask(2, { start: "2026-03-18" })))).toEqual(
			[],
		);
	});
});
