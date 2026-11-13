import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getDiagramScenario } from "./diagram-scenarios.js";
import { createEditSession } from "./edit-session.js";
import { EDIT_DRAG_CAP, type EditabilityMetrics, measureEditability } from "./editability.js";
import { evaluateScenarioFixture } from "./evaluate.js";
import { loadExcalidrawEditor, withoutHeldTimers } from "./excalidraw-editor.js";
import { editabilityMetrics } from "./scene-editability.js";

const exported = (id: string) =>
	evaluateScenarioFixture(getDiagramScenario(id)).excalidrawScene.elements;

/** Excalidraw's editor loaded as the scenario CLI loads it: plain Node, a linkedom DOM. */
const editor = await loadExcalidrawEditor();
const session = createEditSession(editor);
const measure = (elements: readonly unknown[], cap = EDIT_DRAG_CAP) =>
	withoutHeldTimers(() => measureEditability(session, elements, { cap }));

/** Excalidraw's static map from each element id to the scene holding it. */
const sceneMap = (editor.Scene_default as unknown as { sceneMapById: Map<string, unknown> })
	.sceneMapById;

/**
 * Box `a` and a sharp polyline from its right side to box `b`'s top, `a` and the
 * route in one group, `b` listed first so the schedule drags `a` by [0, 36].
 * Ids end in `suffix`, so each call is a distinct scene.
 */
const groupedRoute = (suffix = "") => {
	const id = (name: string) => `${name}${suffix}`;
	const box = (name: string, x: number, y: number, groupIds: string[]) => ({
		id: id(name),
		type: "rectangle",
		x,
		y,
		width: 100,
		height: 60,
		groupIds,
		boundElements: [{ id: id("route"), type: "arrow" }],
	});
	return [
		box("b", 200, 200, []),
		box("a", 0, 0, [id("group")]),
		{
			id: id("route"),
			type: "arrow",
			x: 101,
			y: 30,
			width: 149,
			height: 169,
			points: [
				[0, 0],
				[149, 0],
				[149, 169],
			],
			groupIds: [id("group")],
			startBinding: { elementId: id("a"), focus: 0, gap: 1 },
			endBinding: { elementId: id("b"), focus: 0, gap: 1 },
			roundness: null,
			elbowed: false,
		},
	];
};

/**
 * The numbers diagram-ui's arrow-edits.test.tsx reads from its own drags, with
 * Excalidraw's editor loaded by Vite into jsdom; change both together.
 */
const harness: Record<string, EditabilityMetrics> = {
	"sketchi-onboarding-decision-flow": {
		editBoundRoutes: 5,
		editDragErrors: 0,
		editDrags: 5,
		editEndsInside: 0,
		editEndsOffEdge: 0,
		editFirstTouchMoves: 0,
		editReleasedRoutes: 0,
		editRouteMoves: 10,
		editRoutesThroughShape: 0,
		editStrayRouteMoves: 0,
	},
	"whole-company-org-chart-large": {
		editBoundRoutes: 79,
		editDragErrors: 0,
		editDrags: 80,
		editEndsInside: 0,
		editEndsOffEdge: 0,
		editFirstTouchMoves: 0,
		editReleasedRoutes: 30,
		editRouteMoves: 158,
		editRoutesThroughShape: 5,
		editStrayRouteMoves: 0,
	},
	"warehouse-automation-gantt-large": {
		editBoundRoutes: 74,
		editDragErrors: 0,
		editDrags: 60,
		editEndsInside: 0,
		editEndsOffEdge: 0,
		editFirstTouchMoves: 0,
		editReleasedRoutes: 35,
		editRouteMoves: 148,
		editRoutesThroughShape: 3,
		editStrayRouteMoves: 0,
	},
	"photosynthesis-study-mindmap-v2": {
		editBoundRoutes: 21,
		editDragErrors: 0,
		editDrags: 22,
		editEndsInside: 0,
		editEndsOffEdge: 0,
		editFirstTouchMoves: 0,
		editReleasedRoutes: 0,
		editRouteMoves: 164,
		editRoutesThroughShape: 0,
		editStrayRouteMoves: 0,
	},
};

describe("editability metrics", () => {
	it.each(Object.entries(harness))(
		"reads the arrow-edits harness's numbers for %s with every bound shape dragged",
		(id, expected) => {
			expect(measure(exported(id), Infinity)).toEqual(expected);
		},
	);

	it.each([
		"quarterly-revenue-bar-chart",
		"team-skills-venn",
		"online-purchase-journey-v2",
		"release-milestones-timeline-v2",
		"cloud-budget-sankey-v2",
		"effort-impact-quadrant-v2",
	])("reports no bound routes for %s, and nothing to count", (id) => {
		expect(measure(exported(id))).toEqual({ editBoundRoutes: 0 });
	});

	it("drags at most the cap's shapes, spread through the full schedule", () => {
		const elements = exported("whole-company-org-chart-large");
		const capped = measure(elements);
		const full = harness["whole-company-org-chart-large"]!;
		expect(capped.editDrags).toBe(EDIT_DRAG_CAP);
		expect(capped.editBoundRoutes).toBe(full.editBoundRoutes);
		for (const [key, value] of Object.entries(capped))
			expect(value, key).toBeLessThanOrEqual(full[key as keyof EditabilityMetrics]!);
		// The same scene always reads the same.
		expect(measure(elements)).toEqual(capped);
	});

	it("leaves a route its shape's group selects to the person editing it, as the canvas does", () => {
		withoutHeldTimers(() => {
			const scene = session.open(groupedRoute());
			try {
				// A click on `a` selects its group, the route with it; the canvas sees that selection.
				const a = scene.getNonDeletedElementsMap().get("a")!;
				expect(session.drag(scene, a, [0, 36])).toEqual([]);
				expect(scene.getNonDeletedElementsMap().get("route")?.elbowed).toBe(false);
			} finally {
				session.close(scene);
			}
		});
		expect(measure(groupedRoute(), Infinity)).toMatchObject({
			editDrags: 2,
			editReleasedRoutes: 0,
		});
	});

	it("lets every scene it opens go, whether it measures, finds nothing to drag or fails", () => {
		const before = sceneMap.size;
		for (let index = 0; index < 10; index += 1) measure(groupedRoute(`-${index}`));
		// Restore drops a binding to a shape the scene lacks, leaving nothing to drag.
		const unbound = [
			{
				id: "loose",
				type: "arrow",
				x: 0,
				y: 0,
				points: [
					[0, 0],
					[40, 0],
				],
				startBinding: { elementId: "missing", focus: 0, gap: 1 },
			},
		];
		expect(measure(unbound)).toEqual({ editBoundRoutes: 0 });
		const failing = {
			...session,
			drag: () => {
				throw new Error("A drag failed.");
			},
		};
		expect(() =>
			withoutHeldTimers(() => measureEditability(failing, groupedRoute("-failing"))),
		).toThrow("A drag failed.");
		expect(sceneMap.size).toBe(before);
	});

	it("leaves the metrics out, with the reason, for a scene the editor can't read", async () => {
		const bound = { type: "arrow", startBinding: { elementId: "missing" } };
		expect(await Effect.runPromise(editabilityMetrics([bound, null]))).toEqual({
			editUnavailable: expect.stringMatching(/^Unable to edit the scene in Excalidraw: /),
		});
	});

	it("reports no bound routes for a scene that binds no arrow without opening it", async () => {
		expect(await Effect.runPromise(editabilityMetrics([null, { type: "arrow" }]))).toEqual({
			editBoundRoutes: 0,
		});
	});
});
