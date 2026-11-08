import { describe, expect, it } from "vitest";
import { zoneFixtures } from "@sketchi/diagram-core";

import { candidateFromText } from "./candidates.js";

function candidate(diagram: unknown) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Hybrid on-prem and cloud",
			diagram,
		}),
	});
}

describe("zone generation", () => {
	it("keeps a generated flowchart's nested zones, their kinds and each node's shape", () => {
		const { id, title, groups, nodes, edges } = zoneFixtures["hybrid-cloud"];
		// The model writes the flowchart document: each zone lists its nodes and zones.
		const parsed = candidate({
			id,
			title,
			type: "flowchart",
			groups: Object.fromEntries(
				(groups ?? []).map((group) => [
					group.id,
					{
						label: group.label,
						...(group.kind ? { kind: group.kind } : {}),
						contains: [
							...nodes.filter((node) => node.group === group.id).map((node) => node.id),
							...(groups ?? [])
								.filter((inner) => inner.parent === group.id)
								.map((inner) => inner.id),
						],
					},
				]),
			),
			nodes: Object.fromEntries(
				nodes.map((node) => [
					node.id,
					node.shape ? { label: node.label, shape: node.shape } : node.label,
				]),
			),
			edges: edges.map((edge) => [edge.source, edge.target]),
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

	it("draws no logo a model puts on a group, well-formed or not", () => {
		const parsed = candidate({
			id: "edge",
			title: "Edge",
			type: "flowchart",
			groups: {
				vercel: { label: "Vercel", icon: { slug: "vercel" }, contains: ["page"] },
				cloud: { label: "Cloud", icon: "not an icon", contains: ["api"] },
			},
			nodes: { page: "Page", api: "API" },
			edges: [["page", "api"]],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "flowchart") throw new Error("Expected a flowchart.");
		expect(diagram.groups?.map((group) => group.icon)).toEqual([undefined, undefined]);
	});
});
