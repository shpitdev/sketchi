import { describe, expect, it } from "vitest";
import { SKETCHI_DIAGRAM_STYLE, getCanvasValidationIssues } from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { renderGraphDiagram } from "./scene.js";

// The straight LR round 32 counterexample, reduced to its failing decision departure.
// Its steep line leaves the side vertex; native binding must still meet the diamond.
describe("straight decision departures", () => {
	it.each(["LR", "RL"] as const)(
		"exports a steep %s departure on its decision's outline",
		(direction) => {
			const right = direction === "LR";
			const scene = renderGraphDiagram(
				{
					nodes: [
						{ id: "decide", label: "Retry?", kind: "decision", shape: "diamond" },
						{ id: "next", label: "Next step", kind: "process", shape: "rectangle" },
					],
					edges: [{ id: "retry", source: "decide", target: "next" }],
					layout: { direction, edgeRouting: "straight" },
				},
				{ id: "straight-decision", title: "Straight decision", style: SKETCHI_DIAGRAM_STYLE },
				{
					placement: new Map([
						["decide", { x: 608, y: 331, width: 184, height: 86 }],
						["next", { x: right ? 955 : 252, y: 464, width: 193, height: 72 }],
					]),
				},
			);
			expect(getCanvasValidationIssues(scene)).toEqual([]);
			expect(validateExcalidrawScene(convertSceneToExcalidraw(scene)).issues).toEqual([]);
		},
	);
});
