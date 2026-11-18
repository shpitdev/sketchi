import { parseFlowchartDiagram } from "../../families/flowchart/document";
import { renderFlowchartDiagram } from "../../families/flowchart/render";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomTallColumns,
	FULL,
	routingCounts,
	diagonalRuns,
	worseThanPinned,
	TALL_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
	TALL_ASPECTS,
} from "./routing-fuzz-helpers";

describe("tall column fuzz", () => {
	const columns = randomTallColumns(FULL ? 60 : 6);
	// Full proof: 60 columns each way; main draws 21 of them past 2.45:1.
	it.each(["TB", "BT"] as const)(
		"draws %s columns valid, no wider and no worse routed than main",
		(direction) => {
			const scenes = columns.map((spec) =>
				renderFlowchartDiagram(
					parseFlowchartDiagram({
						...spec,
						type: "flowchart",
						layout: { direction, edgeRouting: "orthogonal" },
					}).pipe(Result.getOrThrow),
				),
			);
			const counts = scenes.map((scene) => routingCounts(scene));
			// The hosted PNG frames the drawing in 20 units, in place of its 48-unit padding.
			const aspects = scenes.map(
				({ width, height }) => (Math.max(width, height) - 56) / (Math.min(width, height) - 56),
			);
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN tall",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
					"ASPECTS",
					aspects.map((aspect) => aspect.toFixed(2)).join(" "),
				);
			expect(
				scenes.flatMap((scene, index) =>
					[
						...validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues.map(
							(issue) => issue.message,
						),
						...diagonalRuns(scene),
					].map((issue) => `${index}: ${issue}`),
				),
			).toEqual([]);
			expect(worseThanPinned("tall", counts, TALL_ROUTING[direction], false)).toEqual([]);
			expect(moreHeadsThanPinned("tall", direction, counts)).toEqual([]);
			expect(moreSharedThanPinned("tall", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("tall", direction, counts)).toEqual([]);
			const pinned = TALL_ASPECTS[direction].split(" ").map(Number);
			expect(
				aspects.flatMap((aspect, index) =>
					aspect > pinned[index]! + 0.005
						? [`${index}: ${pinned[index]} -> ${aspect.toFixed(2)}`]
						: [],
				),
			).toEqual([]);
			// Main draws 21 of the 60 past 2.45:1 each way.
			if (FULL) expect(aspects.filter((aspect) => aspect > 2.45).length).toBeLessThan(21);
		},
		60_000,
	);
});
