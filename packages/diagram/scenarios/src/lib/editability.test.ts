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
const session = createEditSession(await loadExcalidrawEditor());
const measure = (elements: readonly unknown[], cap = EDIT_DRAG_CAP) =>
	withoutHeldTimers(() => measureEditability(session, elements, { cap }));

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
