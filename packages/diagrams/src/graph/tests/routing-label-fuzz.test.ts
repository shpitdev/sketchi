import { parseFlowchartDiagram } from "../../families/flowchart/document";
import { renderFlowchartDiagram } from "../../families/flowchart/render";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw } from "@sketchi/drawing/excalidraw";
import {
	randomFlowcharts,
	FULL,
	LONG_BRANCHES,
	LONG_WORDS,
	labelDefects,
	KNOWN_LABEL_DEFECTS,
	KNOWN_DETACHED_LABELS,
	detachedLabels,
} from "./routing-fuzz-helpers";

describe("label fuzz", () => {
	// Long words and multi-line labels: words stay whole and every edge label stays
	// clear of every line, node and label, in every direction.
	const flowcharts = randomFlowcharts(FULL ? 30 : 4, 20261019, LONG_BRANCHES, LONG_WORDS);
	it.each(["TB", "BT", "LR", "RL"] as const)("keeps %s labels whole and clear", (direction) => {
		const defects = flowcharts.flatMap((spec, index) => {
			const elements = convertSceneToExcalidraw(
				renderFlowchartDiagram(
					parseFlowchartDiagram({
						...spec,
						type: "flowchart",
						layout: { direction, edgeRouting: "orthogonal" },
					}).pipe(Result.getOrThrow),
				),
			).elements;
			const authored = new Map(spec.nodes.map((node) => [`node:${node.id}`, node.label]));
			return labelDefects(elements, authored).map((defect) => `${index}: ${defect}`);
		});
		expect(defects.filter((defect) => !KNOWN_LABEL_DEFECTS[direction].includes(defect))).toEqual(
			[],
		);
	});

	// Every edge label sits nearer its own line than any other, by a clear margin.
	it.each(["TB", "BT", "LR", "RL"] as const)(
		"sets %s labels nearer their own line than any other",
		(direction) => {
			const known = KNOWN_DETACHED_LABELS[direction].split(" ");
			const detached = flowcharts.flatMap((spec, index) =>
				detachedLabels(
					convertSceneToExcalidraw(
						renderFlowchartDiagram(
							parseFlowchartDiagram({
								...spec,
								type: "flowchart",
								layout: { direction, edgeRouting: "orthogonal" },
							}).pipe(Result.getOrThrow),
						),
					).elements,
				).map((label) => `${index}:${label}`),
			);
			expect(detached.filter((label) => !known.includes(label))).toEqual([]);
		},
	);
});
