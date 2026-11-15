import { parseFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/diagram";
import {
	zoneFixtures,
	zoneStressFixtures,
} from "@sketchi/diagrams/families/flowchart/zone-fixtures";
import { renderIntermediateDiagram } from "@sketchi/diagrams/graph/scene";
import { getCanvasValidationIssues, zoneRegionIssues } from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomZonedFlowcharts,
	FULL,
	diagonalRuns,
	ZONED_LABEL_DEFECTS,
	routingCounts,
	worseThanPinned,
	ZONED_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
	ownEndStrays,
	curvedStrays,
	labelDefects,
	KNOWN_ZONE_FIXTURE_DEFECTS,
} from "./routing-fuzz-helpers";

describe("zoned routing fuzz", () => {
	// Full proof: 30 zoned flowcharts x 4 directions, each rendered once. Every export is valid, every
	// step sits in its zone and every zone in its parent, zones that do not nest
	// stay apart, no edge passes through a zone neither end sits in, runs along an
	// outline or crosses a label, and an edge whose ends share a zone stays inside it.
	const flowcharts = randomZonedFlowcharts(FULL ? 30 : 4, 20261019);
	const scenes = new Map<
		string,
		Result.Result.Success<ReturnType<typeof renderIntermediateDiagram>>[]
	>();
	const parsed = (direction: "TB" | "BT" | "LR" | "RL") =>
		flowcharts.map((spec) =>
			parseFlowchartDiagram({
				...spec,
				type: "flowchart",
				layout: { direction, edgeRouting: "orthogonal" },
			}).pipe(Result.getOrThrow),
		);
	const rendered = (direction: "TB" | "BT" | "LR" | "RL") => {
		if (!scenes.has(direction))
			scenes.set(
				direction,
				parsed(direction).map((diagram) =>
					renderIntermediateDiagram(diagram).pipe(Result.getOrThrow),
				),
			);
		return scenes.get(direction)!;
	};

	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every zoned flowchart with its zones nested, apart and clear", () => {
			const diagrams = parsed(direction);
			const failures = rendered(direction).flatMap((scene, index) =>
				[
					...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
						(issue) => issue.message,
					),
					...diagonalRuns(scene),
					...zoneRegionIssues(scene, diagrams[index]!).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
				].map((failure) => `${index}: ${failure}`),
			);
			expect(
				failures.filter((failure) => !ZONED_LABEL_DEFECTS[direction].includes(failure)),
			).toEqual([]);
		}, 120_000);

		it("draws no zoned flowchart with more crossings or reader-scale findings than pinned", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN zoned",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			expect(worseThanPinned("zoned", counts, ZONED_ROUTING[direction], false)).toEqual([]);
			expect(moreHeadsThanPinned("zoned", direction, counts)).toEqual([]);
			expect(moreSharedThanPinned("zoned", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("zoned", direction, counts)).toEqual([]);
		}, 120_000);

		it("routes no zoned line into its own end node's drawn shape past the run that meets it", () => {
			expect(
				rendered(direction).flatMap((scene, index) =>
					ownEndStrays(scene).map((stray) => `${index} ${stray}`),
				),
			).toEqual([]);
		}, 120_000);

		it("curves every zoned flowchart into no node, no zone neither end is in, and out of none both are", () => {
			const strays = parsed(direction).flatMap((diagram, index) =>
				curvedStrays(
					renderIntermediateDiagram({
						...diagram,
						layout: { ...diagram.layout, edgeRouting: "curved" },
					}).pipe(Result.getOrThrow),
					rendered(direction)[index]!,
				).map((stray) => `${index} ${stray}`),
			);
			expect(strays).toEqual([]);
		}, 120_000);
	});

	// Lines once drawn through their own end node's shape, each found in one
	// direction: bottom to top, flowchart 3's e17 into n1's diamond; right to
	// left, flowchart 0's e28 under n7's diamond tip and flowchart 2's e5
	// through n6's ellipse. They and every other line keep clear in all four.
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"routes zoned flowcharts 0, 2 and 3 clear of their own ends' shapes in %s",
		(direction) => {
			expect(
				[0, 2, 3].flatMap((index) =>
					ownEndStrays(rendered(direction)[index]!).map((stray) => `${index} ${stray}`),
				),
			).toEqual([]);
		},
		120_000,
	);

	it.each([...Object.keys(zoneFixtures), ...(FULL ? Object.keys(zoneStressFixtures) : [])])(
		"exports the %s fixture with its zones nested, apart and clear",
		(name) => {
			const fixture = { ...zoneFixtures, ...zoneStressFixtures }[name]!;
			for (const direction of ["TB", "BT", "LR", "RL"] as const) {
				const scene = renderIntermediateDiagram({
					...fixture,
					layout: { direction, edgeRouting: "orthogonal" },
				}).pipe(Result.getOrThrow);
				const exported = convertSceneToExcalidraw(scene);
				const authored = new Map(fixture.nodes.map((node) => [`node:${node.id}`, node.label]));
				expect([
					...validateExcalidrawScene(exported).issues,
					...zoneRegionIssues(scene, fixture),
					...labelDefects(exported.elements, authored).filter(
						(defect) => !KNOWN_ZONE_FIXTURE_DEFECTS[`${name} ${direction}`]?.includes(defect),
					),
				]).toEqual([]);
			}
		},
		120_000,
	);
});
