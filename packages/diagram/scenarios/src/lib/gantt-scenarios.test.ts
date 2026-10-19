import { describe, expect, it } from "vitest";
import { ganttTaskSchedule, type GanttDiagram, type GanttTask } from "@sketchi/diagram-core";
import {
	layoutGanttDiagram,
	renderDiagram,
	type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import {
	ganttClearanceCheck,
	ganttDrawnDataCheck,
	ganttGeometryCheck,
	ganttScenarios,
} from "./gantt-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";
import { candidateFromMcpResult } from "./mcp-results.js";

const failing = (scenario: (typeof ganttScenarios)[number], diagram: GanttDiagram) =>
	evaluateScenarioDiagram(scenario, diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);

/** The diagram with one task replaced; undefined fields are removed. */
function withTask(
	diagram: GanttDiagram,
	id: string,
	patch: { readonly [Key in keyof GanttTask]?: GanttTask[Key] | undefined },
): GanttDiagram {
	return {
		...diagram,
		tasks: diagram.tasks.map((task) =>
			task.id === id
				? (Object.fromEntries(
						Object.entries({ ...task, ...patch }).filter(([, value]) => value !== undefined),
					) as GanttTask)
				: task,
		),
	};
}

describe("prompt-grounded Gantt scenarios", () => {
	// Generation cost is product quality: a deterministic guard on routing work, not a timer.
	it.each(ganttScenarios.map((scenario) => [scenario.id, scenario.expectedDiagram] as const))(
		"routes %s with no fallback and under 2,000 search steps per dependency",
		(_id, diagram) => {
			const { work } = layoutGanttDiagram(diagram);
			const dependencies = diagram.tasks.reduce(
				(sum, task) => sum + (task.dependsOn?.length ?? 0),
				0,
			);
			expect(work.corridors).toBe(0);
			expect(work.placements).toBeLessThanOrEqual(2 * dependencies);
			expect(work.expansions).toBeLessThanOrEqual(2_000 * dependencies);
		},
	);

	it("covers a release with dependencies and milestones, a phased plan with today, and 25+ tasks", () => {
		const diagrams = ganttScenarios.map((scenario) => scenario.expectedDiagram);
		const milestones = (diagram: GanttDiagram) =>
			diagram.tasks.filter((task) => ganttTaskSchedule(task)?.milestone).length;
		expect(diagrams.some((diagram) => milestones(diagram) >= 2 && !diagram.tasks[0]?.phase)).toBe(
			true,
		);
		expect(
			diagrams.some((diagram) => diagram.today && diagram.tasks.every((task) => task.phase)),
		).toBe(true);
		expect(diagrams.some((diagram) => diagram.tasks.length >= 25)).toBe(true);
		expect(
			diagrams.some((diagram) => diagram.tasks.some((task) => task.progress !== undefined)),
		).toBe(true);
		// Every scenario states both end dates and durations, so both forms are graded.
		for (const diagram of diagrams) {
			expect(diagram.tasks.some((task) => task.end !== undefined)).toBe(true);
			expect(diagram.tasks.some((task) => task.duration !== undefined)).toBe(true);
		}
	});

	for (const scenario of ganttScenarios) {
		it(`${scenario.id}: accepts the fixture, drawn to scale and clear`, () => {
			const evaluation = evaluateScenarioDiagram(scenario, scenario.expectedDiagram);
			expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
			for (const id of ["gantt-geometry", "gantt-drawn-data", "gantt-clearance"])
				expect(evaluation.checks.some((check) => check.id === id)).toBe(true);
		});

		it(`${scenario.id}: accepts an end date written as a duration and other ids`, () => {
			const input = scenario.expectedDiagram;
			const rename = (id: string) => `task-${id}`;
			const restated: GanttDiagram = {
				...input,
				tasks: input.tasks.map((task) => {
					const schedule = ganttTaskSchedule(task)!;
					const { end: _end, duration: _duration, dependsOn, ...rest } = task;
					return {
						...rest,
						id: rename(task.id),
						...(schedule.milestone ? {} : { duration: schedule.end - schedule.start }),
						...(dependsOn ? { dependsOn: dependsOn.map(rename) } : {}),
					};
				}),
			};
			expect(failing(scenario, restated)).toEqual([]);
		});
	}

	const [release, cafe, migration] = ganttScenarios as [
		(typeof ganttScenarios)[number],
		(typeof ganttScenarios)[number],
		(typeof ganttScenarios)[number],
	];

	it("catches a wrong date, a wrong duration, a dropped task and a computed-off-by-one end", () => {
		const input = release.expectedDiagram;
		expect(failing(release, withTask(input, "api", { start: "2026-04-14" }))).toContain(
			"gantt-dates:api",
		);
		expect(failing(release, withTask(input, "ux", { duration: 7 }))).toContain("gantt-dates:ux");
		// An end computed as start + duration is a day late.
		expect(
			failing(release, withTask(input, "ios", { duration: undefined, end: "2026-05-06" })),
		).toContain("gantt-dates:ios");
		const dropped = {
			...input,
			tasks: input.tasks
				.filter((task) => task.id !== "review")
				.map((task) => (task.id === "launch" ? { ...task, dependsOn: ["beta"] } : task)),
		};
		expect(failing(release, dropped)).toEqual(
			expect.arrayContaining(["gantt-task-count", "gantt-task:review"]),
		);
	});

	it("catches a dropped dependency, an invented one, a lost milestone and lost progress", () => {
		const input = release.expectedDiagram;
		expect(
			failing(release, withTask(input, "integration", { dependsOn: ["api", "ios"] })),
		).toContain("gantt-dependency:android>integration");
		expect(failing(release, withTask(input, "ios", { dependsOn: ["ux", "api"] }))).toContain(
			"gantt-no-invented-dependencies",
		);
		expect(
			failing(release, withTask(input, "beta", { milestone: undefined, duration: 1 })),
		).toContain("gantt-dates:beta");
		expect(failing(release, withTask(input, "api", { progress: undefined }))).toContain(
			"gantt-progress:api",
		);
	});

	it("catches a task in the wrong phase, phases out of order, and a missing today", () => {
		const input = cafe.expectedDiagram;
		expect(failing(cafe, withTask(input, "waste", { phase: "Build-out" }))).toContain(
			"gantt-phase:waste",
		);
		expect(
			failing(cafe, { ...input, phases: ["Demolition", "Permits", "Build-out", "Opening"] }),
		).toEqual(expect.arrayContaining(["gantt-phase-order", "gantt-drawn-data"]));
		const { today: _today, ...withoutToday } = input;
		expect(failing(cafe, withoutToday as GanttDiagram)).toContain("gantt-today");
	});

	it("grades what is drawn: a missing arrow, a misplaced bar and a stray caption fail", () => {
		const diagram = migration.expectedDiagram;
		const scene = renderDiagram(diagram);
		const edit = (
			change: (elements: RenderedDiagramScene["elements"]) => RenderedDiagramScene["elements"],
		): RenderedDiagramScene => ({ ...scene, elements: change(scene.elements) });
		const noArrow = edit((elements) =>
			elements.filter((element) => element.id !== "gantt:dependency:crm:finance"),
		);
		expect(ganttGeometryCheck(diagram, noArrow).passed).toBe(false);
		expect(ganttDrawnDataCheck(migration, diagram, noArrow).passed).toBe(false);
		const shifted = edit((elements) =>
			elements.map((element) =>
				element.id === "node:gantt:task:crm" && element.type === "node"
					? { ...element, x: element.x + 10 }
					: element,
			),
		);
		expect(ganttGeometryCheck(diagram, shifted).passed).toBe(false);
		const wrongCaption = edit((elements) =>
			elements.map((element) =>
				element.id === "gantt:caption:crm" && element.type === "text"
					? { ...element, text: "Mar 23 – Apr 11" }
					: element,
			),
		);
		expect(ganttDrawnDataCheck(migration, diagram, wrongCaption).passed).toBe(false);
		const collided = edit((elements) =>
			elements.map((element) =>
				element.id === "gantt:label:crm" && element.type === "text"
					? { ...element, y: element.y + 50 }
					: element,
			),
		);
		expect(ganttClearanceCheck(collided).passed).toBe(false);
	});

	it("grades a buildGantt MCP result through its normalized spec", () => {
		const { type: _type, ...spec } = release.expectedDiagram;
		const receipt = {
			operation: "buildGantt",
			index: 0,
			ok: true,
			status: "accepted",
			buildId: "build_1",
			normalizedSpec: spec,
			quality: { accepted: true, score: 10, threshold: 8 },
			issues: [],
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { buildId: "build_1" }, builds: [receipt] },
			"gantt",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) return;
		expect(evaluateScenarioDiagram(release, candidate.diagram).ok).toBe(true);
	});
});
