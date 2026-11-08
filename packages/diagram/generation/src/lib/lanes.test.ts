import { describe, expect, it } from "vitest";
import { laneFixtures } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Hiring process",
			diagram,
		}),
	});
}

describe("swimlane generation", () => {
	it("keeps a generated flowchart's lanes and each node's lane", () => {
		const { id, title, lanes, nodes, edges } = laneFixtures.hiring;
		// The model writes the flowchart document: each node names its lane.
		const parsed = candidate({
			id,
			title,
			type: "flowchart",
			lanes: Object.fromEntries((lanes ?? []).map((lane) => [lane.id, lane.label])),
			nodes: Object.fromEntries(
				nodes.map((node) => [
					node.id,
					{
						label: node.label,
						...(node.kind === "decision" && !node.label.trim().endsWith("?")
							? { shape: "diamond" }
							: {}),
						...(node.lane ? { lane: node.lane } : {}),
					},
				]),
			),
			edges: edges.map((edge) =>
				edge.label ? [edge.source, edge.target, edge.label] : [edge.source, edge.target],
			),
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		expect(diagram?.type).toBe("flowchart");
		if (diagram?.type !== "flowchart") return;
		expect(diagram.lanes?.map((lane) => lane.id)).toEqual(["candidate", "recruiter", "manager"]);
		expect(diagram.nodes.map((node) => node.lane)).toEqual(nodes.map((node) => node.lane));
	});
});
