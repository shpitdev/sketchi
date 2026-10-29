import { describe, expect, it } from "vitest";
import { sankeyFixture } from "@sketchi/diagram-core";

import { candidateFromText, enforceCandidateRequestRequirements } from "./candidates.js";
import { buildDiagramGenerationMessages } from "./messages.js";

const request = {
	model: "fixture",
	prompt: {
		id: "budget",
		request: "our cloud budget as a Sankey diagram",
		requestedType: "sankey" as const,
	},
};

function candidate(diagram: unknown, requirements: readonly unknown[] = []) {
	return candidateFromText({
		model: "fixture",
		provider: "fixture",
		text: JSON.stringify({
			title: "Cloud budget",
			intent: { requestedKind: "sankey", nativeKind: "sankey", requirements },
			diagram,
		}),
	});
}

describe("Sankey generation", () => {
	it("teaches the Sankey shape when the type is requested", () => {
		const messages = buildDiagramGenerationMessages({
			id: "budget",
			request: "Draw our cloud budget as a Sankey diagram.",
			requestedType: "sankey",
		});
		expect(messages.system).toContain("Sankey IR rules");
		expect(messages.system).toContain("links: [{ source, target, value, label? }]");
		expect(messages.user).toContain('"type":"sankey"');
	});

	it("reads flows with from, to and amount, naming nodes from their labels", () => {
		const parsed = candidate({
			id: "budget",
			type: "sankey",
			unit: "$k",
			flows: [
				{ from: "Engineering", to: "Compute", amount: 310 },
				{ from: "Engineering", to: "Storage", amount: 45 },
			],
		});
		expect(parsed.error).toBeUndefined();
		const diagram = parsed.diagram;
		if (diagram?.type !== "sankey") throw new Error("Expected a Sankey diagram.");
		expect(diagram.nodes.map((node) => node.id)).toEqual(["engineering", "compute", "storage"]);
		expect(diagram.links[0]).toEqual({ source: "engineering", target: "compute", value: 310 });
	});

	it("reports a cycle with its repair hint", () => {
		const parsed = candidate({
			...sankeyFixture,
			links: [...sankeyFixture.links, { source: "compute", target: "engineering", value: 5 }],
		});
		expect(parsed.diagram).toBeUndefined();
		expect(parsed.diagnostics.join(" ")).toContain("sankey.sankey_cycle");
		expect(parsed.diagnostics.join(" ")).toContain("Hint:");
	});

	it("checks node and link counts and node labels", () => {
		const met = enforceCandidateRequestRequirements(
			candidate(sankeyFixture, [
				{ kind: "count", target: "links", comparator: "exact", value: 9 },
				{ kind: "count", target: "nodes", comparator: "exact", value: 7 },
				{ kind: "label", target: "node", value: "Compute" },
			]),
			request,
		);
		expect(met.error).toBeUndefined();
		const unmet = enforceCandidateRequestRequirements(
			candidate(sankeyFixture, [
				{ kind: "count", target: "links", comparator: "exact", value: 10 },
				{ kind: "label", target: "node", value: "GPU clusters" },
			]),
			request,
		);
		expect(unmet.diagnostics.join(" ")).toContain("requirement_count_not_met");
		expect(unmet.diagnostics.join(" ")).toContain('"GPU clusters"');
	});
});
