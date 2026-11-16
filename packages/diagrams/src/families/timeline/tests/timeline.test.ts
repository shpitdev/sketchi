import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { CANVAS_LIMITS } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { buildResponse, type BuildRejection } from "../../../build/operation.js";
import { buildTimeline } from "../../../build/code-mode/builds.js";
import { CodeModeRuntimeEnvironment } from "../../../build/code-mode/runtime.js";
import { applyDiagramPatch } from "../../../canvas/patch.js";
import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
} from "../../../build/code-mode/artifacts.js";
import {
	orderedTimelineEvents,
	parseTimelineDiagram,
	TIMELINE_MAX_EVENTS,
	TIMELINE_MAX_LANES,
	TimelineValidationIssueCodeSchema,
	type TimelineValidationIssue,
} from "../document.js";

const storage = makeMemoryArtifactStorage();
function run<A, E extends BuildRejection<unknown>>(
	effect: Effect.Effect<A, E, CodeModeRuntimeEnvironment | CodeModeArtifactStorage>,
) {
	let id = 0;
	return Effect.runPromise(
		buildResponse(effect).pipe(
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_timeline_${(id += 1)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}
const build = (spec: unknown) =>
	run(
		buildTimeline({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}),
	);
type Excalidraw = Parameters<typeof validateExcalidrawScene>[0];

describe("Code Mode native timeline", () => {
	it("builds spans, milestones, lanes and today into a validated, patchable artifact", async () => {
		const built = await build({
			title: "Launch phases",
			today: "2026-03-10",
			lanes: ["Product", "Marketing"],
			// Out of order on purpose: the timeline sorts by date.
			events: [
				{ id: "launch", label: "Launch", date: "2026-08-04", kind: "milestone", lane: "Product" },
				{ id: "build", label: "Build", date: "2026-02-16", end: "2026-05-29", lane: "Product" },
				{ id: "blog", label: "Launch blog", date: "2026-08-04", lane: "Marketing" },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const excalidraw = built.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Excalidraw;
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
		expect(excalidraw.elements.find((element) => element.id === "node:event:launch")?.type).toBe(
			"diamond",
		);
		const patched = await run(
			applyDiagramPatch({
				source: { artifactId: built.artifact.artifactId },
				operations: [
					{
						op: "setStyle",
						selector: { nodeIds: ["event:launch"] },
						style: { fillColor: "#c0392b" },
					},
				],
			}),
		);
		expect(patched.ok, JSON.stringify(patched.issues)).toBe(true);
	});

	it("draws the largest chronology its family allows on one canvas", async () => {
		const lanes = Array.from(
			{ length: TIMELINE_MAX_LANES },
			(_, index) => `Workstream ${index + 1}`,
		);
		// Six weeks apart but for one pair on a lane a day apart. That pair once set the scale
		// and broke the axis between nearly every other pair, on every lane: 1,668 elements.
		let day = Date.UTC(2024, 0, 15);
		const events = Array.from({ length: TIMELINE_MAX_EVENTS }, (_, index) => {
			day += (index === 31 ? 1 : 42) * 86_400_000;
			return {
				id: `e${index + 1}`,
				label: `Milestone ${index + 1} for the program`,
				date: new Date(day).toISOString().slice(0, 10),
				lane: lanes[Math.floor((index * lanes.length) / TIMELINE_MAX_EVENTS)],
			};
		});
		const result = await build({ title: "Program milestones", lanes, events });
		if (!result.ok) throw new Error(JSON.stringify(result.issues));
		const scene = result.artifact.formats.find((format) => format.format === "scene")?.inline as {
			readonly elements: readonly unknown[];
		};
		expect(scene.elements.length).toBeLessThanOrEqual(CANVAS_LIMITS.maxElements);
		// The pair now takes one break of its own.
		expect(scene.elements.length).toBeLessThan(400);
		const exported = result.artifact.formats.find((format) => format.format === "excalidraw")
			?.inline as Excalidraw;
		expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
	});
});

const input = {
	id: "release",
	title: "Release",
	type: "timeline",
	events: [{ id: "ship", label: "Ship", date: "2026-10-17" }],
};

describe("timeline chronology", () => {
	it("sorts mixed granularity by period start and zoned instants by real time", () => {
		const diagram = parseTimelineDiagram({
			...input,
			events: [
				{ id: "launch", label: "Launch", date: "2021-06-14" },
				{ id: "founded", label: "Founded", date: "2019" },
				{ id: "seed", label: "Seed", date: "2020-03" },
				{ id: "late", label: "Late", date: "2021-06-14T01:00:00+02:00" },
			],
		}).pipe(Result.getOrThrow);
		expect(orderedTimelineEvents(diagram).map((event) => event.id)).toEqual([
			"founded",
			"seed",
			"late",
			"launch",
		]);
	});
});

function issuesOf(spec: object): readonly TimelineValidationIssue[] {
	const result = parseTimelineDiagram({ ...input, ...spec });
	if (Result.isSuccess(result)) return [];
	const error = result.failure;
	if (error._tag !== "TimelineValidationError") return expect.fail(error.message);
	return error.issues;
}

/** One minimal bad timeline per code the validator owns. */
const bad: Record<string, object> = {
	invalid_timeline_date: { events: [{ id: "a", label: "A", date: "2026-04-01", end: "April 30" }] },
	duplicate_event_id: {
		events: [
			{ id: "a", label: "A", order: 1 },
			{ id: "a", label: "B", order: 2 },
		],
	},
	invalid_timeline_order: {
		events: [
			{ id: "a", label: "A", order: 1 },
			{ id: "b", label: "B", date: "2026-10-01" },
		],
	},
	invalid_timeline_span: {
		events: [{ id: "a", label: "A", date: "2026-05-01", end: "2026-04-30" }],
	},
	invalid_timeline_lane: {
		lanes: ["Eng"],
		events: [{ id: "a", label: "A", date: "2026-04-01", lane: "Ops" }],
	},
	timeline_too_large: {
		events: Array.from({ length: TIMELINE_MAX_LANES + 1 }, (_, index) => ({
			id: `e${index}`,
			label: "E",
			date: "2026-04-01",
			lane: `Lane ${index}`,
		})),
	},
};

describe("Timeline validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(TimelineValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad timeline", (code, spec) => {
		expect(issuesOf(spec).map((issue) => issue.code)).toContain(code);
	});
});
