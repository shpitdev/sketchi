import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import {
	formatGanttDay,
	ganttTaskSchedule,
	GanttValidationIssueCodeSchema,
	type GanttValidationIssue,
	parseGanttDay,
	parseGanttDiagram,
} from "../document.js";

import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { buildGantt } from "../../../build/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts.js";

const storage = makeMemoryArtifactStorage();
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
	artifactStorage = storage,
) {
	let id = 0;
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_gantt_${(id += 1)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, artifactStorage),
		),
	);
}
const options = {
	inlineArtifacts: ["scene", "excalidraw"],
	artifactFormats: ["scene", "excalidraw"],
};
const build = (spec: unknown) => run(buildGantt({ spec, options }));

const plan = {
	title: "Release plan",
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
			id: "launch",
			label: "Launch",
			start: "2026-03-19",
			milestone: true,
			phase: "Ship",
			dependsOn: ["api"],
		},
	],
};

describe("Code Mode native Gantt chart", () => {
	it("builds a plan into a validated, patchable artifact with bound dependency arrows", async () => {
		const built = await build(plan);
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec).toMatchObject({ id: "release-plan", tasks: plan.tasks });
		expect(built.quality.summary).toEqual({ nodeCount: 3, edgeCount: 2 });
		expect(built.issues).toEqual([]);
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		const bar = excalidraw.elements.find((element) => element.id === "node:gantt:task:api");
		expect(bar?.["roundness"]).toBeNull();
		expect(bar?.["boundElements"]).toEqual(
			expect.arrayContaining([
				{ id: "gantt:dependency:design:api", type: "arrow" },
				{ id: "gantt:dependency:api:launch", type: "arrow" },
			]),
		);
		const arrow = excalidraw.elements.find(
			(element) => element.id === "gantt:dependency:design:api",
		);
		expect(arrow).toMatchObject({
			startBinding: { elementId: "node:gantt:task:design" },
			endBinding: { elementId: "node:gantt:task:api" },
		});
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["gantt:task:api"] },
						style: { fillColor: "#e34948" },
					},
				],
				options: {
					artifactFormats: ["scene", "excalidraw"],
					inlineArtifacts: ["scene", "excalidraw"],
				},
			}),
		);
		if (!patched.ok) throw new Error(JSON.stringify(patched.issues));
		const scene = patched.artifact.formats.find((format) => format.format === "scene")?.inline as {
			elements: { id: string; rendererRole?: string; fillColor?: string }[];
		};
		// The patched bar is still a Gantt mark, so it keeps square corners and gains no label.
		expect(scene.elements.find((element) => element.id === "node:gantt:task:api")).toMatchObject({
			rendererRole: "gantt-mark",
			fillColor: "#e34948",
		});
		expect(
			JSON.stringify(
				patched.artifact.formats.find(({ format }) => format === "excalidraw")?.inline,
			),
		).not.toContain("__sketchi_node_label__");
	});

	it("builds a successor that starts before its predecessor finishes, with a warning", async () => {
		const built = await build({
			...plan,
			tasks: plan.tasks.map((task) =>
				task.id === "api" ? { ...task, start: "2026-03-05" } : task,
			),
		});
		expect(built.ok).toBe(true);
		expect(built.issues).toEqual([
			expect.objectContaining({
				code: "gantt_schedule_conflict",
				severity: "warning",
				ref: { kind: "request", path: "spec.tasks.[1].dependsOn.[0]" },
				stage: "input",
			}),
		]);
	});
});

const canonical = {
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
	const result = parseGanttDiagram(input);
	if (Result.isSuccess(result)) return [];
	const error = result.failure;
	if (error._tag !== "GanttValidationError") return expect.fail(error.message);
	return error.issues;
}

/** The plan with one task patched; an undefined field is removed. */
const withTask = (index: number, patch: object) => ({
	...canonical,
	tasks: canonical.tasks.map((task, at) =>
		at === index
			? Object.fromEntries(
					Object.entries({ ...task, ...patch }).filter(([, value]) => value !== undefined),
				)
			: task,
	),
});

describe("Gantt schedule", () => {
	it("schedules end as the inclusive last day and duration in calendar days", () => {
		const diagram = parseGanttDiagram(canonical).pipe(Result.getOrThrow);
		const [design, build, ship] = diagram.tasks.map((task) => ganttTaskSchedule(task)!);
		expect(formatGanttDay(design!.start)).toBe("2026-03-02");
		expect(design!.end - design!.start).toBe(5);
		expect(formatGanttDay(build!.end - 1)).toBe("2026-03-18");
		expect(ship).toEqual({ start: parseGanttDay("2026-03-19"), end: ship!.start, milestone: true });
		// Zero duration is a milestone too.
		expect(ganttTaskSchedule({ ...diagram.tasks[1]!, duration: 0 })?.milestone).toBe(true);
	});
});

/** One minimal bad plan per code the validator owns. */
const bad: Record<string, object> = {
	gantt_too_large: withTask(0, { end: "2400-03-06" }),
	duplicate_task_id: withTask(1, { id: "a", dependsOn: [] }),
	invalid_gantt_date: withTask(0, { start: "March 2" }),
	invalid_gantt_span: withTask(0, { end: "2026-03-01" }),
	invalid_gantt_phase: withTask(0, { phase: "Make" }),
	invalid_gantt_progress: withTask(1, { progress: 140 }),
	missing_dependency: withTask(1, { dependsOn: ["x"] }),
	self_dependency: withTask(1, { dependsOn: ["b"] }),
	gantt_dependency_cycle: withTask(0, { dependsOn: ["c"] }),
};

describe("Gantt validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(GanttValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad plan", (code, input) => {
		expect(issuesOf(input).map((issue) => issue.code)).toContain(code);
	});
});
