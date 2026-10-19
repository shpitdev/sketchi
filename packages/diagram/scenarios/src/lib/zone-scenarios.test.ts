import { describe, expect, it } from "vitest";
import { zoneRegionIssues } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { getFlowchartScenario } from "./scenarios";

const ids = ["aws-three-tier-zones", "kubernetes-cluster-zones", "hybrid-cloud-zones"];

function failed(scenarioId: string, candidate: unknown) {
	return evaluateScenarioDiagram(getFlowchartScenario(scenarioId), candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

function expected(scenarioId: string) {
	return getFlowchartScenario(scenarioId).expectedDiagram;
}

describe("zone scenarios", () => {
	it.each(ids)("passes %s on its fixture, checking zones, nesting and shapes", (id) => {
		const scenario = getFlowchartScenario(id);
		const evaluation = evaluateScenarioFixture(scenario);
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		const { requiredGroups, requiredNodes } = scenario.assertions;
		expect(evaluation.checks.map((check) => check.id)).toEqual(
			expect.arrayContaining([
				...requiredGroups.flatMap((group) => [
					`group:${group.label}`,
					`group-members:${group.label}`,
					...(group.parent ? [`zone-parent:${group.label}`] : []),
					...(group.kinds ? [`zone-kind:${group.label}`] : []),
				]),
				...requiredNodes.flatMap((step) => (step.shape ? [`shape:${step.label}`] : [])),
			]),
		);
		expect(requiredGroups.some((group) => group.parent)).toBe(true);
		expect(requiredNodes.some((step) => step.shape)).toBe(true);
		// The rendered fixture draws one zone per group, nested and clear.
		expect(zoneRegionIssues(evaluation.scene, scenario.expectedDiagram)).toEqual([]);
		expect(
			evaluation.scene.elements.filter(
				(element) => element.type === "node" && element.rendererRole === "zone",
			),
		).toHaveLength(requiredGroups.length);
	});

	it("accepts the model's own zone ids, label wording and an extra zone between stated ones", () => {
		const diagram = expected("aws-three-tier-zones");
		expect(
			failed("aws-three-tier-zones", {
				...diagram,
				groups: [
					...diagram.groups!.map((group) =>
						group.id === "public" || group.id === "private" || group.id === "data"
							? {
									...group,
									id: `${group.id}-net`,
									label: `${group.label} (10.0.1.0/24)`,
									parent: "az",
								}
							: group,
					),
					// An availability zone the prompt does not state, between the VPC and its subnets.
					{ id: "az", label: "us-east-1a", kind: "zone", parent: "vpc" },
				],
				nodes: diagram.nodes.map((node) =>
					node.group && ["public", "private", "data"].includes(node.group)
						? { ...node, group: `${node.group}-net` }
						: node,
				),
			}),
		).toEqual([]);
	});

	it("fails a step drawn in the wrong zone", () => {
		const diagram = expected("aws-three-tier-zones");
		expect(
			failed("aws-three-tier-zones", {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "web" ? { ...node, group: "public" } : node,
				),
			}),
		).toEqual(["group-members:Private subnet"]);
	});

	it("fails zones drawn flat instead of nested", () => {
		const diagram = expected("aws-three-tier-zones");
		expect(
			failed("aws-three-tier-zones", {
				...diagram,
				// Every zone at the top level, the VPC dropped since it would hold nothing.
				groups: diagram
					.groups!.filter((group) => group.id !== "vpc")
					.map(({ parent: _parent, ...group }) => group),
			}),
		).toEqual([
			"group-members:us-east-1",
			"group:VPC",
			"group-members:VPC",
			"zone-parent:VPC",
			"zone-kind:VPC",
			"zone-parent:Public subnet",
			"zone-parent:Private subnet",
			"zone-parent:Database subnet",
		]);
	});

	it("fails a zone of the wrong kind and a store drawn as a plain step", () => {
		const diagram = expected("kubernetes-cluster-zones");
		expect(
			failed("kubernetes-cluster-zones", {
				...diagram,
				groups: diagram.groups!.map((group) =>
					group.id === "frontend" ? { ...group, kind: "subnet" } : group,
				),
				nodes: diagram.nodes.map(({ shape: _shape, ...node }) =>
					node.id === "db" ? node : { ...node, ...(_shape ? { shape: _shape } : {}) },
				),
			}),
		).toEqual(["zone-kind:Frontend namespace", "shape:Cloud SQL database"]);
	});

	it("accepts an invoice archive drawn as a document or a bucket, not as a database", () => {
		const diagram = expected("hybrid-cloud-zones");
		const archive = (shape: string) => ({
			...diagram,
			nodes: diagram.nodes.map((node) => (node.id === "archive" ? { ...node, shape } : node)),
		});
		expect(failed("hybrid-cloud-zones", archive("document"))).toEqual([]);
		expect(failed("hybrid-cloud-zones", archive("storage"))).toEqual([]);
		expect(failed("hybrid-cloud-zones", archive("database"))).toEqual(["shape:Invoice archive"]);
	});

	it("fails a stated outside step drawn inside a zone", () => {
		const diagram = expected("kubernetes-cluster-zones");
		expect(
			failed("kubernetes-cluster-zones", {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "queue" ? { ...node, group: "backend" } : node,
				),
			}),
		).toEqual(["ungrouped:RabbitMQ queue"]);
	});

	it("accepts the browser named as the entry component of the request it starts", () => {
		const diagram = expected("kubernetes-cluster-zones");
		const entry = (label: string) => ({
			...diagram,
			nodes: diagram.nodes.map((node) => (node.id === "browser" ? { ...node, label } : node)),
		});
		expect(failed("kubernetes-cluster-zones", entry("Browser"))).toEqual([]);
		expect(failed("kubernetes-cluster-zones", entry("Client"))).toContain(
			"node-label:Browser request",
		);
	});

	it("grounds a product's own logo named by its abbreviation, and only that", () => {
		const diagram = expected("kubernetes-cluster-zones");
		const withIcon = (slug: string, node = "ingress") =>
			evaluateScenarioDiagram(getFlowchartScenario("kubernetes-cluster-zones"), {
				...diagram,
				nodes: diagram.nodes.map((entry) =>
					entry.id === node ? { ...entry, icon: { slug } } : entry,
				),
			}).checks;
		const check = (checks: ReturnType<typeof withIcon>, id: string) =>
			checks.find((entry) => entry.id === id)?.passed;
		// "our GKE cluster" grounds Google Kubernetes Engine, though no step names it.
		const gke = withIcon("google-kubernetes-engine");
		expect(check(gke, "icons-grounded")).toBe(true);
		expect(check(gke, "icons-on-named-steps")).toBe(false);
		// The prompt names no EKS.
		expect(check(withIcon("eks"), "icons-grounded")).toBe(false);
	});

	it("fails a zone missing from the four-deep chain", () => {
		const diagram = expected("hybrid-cloud-zones");
		expect(
			failed("hybrid-cloud-zones", {
				...diagram,
				groups: diagram
					.groups!.filter((group) => group.id !== "aws")
					.map(({ parent, ...group }) =>
						group.id === "region" ? group : { ...group, ...(parent ? { parent } : {}) },
					),
			}),
		).toEqual([
			"group:AWS cloud",
			"group-members:AWS cloud",
			"zone-kind:AWS cloud",
			"zone-parent:eu-west-1",
		]);
	});
});
