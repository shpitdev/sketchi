import { describe, expect, it } from "vitest";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

const ids = ["grouped-expense-approval", "three-zone-request-path", "mixed-fulfilment-groups"];

function failed(scenarioId: string, candidate: unknown) {
	return evaluateScenarioDiagram(getFlowchartScenario(scenarioId), candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

function expected(scenarioId: string) {
	return getFlowchartScenario(scenarioId).expectedDiagram;
}

describe("group scenarios", () => {
	it.each(ids)("passes %s on its fixture, checking every stated group", (id) => {
		const evaluation = evaluateScenarioFixture(getFlowchartScenario(id));
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		expect(evaluation.checks.map((check) => check.id)).toEqual(
			expect.arrayContaining(
				getFlowchartScenario(id).assertions.requiredGroups.flatMap((group) => [
					`group:${group.label}`,
					`group-members:${group.label}`,
				]),
			),
		);
		// The rendered fixture draws one frame per group.
		expect(evaluation.scene.elements.filter((element) => element.type === "frame")).toHaveLength(
			getFlowchartScenario(id).assertions.requiredGroups.length,
		);
	});

	it("accepts the model's own group ids and label wording", () => {
		const diagram = expected("grouped-expense-approval");
		const rename = new Map([
			["employee", "staff"],
			["manager", "approver"],
			["finance", "accounts"],
		]);
		expect(
			failed("grouped-expense-approval", {
				...diagram,
				groups: diagram.groups!.map((group) => ({
					id: rename.get(group.id)!,
					label: `${group.label} team`,
				})),
				nodes: diagram.nodes.map((node) =>
					node.group ? { ...node, group: rename.get(node.group)! } : node,
				),
			}),
		).toEqual([]);
	});

	it("fails a step drawn in the wrong group", () => {
		const diagram = expected("grouped-expense-approval");
		expect(
			failed("grouped-expense-approval", {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "revise" ? { ...node, group: "manager" } : node,
				),
			}),
		).toEqual(["group-members:Employee"]);
	});

	it("fails a flowchart that draws no groups", () => {
		const { groups: _groups, ...diagram } = expected("three-zone-request-path");
		expect(
			failed("three-zone-request-path", {
				...diagram,
				nodes: diagram.nodes.map(({ group: _group, ...node }) => node),
			}),
		).toEqual([
			"group:Public internet",
			"group-members:Public internet",
			"group:DMZ",
			"group-members:DMZ",
			"group:Private subnet",
			"group-members:Private subnet",
		]);
	});

	it("fails a group whose label the prompt does not ground", () => {
		const diagram = expected("three-zone-request-path");
		expect(
			failed("three-zone-request-path", {
				...diagram,
				groups: diagram.groups!.map((group) =>
					group.id === "dmz" ? { ...group, label: "Perimeter" } : group,
				),
			}),
		).toEqual(["group:DMZ", "group-members:DMZ"]);
	});

	it("fails a step the prompt keeps outside every group drawn inside one", () => {
		const diagram = expected("mixed-fulfilment-groups");
		expect(
			failed("mixed-fulfilment-groups", {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "fraud" ? { ...node, group: "warehouse" } : node,
				),
			}),
		).toEqual(["ungrouped:Fraud check passed?"]);
	});

	it("grades the groups of a Code Mode build's normalized spec", () => {
		const diagram = expected("mixed-fulfilment-groups");
		const candidate = specToFlowchartCandidate({
			id: diagram.id,
			title: diagram.title,
			nodes: diagram.nodes.map(({ metadata: _metadata, ...node }) => node),
			edges: diagram.edges.map(({ metadata: _metadata, ...edge }) => edge),
			groups: diagram.groups,
			layout: { direction: "TB" },
		});
		expect(failed("mixed-fulfilment-groups", candidate)).toEqual([]);
	});
});
