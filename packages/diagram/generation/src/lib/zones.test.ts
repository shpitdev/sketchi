import { describe, expect, it } from "vitest";
import { zoneFixtures } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Hybrid on-prem and cloud",
			intent: { requestedKind: "flowchart", nativeKind: "flowchart", requirements: [] },
			diagram,
		}),
	});
}

describe("zone generation", () => {
	it("keeps a generated flowchart's nested zones, their kinds and each node's shape", () => {
		const { id, title, groups, nodes, edges } = zoneFixtures["hybrid-cloud"];
		const parsed = candidate({
			id,
			title,
			type: "flowchart",
			groups: groups!.map((group) => ({ ...group })),
			nodes: nodes.map((node) => ({
				id: node.id,
				label: node.label,
				kind: node.kind,
				...(node.group ? { group: node.group } : {}),
				...(node.shape ? { shape: node.shape } : {}),
			})),
			edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		expect(diagram?.type).toBe("flowchart");
		if (diagram?.type !== "flowchart") return;
		expect(diagram.groups?.map((group) => [group.id, group.parent, group.kind])).toEqual(
			groups!.map((group) => [group.id, group.parent, group.kind]),
		);
		expect(diagram.nodes.map((node) => node.shape)).toEqual(nodes.map((node) => node.shape));
	});
});
