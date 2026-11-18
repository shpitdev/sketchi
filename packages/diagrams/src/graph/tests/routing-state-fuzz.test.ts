import { renderGraphDiagram } from "../scene";
import { getCanvasValidationIssues, groupRegionIssues } from "@sketchi/drawing";
import { describe, expect, it } from "vitest";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { type ExportedElement } from "./text-fit-helpers";
import {
	randomStateGraphs,
	FULL,
	diagonalRuns,
	labelDefects,
	KNOWN_DETACHED_STATE_LABELS,
	detachedLabels,
	routingCounts,
	worseThanPinned,
	STATE_ROUTING,
	moreHeadsThanPinned,
	moreSharedThanPinned,
	moreTouchesThanPinned,
} from "./routing-fuzz-helpers";

describe("state graph fuzz", () => {
	// Full proof: 40 graphs x 4 directions. Self-loops, paired returns, choices and
	// transitions into and out of a composite's frame all export valid and bound,
	// with their groups whole and labels whole and clear.
	const graphs = randomStateGraphs(FULL ? 40 : 8);
	describe.each(["TB", "BT", "LR", "RL"] as const)("%s", (direction) => {
		it("exports every state graph valid, bound, grouped and labeled clear", () => {
			const failures = graphs.flatMap((graph, index) => {
				const scene = renderGraphDiagram(
					{
						nodes: graph.nodes,
						edges: graph.edges,
						...(graph.groups ? { groups: graph.groups } : {}),
						layout: { direction, edgeRouting: "orthogonal" },
					},
					graph,
					{ pairedReturns: true },
				);
				const exported = convertSceneToExcalidraw(scene);
				const byId = new Map(exported.elements.map((element) => [element.id, element]));
				const binding = (arrow: ExportedElement, key: "startBinding" | "endBinding") =>
					(arrow[key] as { elementId?: string } | null)?.elementId;
				const unbound = scene.elements.flatMap((element) => {
					if (element.type !== "arrow") return [];
					const arrow = byId.get(element.id);
					const ends = arrow ? [binding(arrow, "startBinding"), binding(arrow, "endBinding")] : [];
					const expected = [element.sourceNodeId, element.targetNodeId].map((id) =>
						id === "c" ? "group:c" : `node:${id}`,
					);
					return JSON.stringify(ends) === JSON.stringify(expected)
						? []
						: [`${element.id} binds ${JSON.stringify(ends)}`];
				});
				const authored = new Map(graph.nodes.map((node) => [`node:${node.id}`, node.label]));
				return [
					...validateExcalidrawScene(exported).issues.map((issue) => issue.message),
					...diagonalRuns(scene),
					...groupRegionIssues(scene).map((issue) => issue.message),
					...getCanvasValidationIssues(scene).map((issue) => issue.message),
					...labelDefects(exported.elements, authored),
					...unbound,
				].map((failure) => `${index}: ${failure}`);
			});
			expect(failures).toEqual([]);
		}, 60_000);

		it("sets every state graph label nearer its own line than any other", () => {
			const known = KNOWN_DETACHED_STATE_LABELS[direction].split(" ");
			const detached = graphs.flatMap((graph, index) =>
				detachedLabels(
					convertSceneToExcalidraw(
						renderGraphDiagram(
							{
								nodes: graph.nodes,
								edges: graph.edges,
								...(graph.groups ? { groups: graph.groups } : {}),
								layout: { direction, edgeRouting: "orthogonal" },
							},
							graph,
							{ pairedReturns: true },
						),
					).elements,
				).map((label) => `${index}:${label}`),
			);
			expect(detached.filter((label) => !known.includes(label))).toEqual([]);
		}, 60_000);

		it("draws no state graph with more crossings or reader-scale findings than main", () => {
			const counts = graphs.map((graph) =>
				routingCounts(
					renderGraphDiagram(
						{
							nodes: graph.nodes,
							edges: graph.edges,
							...(graph.groups ? { groups: graph.groups } : {}),
							layout: { direction, edgeRouting: "orthogonal" },
						},
						graph,
						{ pairedReturns: true },
					),
				),
			);
			// @effect-diagnostics-next-line processEnv:off -- The offline diagnostic runner reads its sample or output options from the invoking environment.
			if (process.env.PRINT_ROUTING)
				// @effect-diagnostics-next-line globalConsole:off -- The offline fuzz run prints its reproduction data directly to the invoking terminal.
				console.log(
					"PIN state",
					direction,
					counts
						.map((c) => `${c.crossings}/${c.findings}/${c.heads}/${c.shared}/${c.touches}`)
						.join(" "),
				);
			expect(worseThanPinned("state", counts, STATE_ROUTING[direction])).toEqual([]);
			expect(moreHeadsThanPinned("state", direction, counts)).toEqual([]);
			expect(moreSharedThanPinned("state", direction, counts)).toEqual([]);
			expect(moreTouchesThanPinned("state", direction, counts)).toEqual([]);
		}, 60_000);
	});
});
