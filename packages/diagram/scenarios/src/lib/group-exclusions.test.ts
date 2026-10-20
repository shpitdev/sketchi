import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram, type FlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

// Minimal specs from r20 Sonnet: eval-20261020-110826-zluk. Only graph,
// membership and shape fields are retained; no private eval or judge payloads.
const samples = JSON.parse(
	readFileSync(new URL("./fixtures/outside-cluster.json", import.meta.url), "utf8"),
) as { runId: string; spec: unknown }[];
const scenario = getFlowchartScenario("kubernetes-cluster-zones");
const diagram = scenario.expectedDiagram;
const failures = (candidate: unknown, expected = scenario) =>
	evaluateScenarioDiagram(expected, candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const exclusion = "outside-group:RabbitMQ queue:GKE cluster";

function queueIn(group: string, groups: FlowchartDiagram["groups"] = diagram.groups) {
	return {
		...diagram,
		groups,
		nodes: diagram.nodes.map((node) => (node.id === "queue" ? { ...node, group } : node)),
	};
}

describe("prompt-scoped group exclusions", () => {
	it.each(samples)("accepts the real outside-cluster wrapper $runId", ({ spec }) => {
		expect(failures(parseFlowchartDiagram(specToFlowchartCandidate(spec)))).toEqual([]);
	});

	it.each(["Outside the cluster", "External services", "Shared infrastructure"])(
		"accepts an unrelated wrapper named %s",
		(label) => {
			expect(
				failures(queueIn("external", [...diagram.groups!, { id: "external", label }])),
			).toEqual([]);
		},
	);

	it("accepts a wrapper nested under a sibling top-level zone", () => {
		expect(
			failures(
				queueIn("external", [
					...diagram.groups!,
					{ id: "shared", label: "Shared services" },
					{ id: "external", label: "Queue infrastructure", parent: "shared" },
				]),
			),
		).toEqual([]);
	});

	it("accepts the queue in an outer wrapper that also contains the cluster", () => {
		expect(
			failures(
				queueIn("shared", [
					...diagram.groups!.map((group) =>
						group.id === "cluster" ? { ...group, parent: "shared" } : group,
					),
					{ id: "shared", label: "Shared infrastructure" },
				]),
			),
		).toEqual([]);
	});

	it.each(["cluster", "backend"])("rejects the queue inside %s", (group) => {
		expect(failures(queueIn(group))).toContain(exclusion);
	});

	it("rejects an outside-named wrapper whose ancestry reaches the cluster", () => {
		expect(
			failures(
				queueIn("external", [
					...diagram.groups!,
					{ id: "middle", label: "Shared infrastructure", parent: "backend" },
					{ id: "external", label: "Outside the cluster", parent: "middle" },
				]),
			),
		).toContain(exclusion);
	});

	it("rejects the database inside the cluster too", () => {
		expect(
			failures({
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "db" ? { ...node, group: "backend" } : node,
				),
			}),
		).toContain("outside-group:Cloud SQL database:GKE cluster");
	});

	it("uses the candidate's group id rather than the fixture id", () => {
		const candidate = queueIn("backend");
		const renamed = {
			...candidate,
			groups: candidate.groups!.map((group) => ({
				...group,
				id: group.id === "cluster" ? "gke-prod" : group.id,
				parent: group.parent === "cluster" ? "gke-prod" : group.parent,
			})),
		};
		expect(failures(renamed)).toContain(exclusion);
	});

	it.each(["edge", "cluster"])("rejects the Kubernetes browser inside %s", (group) => {
		expect(
			failures({
				...diagram,
				nodes: diagram.nodes.map((node) => (node.id === "browser" ? { ...node, group } : node)),
			}),
		).toContain("outside-group:Browser request:GKE cluster");
	});

	it.each(["region", "vpc", "public", "private", "data"])(
		"rejects AWS users inside %s",
		(group) => {
			const aws = getFlowchartScenario("aws-three-tier-zones");
			expect(
				failures(
					{
						...aws.expectedDiagram,
						nodes: aws.expectedDiagram.nodes.map((node) =>
							node.id === "users" ? { ...node, group } : node,
						),
					},
					aws,
				),
			).toContain("outside-group:Users send requests:us-east-1");
		},
	);

	it.each([
		["aws-three-tier-zones", "users", "Internet"],
		["kubernetes-cluster-zones", "browser", "Clients"],
	] as const)("accepts an external %s wrapper for %s", (id, step, label) => {
		const expected = getFlowchartScenario(id);
		const candidate = expected.expectedDiagram;
		expect(
			failures(
				{
					...candidate,
					groups: [...candidate.groups!, { id: "external", label }],
					nodes: candidate.nodes.map((node) =>
						node.id === step ? { ...node, group: "external" } : node,
					),
				},
				expected,
			),
		).toEqual([]);
	});

	it("rejects an exclusion whose cluster group is missing", () => {
		const { groups, ...candidate } = diagram;
		const failed = failures({
			...candidate,
			groups: groups!
				.filter((group) => group.id !== "cluster")
				.map(({ parent, ...group }) =>
					parent === "cluster" ? group : { ...group, ...(parent ? { parent } : {}) },
				),
		});
		expect(failed).toContain("group:GKE cluster");
		expect(failed).toContain(exclusion);
	});

	it("accepts an outside-named wrapper listed before the cluster", () => {
		expect(
			failures(
				queueIn("external", [{ id: "external", label: "Outside the cluster" }, ...diagram.groups!]),
			),
		).toEqual([]);
	});

	it.each(["order", "fraud"])("keeps the mixed-fulfilment %s outside every group", (id) => {
		const mixed = getFlowchartScenario("mixed-fulfilment-groups");
		const candidate = {
			...mixed.expectedDiagram,
			groups: [...mixed.expectedDiagram.groups!, { id: "intake", label: "Order intake" }],
			nodes: mixed.expectedDiagram.nodes.map((node) =>
				node.id === id ? { ...node, group: "intake" } : node,
			),
		};
		const label = mixed.assertions.requiredNodes.find((node) => node.id === id)!.label;
		expect(failures(candidate, mixed)).toContain(`ungrouped:${label}`);
	});

	it("keeps strict ungrouped steps outside role swimlanes too", () => {
		const mixed = getFlowchartScenario("mixed-fulfilment-groups");
		const { groups, ...candidate } = mixed.expectedDiagram;
		expect(
			failures(
				{
					...candidate,
					lanes: [...groups!, { id: "intake", label: "Order intake" }],
					nodes: candidate.nodes.map(({ group, ...node }) => ({
						...node,
						lane: group ?? "intake",
					})),
				},
				mixed,
			),
		).toContain("ungrouped:Order placed");
	});
});
