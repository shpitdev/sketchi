import { describe, expect, it } from "vitest";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { getFlowchartScenario } from "./scenarios";

const ids = ["swimlane-order-fulfilment", "swimlane-hiring", "swimlane-incident-response"];

function failed(scenarioId: string, candidate: unknown) {
	return evaluateScenarioDiagram(getFlowchartScenario(scenarioId), candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

function expected(scenarioId: string) {
	return getFlowchartScenario(scenarioId).expectedDiagram;
}

describe("swimlane scenarios", () => {
	it.each(ids)("passes %s on its fixture, checking every lane and handoff", (id) => {
		const scenario = getFlowchartScenario(id);
		const evaluation = evaluateScenarioFixture(scenario);
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		const checkIds = evaluation.checks.map((check) => check.id);
		expect(checkIds).toEqual(
			expect.arrayContaining([
				...scenario.assertions.requiredLanes.flatMap((lane) => [
					`lane:${lane.label}`,
					`lane-members:${lane.label}`,
				]),
				"lanes-ordered",
			]),
		);
		expect(checkIds.filter((check) => check.startsWith("handoff:")).length).toBeGreaterThan(2);
		// The rendered fixture draws one band per lane.
		expect(
			evaluation.scene.elements.filter(
				(element) => element.type === "node" && element.rendererRole === "swimlane",
			),
		).toHaveLength(scenario.assertions.requiredLanes.length);
	});

	it("accepts the model's own lane ids and label wording", () => {
		const diagram = expected("swimlane-hiring");
		const rename = new Map([
			["candidate", "applicant-lane"],
			["recruiter", "talent"],
			["manager", "boss"],
		]);
		expect(
			failed("swimlane-hiring", {
				...diagram,
				lanes: diagram.lanes!.map((lane) => ({
					id: rename.get(lane.id)!,
					label: `The ${lane.label}`,
				})),
				nodes: diagram.nodes.map((node) => ({ ...node, lane: rename.get(node.lane!)! })),
			}),
		).toEqual([]);
	});

	it("fails a step drawn in the wrong lane, and every handoff of a lane it leaves unmatched", () => {
		const diagram = expected("swimlane-order-fulfilment");
		expect(
			failed("swimlane-order-fulfilment", {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "pay" ? { ...node, lane: "finance" } : node,
				),
			}),
		).toEqual([
			"lane-members:Customer",
			"lanes-ordered",
			"handoff:Place order->Review the order",
			"handoff:Send the invoice->Pay the invoice",
			"handoff:Pay the invoice->Record the payment",
		]);
	});

	it("fails lanes out of the stated order", () => {
		const diagram = expected("swimlane-incident-response");
		expect(
			failed("swimlane-incident-response", {
				...diagram,
				lanes: [...diagram.lanes!].reverse(),
			}),
		).toEqual(["lanes-ordered"]);
	});

	it("fails a flowchart without lanes and an ungrounded lane label", () => {
		const diagram = expected("swimlane-hiring");
		const { lanes: _lanes, ...unlaned } = diagram;
		const withoutLanes = failed("swimlane-hiring", {
			...unlaned,
			nodes: diagram.nodes.map(({ lane: _lane, ...node }) => node),
		});
		expect(withoutLanes).toEqual(
			expect.arrayContaining(["lane:Candidate", "lane-members:Candidate", "lanes-ordered"]),
		);
		expect(withoutLanes.filter((id) => id.startsWith("handoff:"))).toHaveLength(7);
		expect(
			failed("swimlane-hiring", {
				...diagram,
				lanes: diagram.lanes!.map((lane) =>
					lane.id === "manager" ? { ...lane, label: "Interview panel" } : lane,
				),
			}),
		).toEqual([
			"lane:Hiring manager",
			"lane-members:Hiring manager",
			"lanes-ordered",
			"handoff:Attend interview->Assess the candidate",
			"handoff:Hire?->Send offer",
			"handoff:Hire?->Schedule interview",
		]);
	});

	it("fails a handoff routed through a third lane", () => {
		const diagram = expected("swimlane-order-fulfilment");
		// Ship → Send the invoice now passes a Sales step the prompt never states.
		expect(
			failed("swimlane-order-fulfilment", {
				...diagram,
				nodes: [...diagram.nodes, { id: "relay", label: "Relay", kind: "process", lane: "sales" }],
				edges: diagram.edges.flatMap((edge) =>
					edge.id === "ship-invoice"
						? [
								{ ...edge, id: "ship-relay", target: "relay" },
								{ ...edge, id: "relay-invoice", source: "relay" },
							]
						: [edge],
				),
			}),
		).toEqual(["handoff:Ship the order->Send the invoice"]);
	});
});
