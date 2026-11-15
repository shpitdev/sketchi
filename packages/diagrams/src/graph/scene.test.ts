import { describe, expect, it } from "vitest";
import { getCanvasValidationIssues, SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import { renderGraphDiagram } from "./scene.js";

describe("geometry bounds regressions", () => {
	it("ranks a reverse-declared chain in topological order", () => {
		const scene = renderGraphDiagram(
			{
				nodes: ["Z", "Y", "X", "A"].map((id) => ({ id, label: id, shape: "rectangle" })),
				edges: [
					{ id: "ax", source: "A", target: "X" },
					{ id: "xy", source: "X", target: "Y" },
					{ id: "yz", source: "Y", target: "Z" },
				],
				layout: { direction: "TB", edgeRouting: "orthogonal" },
			},
			{ id: "geometry", title: "Geometry", style: SKETCHI_DIAGRAM_STYLE },
		);
		const ys = ["A", "X", "Y", "Z"].map((id) => {
			const node = scene.elements.find(
				(element) => element.type === "node" && element.nodeId === id,
			);
			if (!node || node.type !== "node") throw new Error(`Missing node ${id}`);
			return node.y;
		});
		// Four 72-unit steps in one column read 2.75:1 at the full 96-unit rank gap;
		// lines that only run straight down draw their gaps at 56.
		expect(ys).toEqual([48, 176, 304, 432]);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});

	it("does not inflate single-node bounds with its centered label", () => {
		const scene = renderGraphDiagram(
			{
				nodes: [{ id: "A", label: "A", shape: "rectangle" }],
				edges: [],
				layout: { direction: "LR", edgeRouting: "orthogonal" },
			},
			{ id: "geometry", title: "Geometry", style: SKETCHI_DIAGRAM_STYLE },
		);
		expect(scene).toMatchObject({ width: 280, height: 168 });
		expect(getCanvasValidationIssues(scene)).toEqual([]);
	});
});

it("keeps a short column at the full rank gap", () => {
	const scene = renderGraphDiagram(
		{
			nodes: ["A", "B", "C"].map((id) => ({ id, label: id, shape: "rectangle" })),
			edges: [
				{ id: "ab", source: "A", target: "B" },
				{ id: "bc", source: "B", target: "C" },
			],
			layout: { direction: "TB", edgeRouting: "orthogonal" },
		},
		{ id: "geometry", title: "Geometry", style: SKETCHI_DIAGRAM_STYLE },
	);
	const ys = scene.elements.flatMap((element) => (element.type === "node" ? [element.y] : []));
	expect(ys).toEqual([48, 216, 384]);
});
