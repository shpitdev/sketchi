import type { CanvasSpec } from "@sketchi/drawing";
import { parseFlowchartDiagram } from "../../families/flowchart/document";
import { groupFixtures } from "../../families/flowchart/group-fixtures";
import { renderFlowchartDiagram } from "../../families/flowchart/render";
import { getCanvasValidationIssues, groupRegionIssues } from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomGroupedFlowcharts,
	FULL,
	diagonalRuns,
	routingCounts,
	worseThanPinned,
	GROUPED_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
	ownEndStrays,
	curvedStrays,
	labelDefects,
} from "./routing-fuzz-helpers";

describe("grouped routing fuzz", () => {
	// Full proof: 30 grouped flowcharts x 4 directions, each rendered once. Every export is valid, each group's
	// frame holds exactly its members and stays apart from the others, no edge
	// passes through a group it does not belong to or runs along a frame, a
	// group's own edges stay inside it, and group names stay clear of edges and
	// labels. Branch labels on these dense random graphs are judged as the label
	// fuzz judges ungrouped ones; grouped, they draw no more defects in total.
	const flowcharts = randomGroupedFlowcharts(FULL ? 30 : 8, 20261020);
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
		it("exports every grouped flowchart with its groups whole, apart and clear", () => {
			const failures = flowcharts.flatMap((spec, index) => {
				const scene = rendered(direction)[index]!;
				const exported = convertSceneToExcalidraw(scene);
				const members = new Map<string, string>(
					spec.nodes.flatMap((node) =>
						"group" in node ? [[`node:${node.id}`, `group:${node.group}`] as const] : [],
					),
				);
				return [
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...diagonalRuns(scene),
					...groupRegionIssues(scene).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...exported.elements
						.filter(
							(element) =>
								element.type === "ellipse" ||
								element.type === "rectangle" ||
								element.type === "diamond",
						)
						.flatMap((element) =>
							(members.get(element.id) ?? null) === element.frameId
								? []
								: [`${element.id} in frame ${String(element.frameId)}`],
						),
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("draws no grouped flowchart with more crossings or reader-scale findings than main", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN grouped",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			expect(worseThanPinned("grouped", counts, GROUPED_ROUTING[direction])).toEqual([]);
			expect(moreHeadsThanPinned("grouped", direction, counts)).toEqual([]);
			expect(moreSharedThanPinned("grouped", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("grouped", direction, counts)).toEqual([]);
		}, 60_000);

		it("routes no grouped line into its own end node's drawn shape past the run that meets it", () => {
			expect(
				rendered(direction).flatMap((scene, index) =>
					ownEndStrays(scene).map((stray) => `${index} ${stray}`),
				),
			).toEqual([]);
		});

		it("curves every grouped flowchart into no node, no group neither end is in, and out of none both are", () => {
			const strays = flowcharts.flatMap((spec, index) => {
				const curved = renderFlowchartDiagram(
					parseFlowchartDiagram({
						...spec,
						type: "flowchart",
						layout: { direction, edgeRouting: "curved" },
					}).pipe(Result.getOrThrow),
				);
				return curvedStrays(curved, rendered(direction)[index]!).map(
					(stray) => `${index} ${stray}`,
				);
			});
			expect(strays).toEqual([]);
		}, 120_000);
	});

	it.each(Object.keys(groupFixtures) as (keyof typeof groupFixtures)[])(
		"exports the %s fixture with its groups whole, apart and clear",
		(name) => {
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderFlowchartDiagram({
					...groupFixtures[name],
					layout: { direction, edgeRouting: "orthogonal" },
				});
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(
					groupFixtures[name].nodes.map((node) => [`node:${node.id}`, node.label]),
				);
				expect([
					...validateExcalidrawScene(exported).issues,
					...groupRegionIssues(scene),
					...labelDefects(exported.elements, authored),
				]).toEqual([]);
			}
		},
	);
});
