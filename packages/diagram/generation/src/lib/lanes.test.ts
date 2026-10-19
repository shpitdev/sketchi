import { describe, expect, it } from "vitest";
import { laneFixtures } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Hiring process",
			intent: { requestedKind: "flowchart", nativeKind: "flowchart", requirements: [] },
			diagram,
		}),
	});
}

describe("swimlane generation", () => {
	it("keeps a generated flowchart's lanes and each node's lane", () => {
		const { id, title, lanes, nodes, edges } = laneFixtures.hiring;
		const parsed = candidate({
			id,
			title,
			type: "flowchart",
			lanes: lanes!.map((lane) => ({ id: lane.id, label: lane.label })),
			nodes: nodes.map((node) => ({
				id: node.id,
				label: node.label,
				kind: node.kind,
				lane: node.lane,
			})),
			edges: edges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				...(edge.label ? { label: edge.label } : {}),
			})),
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		expect(diagram?.type).toBe("flowchart");
		if (diagram?.type !== "flowchart") return;
		expect(diagram.lanes?.map((lane) => lane.id)).toEqual(["candidate", "recruiter", "manager"]);
		expect(diagram.nodes.map((node) => node.lane)).toEqual(nodes.map((node) => node.lane));
	});
});
