import { describe, expect, it } from "vitest";
import { parseFlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";
import retainedReplays from "./fixtures/group-members-replays.json";

const replays = retainedReplays.map(({ id, spec }) => ({
	id,
	spec: parseFlowchartDiagram(specToFlowchartCandidate(spec)),
}));

const ids = [
	"grouped-expense-approval",
	"three-zone-request-path",
	"mixed-fulfilment-groups",
].flatMap((id) => [id, `${id}-v2`]);

function failed(scenarioId: string, candidate: unknown) {
	return evaluateScenarioDiagram(getFlowchartScenario(scenarioId), candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

function expected(scenarioId: string) {
	return getFlowchartScenario(scenarioId).expectedDiagram;
}

describe("group scenarios", () => {
	// Exact normalized specs from the Sonnet-fidelity replays and Frontierclimb
	// eval-20261019-202040-pyx1; the ids retain their archive provenance.
	it.each(replays)("accepts stated membership in retained replay $id", ({ spec }) => {
		expect(failed("grouped-expense-approval", specToFlowchartCandidate(spec))).toEqual([]);
	});

	it.each(replays)("rejects a misplaced stated review in replay $id", ({ spec }) => {
		const review = spec.nodes.find((node) => node.id === "review")!;
		const employee = spec.nodes.find((node) => node.kind === "start")!;
		const candidate = specToFlowchartCandidate({
			...spec,
			nodes: spec.nodes.map((node) =>
				node === review ? { ...node, group: employee.group, lane: employee.lane } : node,
			),
		});
		expect(failed("grouped-expense-approval", candidate)).toContain("group-members:Manager");
	});

	it.each(["employee", "manager", undefined])(
		"ignores an unstated resubmit helper in group %s, but cannot use it as the review",
		(group) => {
			const diagram = expected("grouped-expense-approval");
			const candidate = {
				...diagram,
				nodes: [
					...diagram.nodes,
					{ id: "resubmit", label: "Resubmit report for review", kind: "process", group },
				],
				edges: [
					...diagram.edges.map((edge) =>
						edge.id === "revise-review" ? { ...edge, target: "resubmit" } : edge,
					),
					{ id: "resubmit-review", source: "resubmit", target: "review" },
				],
			};
			expect(failed("grouped-expense-approval", candidate)).toEqual([]);
			expect(
				failed("grouped-expense-approval", {
					...candidate,
					nodes: candidate.nodes.filter((node) => node.id !== "review"),
					edges: candidate.edges
						.filter((edge) => edge.source !== "review")
						.map((edge) => (edge.target === "review" ? { ...edge, target: "approved" } : edge)),
				}),
			).toContain("group-members:Manager");
		},
	);

	it.each(["three-zone-request-path", "aws-three-tier-zones"])(
		"does not substitute lanes for the explicit zones in %s",
		(id) => {
			const { groups, ...diagram } = expected(id);
			expect(
				failed(id, {
					...diagram,
					lanes: groups!.map(({ id, label }) => ({ id, label })),
					nodes: diagram.nodes.map(({ group: _group, ...node }, index) => ({
						...node,
						lane: groups![index % groups!.length]!.id,
					})),
				}),
			).toContain(`group:${getFlowchartScenario(id).assertions.requiredGroups[0]!.label}`);
		},
	);

	it("requires a resubmit helper's own membership when the prompt states it", () => {
		const base = getFlowchartScenario("grouped-expense-approval");
		const scenario = {
			...base,
			prompt: `${base.prompt} Draw a separate Resubmit report for review step in Employee.`,
			assertions: {
				...base.assertions,
				requiredEdges: [
					...base.assertions.requiredEdges.map((edge) =>
						edge.sourceId === "revise" && edge.targetId === "review"
							? { ...edge, targetId: "resubmit", targetLabel: "Resubmit report for review" }
							: edge,
					),
					{
						sourceId: "resubmit",
						sourceLabel: "Resubmit report for review",
						targetId: "review",
						targetLabel: "Review the report",
					},
				],
				requiredNodes: [
					...base.assertions.requiredNodes,
					{
						id: "resubmit",
						label: "Resubmit report for review",
						labels: ["resubmit report for review"],
						kind: "process" as const,
					},
				],
				requiredGroups: base.assertions.requiredGroups.map((group) =>
					group.id === "employee" ? { ...group, members: [...group.members, "resubmit"] } : group,
				),
			},
		};
		for (const group of ["employee", "manager"]) {
			const candidate = {
				...base.expectedDiagram,
				nodes: [
					...base.expectedDiagram.nodes,
					{ id: "resubmit", label: "Resubmit report for review", kind: "process", group },
				],
				edges: [
					...base.expectedDiagram.edges.map((edge) =>
						edge.id === "revise-review" ? { ...edge, target: "resubmit" } : edge,
					),
					{ id: "resubmit-review", source: "resubmit", target: "review" },
				],
			};
			const failures = evaluateScenarioDiagram(scenario, candidate)
				.checks.filter((check) => !check.passed)
				.map((check) => check.id);
			expect(failures).toEqual(group === "employee" ? [] : ["group-members:Employee"]);
		}
	});

	it("rejects a second stated review in the wrong group even with a correct review witness", () => {
		const diagram = expected("grouped-expense-approval");
		expect(
			failed("grouped-expense-approval", {
				...diagram,
				nodes: [
					...diagram.nodes,
					{ id: "other-review", label: "Review the report", kind: "process", group: "employee" },
				],
				edges: [
					...diagram.edges,
					{ id: "review-again", source: "revise", target: "other-review" },
					{ id: "other-approved", source: "other-review", target: "approved" },
				],
			}),
		).toContain("group-members:Manager");
	});
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

	it("keeps explicitly ungrouped fulfilment steps outside role lanes too", () => {
		const { groups, ...diagram } = expected("mixed-fulfilment-groups");
		expect(
			failed("mixed-fulfilment-groups", {
				...diagram,
				lanes: [
					...groups!.map(({ id, label }) => ({ id, label })),
					{ id: "intake", label: "Intake" },
				],
				nodes: diagram.nodes.map(({ group, ...node }) => ({ ...node, lane: group ?? "intake" })),
			}),
		).toEqual(["ungrouped:Order placed", "ungrouped:Fraud check passed?"]);
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
