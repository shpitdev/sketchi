import type { CanvasSpec } from "@sketchi/drawing";
import { parseFlowchartDiagram } from "../../families/flowchart/document";
import { laneFixtures, laneStressFixtures } from "../../families/flowchart/fixtures/lane-fixtures";
import { renderFlowchartDiagram } from "../../families/flowchart/render";
import { getCanvasValidationIssues, laneRegionIssues } from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomLanedFlowcharts,
	diagonalRuns,
	labelDefects,
	withoutLanes,
	KNOWN_LANED_LABEL_DEFECTS,
	routingCounts,
	worseThanPinned,
	LANED_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
} from "./routing-fuzz-helpers";

describe("laned routing fuzz", () => {
	// 30 laned flowcharts x 4 directions, each rendered once. Every export is valid
	// and orthogonal, every step sits in its own lane's band, lanes keep their
	// order and one length, no edge crosses a header, runs along a lane boundary
	// or leaves the lanes, and labels stay whole and clear of nodes, headers and
	// boundaries.
	const flowcharts = randomLanedFlowcharts(30, 20261022);
	const scenes = new Map<string, CanvasSpec[]>();
	const rendered = (direction: "TB" | "BT" | "LR" | "RL") => {
		if (!scenes.has(direction))
			scenes.set(
				direction,
				flowcharts.map((spec) =>
					renderFlowchartDiagram(
						parseFlowchartDiagram({
							...spec,
							type: "flowchart",
							layout: { direction, edgeRouting: "orthogonal" },
						}).pipe(Result.getOrThrow),
					),
				),
			);
		return scenes.get(direction)!;
	};

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every laned flowchart with its steps in their lanes and its routes clear", () => {
			const failures = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				return [
					...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
						(issue) => issue.message,
					),
					...diagonalRuns(scene),
					...laneRegionIssues(scene, spec)
						.filter((issue) => issue.code !== "label-covered")
						.map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("keeps laned labels whole and clear of lines, nodes, headers and boundaries", () => {
			const defects = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(spec.nodes.map((node) => [`node:${node.id}`, node.label]));
				return [
					...labelDefects(withoutLanes(exported.elements), authored),
					...laneRegionIssues(scene, spec)
						.filter((issue) => issue.code === "label-covered")
						.map((issue) => `${issue.elementId} on a lane boundary`),
				].map((defect) => `${index}: ${defect}`);
			});
			if (process.env.PRINT_ROUTING)
				console.log("LABELS laned", direction, JSON.stringify(defects));
			expect(
				defects.filter((defect) => !KNOWN_LANED_LABEL_DEFECTS[direction].includes(defect)),
			).toEqual([]);
		}, 60_000);

		it("draws no laned flowchart with more crossings or reader-scale findings than pinned", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN laned",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			expect(worseThanPinned("laned", counts, LANED_ROUTING[direction], false)).toEqual([]);
			expect(moreHeadsThanPinned("laned", direction, counts)).toEqual([]);
			expect(moreSharedThanPinned("laned", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("laned", direction, counts)).toEqual([]);
		}, 60_000);
	});

	it.each([...Object.keys(laneFixtures), ...Object.keys(laneStressFixtures)])(
		"exports the %s lanes valid and clear in every direction",
		(name) => {
			const fixture = { ...laneFixtures, ...laneStressFixtures }[name]!;
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderFlowchartDiagram({
					...fixture,
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(fixture.nodes.map((node) => [`node:${node.id}`, node.label]));
				expect([
					...validateExcalidrawScene(exported).issues,
					...laneRegionIssues(scene, fixture),
					...labelDefects(withoutLanes(exported.elements), authored),
				]).toEqual([]);
			}
		},
	);
});
