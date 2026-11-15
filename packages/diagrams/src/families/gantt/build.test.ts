import { buildResponse, type BuildRejection } from "../../build/operation.js";
import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	applyDiagramPatch,
	buildGantt,
	CodeModeRuntimeEnvironment,
} from "../../build/code-mode/runtime.js";
import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
	CodeModeArtifactStorageError,
} from "../../build/code-mode/artifacts.js";

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
				message: 'Task "api" starts before "design" finishes on 2026-03-06.',
				stage: "input",
				hint: 'Keep dates the prompt states; otherwise start "api" after 2026-03-06.',
			}),
		]);
	});

	it.each([
		[{ dependsOn: ["nowhere"] }, "missing_dependency"],
		[{ dependsOn: ["api"] }, "self_dependency"],
		[{ end: "2026-03-01", duration: undefined }, "invalid_gantt_span"],
		[{ start: "March 9" }, "invalid_gantt_date"],
		[{ phase: undefined }, "invalid_gantt_phase"],
		[{ progress: 140 }, "invalid_gantt_progress"],
		[{ duration: 1_000_000_000 }, "invalid_gantt_span"],
	])("rejects invalid plans with structured repair issues", async (patch, code) => {
		const tasks = plan.tasks.map((task) =>
			task.id === "api"
				? Object.fromEntries(
						Object.entries({ ...task, ...patch }).filter(([, value]) => value !== undefined),
					)
				: task,
		);
		const result = await build({ ...plan, tasks });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_gantt");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
		expect(result.issues.every((issue) => issue.hint && issue.stage === "input")).toBe(true);
	});

	it("rejects a dependency cycle", async () => {
		const typed = await run(
			Effect.result(
				buildGantt({
					spec: {
						...plan,
						tasks: plan.tasks.map((task) =>
							task.id === "design" ? { ...task, dependsOn: ["launch"] } : task,
						),
					},
				}),
			),
		);
		if (Result.isSuccess(typed)) throw new Error("Expected dependency refusal");
		expect(typed.failure.reason).toMatchObject({
			_tag: "Document",
			error: { _tag: "GanttValidationError" },
		});
		const result = typed.failure.toResult();
		expect(result.status).toBe("invalid_gantt");
		expect(result.issues.map((issue) => issue.code)).toEqual(["gantt_dependency_cycle"]);
	});

	it("rejects malformed input before validation", async () => {
		const result = await build({ title: "Bad", tasks: [{ id: "a", label: "A", start: 20260302 }] });
		expect(result.ok).toBe(false);
		expect(result.status).toBe("invalid_input");
	});
	it.each(["input", "semantic", "export", "storage"] as const)(
		"does not emit schedule warnings when %s fails",
		async (mode) => {
			const conflicting = {
				...plan,
				tasks: plan.tasks.map((task) =>
					task.id === "api" ? { ...task, start: "2026-03-05" } : task,
				),
			};
			const memory = makeMemoryArtifactStorage();
			const result = await run(
				buildGantt({
					spec:
						mode === "input"
							? { ...conflicting, tasks: null }
							: mode === "semantic"
								? {
										...conflicting,
										tasks: conflicting.tasks.map((task) =>
											task.id === "api" ? { ...task, progress: 140 } : task,
										),
									}
								: conflicting,
					options: mode === "export" ? { artifactFormats: ["png"] } : options,
				}),
				mode === "storage"
					? {
							...memory,
							write: () =>
								Effect.fail(
									new CodeModeArtifactStorageError({
										operation: "write",
										message: "Deliberate storage refusal",
										cause: "test",
									}),
								),
						}
					: memory,
			);
			expect(result.ok).toBe(false);
			expect(result.status).toBe(
				{
					input: "invalid_input",
					semantic: "invalid_gantt",
					export: "export_failed",
					storage: "storage_failed",
				}[mode],
			);
			expect(result.issues.some((issue) => issue.code === "gantt_schedule_conflict")).toBe(false);
		},
	);
});
