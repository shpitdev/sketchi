import type { CanvasSpec } from "@sketchi/drawing";
import { parseFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/document";
import { renderFlowchartDiagram } from "@sketchi/diagrams/families/flowchart/render";
import { groupRegionIssues } from "@sketchi/drawing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import {
	randomGroupRows,
	FULL,
	diagonalRuns,
	KNOWN_UNWRAPPED_ROWS,
	routingCounts,
	worseThanPinned,
	GROUP_ROW_ROUTING,
	moreSharedThanPinned,
	moreTouchesThanPinned,
} from "./routing-fuzz-helpers";

describe("group row fuzz", () => {
	// Full proof: 24 flows through team groups x 4 directions. A row (or column)
	// of groups past the too-long rule wraps into rows (or columns) of whole
	// groups unless the wrapped plan routes worse; the lines between bands step
	// through the gap between them, never around the outer margins, and no flow
	// draws more crossings or reader findings than main.
	const rows = randomGroupRows(FULL ? 24 : 6);
	const scenes = new Map<string, CanvasSpec[]>();
	const rendered = (direction: "TB" | "BT" | "LR" | "RL") => {
		if (!scenes.has(direction))
			scenes.set(
				direction,
				rows.map((spec) =>
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
		it("wraps every row of groups past the too-long rule, each group whole and the lines between bands through the gap", () => {
			const vertical = direction === "TB" || direction === "BT";
			const [along, length, across, breadth] = vertical
				? (["y", "height", "x", "width"] as const)
				: (["x", "width", "y", "height"] as const);
			const failures = rendered(direction).flatMap((scene, index) => {
				const frames = scene.elements.flatMap((e) => (e.type === "frame" ? [e] : []));
				const nodes = new Map(
					scene.elements.flatMap((e) => (e.type === "node" ? [[e.nodeId, e] as const] : [])),
				);
				// Bands: frames that share a stretch across the flow, in order across it.
				const bands: (typeof frames)[] = [];
				for (const frame of frames.toSorted((a, b) => a[across] - b[across])) {
					const band = bands.find((members) =>
						members.some(
							(member) =>
								member[across] < frame[across] + frame[breadth] &&
								frame[across] < member[across] + member[breadth],
						),
					);
					if (band) band.push(frame);
					else bands.push([frame]);
				}
				const exported = convertSceneToExcalidraw(scene);
				const issues = [
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...diagonalRuns(scene),
					...groupRegionIssues(scene).map((issue) => issue.message),
				];
				// The renderer's too-long rule, at the size the export draws.
				const [long, short] = [scene[length], scene[breadth]].map((side) => side + 80);
				const aspect = long! / short!;
				const tooLong = aspect >= 4 || (aspect >= 2.45 && (vertical || scene[length] >= 1200));
				if (bands.length === 1 && tooLong && !KNOWN_UNWRAPPED_ROWS[direction].includes(index))
					issues.push(`one band of groups at ${aspect.toFixed(2)}:1`);
				// A line between bands stays within the frames' reach across the flow
				// and along it: through the gap, not around the drawing's margins.
				const bandOf = (frameId: string | undefined) =>
					bands.findIndex((band) => band.some((frame) => frame.id === frameId));
				const [low, high] = [
					Math.min(...frames.map((frame) => frame[along])),
					Math.max(...frames.map((frame) => frame[along] + frame[length])),
				];
				for (const arrow of scene.elements.flatMap((e) => (e.type === "arrow" ? [e] : []))) {
					const [source, target] = [arrow.sourceNodeId, arrow.targetNodeId].map((id) =>
						bandOf(nodes.get(id)?.frameId),
					);
					if (source === target || source! < 0 || target! < 0) continue;
					if (arrow.points.some((point) => point[along] < low || point[along] > high))
						issues.push(`${arrow.edgeId} runs around the bands`);
				}
				return issues.map((issue) => `${index}: ${issue}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("draws no row of groups with more crossings or reader-scale findings than main", () => {
			const counts = rendered(direction).map((scene) => routingCounts(scene));
			if (process.env.PRINT_ROUTING)
				console.log(
					"PIN rows",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			expect(worseThanPinned("rows", counts, GROUP_ROW_ROUTING[direction], false)).toEqual([]);
			expect(moreSharedThanPinned("rows", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("rows", direction, counts)).toEqual([]);
		}, 60_000);
	});
});
