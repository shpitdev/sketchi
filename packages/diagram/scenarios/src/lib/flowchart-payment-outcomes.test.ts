import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { matchFlowchartSteps } from "./flowchart-matching";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

const samples = JSON.parse(
	readFileSync(new URL("./fixtures/payment-terminals.json", import.meta.url), "utf8"),
) as { runId: string; spec: Record<string, unknown> }[];
const scenario = getFlowchartScenario("invoice-approval");
const diagram = parseFlowchartDiagram(specToFlowchartCandidate(samples[0]!.spec));
const failures = (candidate = diagram, expected = scenario) =>
	evaluateScenarioDiagram(expected, candidate)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const directorPayment = "edge:Director approval->Schedule payment";
const thresholdPayment = "edge:Amount over threshold?->Schedule payment:no";
const labelPayment = (label: string) => ({
	...diagram,
	nodes: diagram.nodes.map((node) => (node.id === "pay" ? { ...node, label } : node)),
});

describe("explicit equivalent named payment outcomes", () => {
	it.each(samples)("accepts the real separate payment terminal $runId", ({ spec }) => {
		expect(failures(parseFlowchartDiagram(specToFlowchartCandidate(spec)))).toEqual([]);
	});

	it.each(["Pay invoice", "Invoice paid", "Payment", "Make payment"])("accepts %s", (label) => {
		expect(failures(labelPayment(label))).toEqual([]);
	});

	it("accepts a payment action that reaches an end", () => {
		const candidate = {
			...diagram,
			nodes: [
				...diagram.nodes.map((node) =>
					node.id === "pay" ? { ...node, kind: "process" as const } : node,
				),
				{ ...diagram.nodes.find((node) => node.id === "pay")!, id: "done", label: "Done" },
			],
			edges: [...diagram.edges, { id: "pay-done", source: "pay", target: "done", metadata: {} }],
		};
		expect(failures(candidate)).toEqual([]);
	});

	it.each(["Reject invoice", "Archive invoice", "Do not pay", "Skip payment", "Payment failed"])(
		"rejects director approval leading to %s",
		(label) => expect(failures(labelPayment(label))).toContain(directorPayment),
	);

	it("rejects director approval going nowhere", () => {
		expect(() =>
			failures({
				...diagram,
				nodes: diagram.nodes.filter((node) => node.id !== "pay"),
				edges: diagram.edges.filter((edge) => edge.source !== "dir"),
			}),
		).toThrow('Node "dir" must have at least one outgoing edge.');
		const candidate = {
			...diagram,
			edges: diagram.edges.filter((edge) => edge.source !== "dir"),
		};
		expect(
			matchFlowchartSteps(scenario, candidate).matchedNodes.get("schedule-payment"),
		).not.toContain("pay");
	});

	it("rejects a payment action without an end", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === "pay" ? { ...node, kind: "process" as const } : node,
			),
		};
		expect(
			matchFlowchartSteps(scenario, candidate).matchedNodes.get("schedule-payment"),
		).not.toContain("pay");
	});

	it("requires the payment node directly after director approval", () => {
		const candidate = {
			...diagram,
			nodes: [
				...diagram.nodes,
				{ ...diagram.nodes.find((node) => node.id === "dir")!, id: "archive", label: "Archive" },
			],
			edges: [
				...diagram.edges.map((edge) =>
					edge.source === "dir" ? { ...edge, target: "archive" } : edge,
				),
				{ id: "archive-pay", source: "archive", target: "pay", metadata: {} },
			],
		};
		expect(failures(candidate)).toContain(directorPayment);
	});

	it("rejects a missing director approval on the over-threshold path", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.filter((node) => node.id !== "dir"),
			edges: diagram.edges
				.filter((edge) => edge.source !== "dir")
				.map((edge) => (edge.target === "dir" ? { ...edge, target: "pay" } : edge)),
		};
		expect(failures(candidate)).toContain("node-label:Director approval");
	});

	it("rejects under-threshold routed through director approval", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.filter((node) => node.id !== "sch"),
			edges: diagram.edges.map((edge) =>
				edge.source === "thr" && edge.label === "no" ? { ...edge, target: "dir" } : edge,
			),
		};
		expect(failures(candidate)).toContain(thresholdPayment);
	});

	it("requires payment on the under-threshold path too", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === "sch" ? { ...node, label: "Archive invoice" } : node,
			),
		};
		expect(failures(candidate)).toContain(thresholdPayment);
	});

	it("does not enable equivalent outcomes without the explicit opt-in", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				requiredNodes: scenario.assertions.requiredNodes.map((node) => ({
					id: node.id,
					kind: node.kind,
					label: node.label,
					labels: node.labels,
				})),
			},
		};
		expect(failures(diagram, expected)).toContain(directorPayment);
	});

	it("does not let a second equivalent payment pad the minimum node count", () => {
		expect(
			failures(diagram, {
				...scenario,
				assertions: { ...scenario.assertions, minNodeCount: diagram.nodes.length },
			}),
		).toContain("min-node-count");
	});

	it("retains lane and group ownership on both drawn outcomes", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.map((node) => ({ ...node, lane: "finance", group: "approval" })),
		};
		const { graph, matchedNodes } = matchFlowchartSteps(scenario, candidate);
		expect([...matchedNodes.get("schedule-payment")!].sort()).toEqual(["pay", "sch"]);
		for (const id of ["pay", "sch"]) {
			expect(graph.nodes.find((node) => node.id === id)).toMatchObject({
				lane: "finance",
				group: "approval",
			});
		}
	});

	it.each([
		"Reject payment",
		"Payment rejected",
		"Decline payment",
		"Payment declined",
		"Payment denied",
		"Hold payment",
		"Payment on hold",
		"Cancel payment",
		"Stop payment",
		"Withhold payment",
		"Delay payment",
		"Payment pending",
		"Payment request returned",
		"Payment approval",
		"Prepare for payment",
	])("does not treat %s as a positive payment outcome", (label) => {
		expect(failures(labelPayment(label))).toContain(directorPayment);
	});

	it.each([
		"Process payment",
		"Issue payment",
		"Release payment",
		"Send payment",
		"Payment processed",
		"Payment issued",
		"Payment released after approval",
		"Payment sent",
		"Payment scheduled",
	])("accepts the positive payment outcome %s", (label) => {
		expect(failures(labelPayment(label))).toEqual([]);
	});

	it("does not treat payment leading directly to rejection as the payment outcome", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === "pay" ? { ...node, kind: "process" as const } : node,
			),
			edges: [...diagram.edges, { id: "pay-reject", source: "pay", target: "rej", metadata: {} }],
		};
		expect(failures(candidate)).toContain(directorPayment);
	});

	it("does not skip intervening work to find a terminal end", () => {
		const candidate = {
			...diagram,
			nodes: [
				...diagram.nodes.map((node) =>
					node.id === "pay" ? { ...node, kind: "process" as const } : node,
				),
				{ ...diagram.nodes.find((node) => node.id === "dir")!, id: "archive", label: "Archive" },
				{ ...diagram.nodes.find((node) => node.id === "pay")!, id: "done", label: "Done" },
			],
			edges: [
				...diagram.edges,
				{ id: "pay-archive", source: "pay", target: "archive", metadata: {} },
				{ id: "archive-done", source: "archive", target: "done", metadata: {} },
			],
		};
		expect(failures(candidate)).toContain(directorPayment);
	});

	it("does not accept a payment action that branches before its end", () => {
		const candidate = {
			...diagram,
			nodes: [
				...diagram.nodes.map((node) =>
					node.id === "pay" ? { ...node, kind: "process" as const } : node,
				),
				{ ...diagram.nodes.find((node) => node.id === "pay")!, id: "done", label: "Done" },
			],
			edges: [
				...diagram.edges,
				{ id: "pay-reject", source: "pay", target: "rej", metadata: {} },
				{ id: "pay-done", source: "pay", target: "done", metadata: {} },
			],
		};
		expect(failures(candidate)).toContain(directorPayment);
	});

	it("does not let an under-threshold payment approval hide the director detour", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.map((node) =>
				node.id === "sch" ? { ...node, label: "Payment approval", kind: "process" as const } : node,
			),
			edges: [
				...diagram.edges,
				{ id: "approval-director", source: "sch", target: "dir", metadata: {} },
			],
		};
		expect(failures(candidate)).toContain(thresholdPayment);
	});

	it.each(["Reject payment", "Payment", "Make payment"])(
		"does not broaden under-threshold matching to %s",
		(label) => {
			const candidate = {
				...diagram,
				nodes: diagram.nodes.map((node) =>
					node.id === "sch"
						? { ...node, label }
						: node.id === "pay"
							? { ...node, label: "Schedule payment" }
							: node,
				),
			};
			expect(failures(candidate)).toContain(thresholdPayment);
		},
	);

	it("preserves minimum-count credit for existing canonical matches", () => {
		const candidate = labelPayment("Schedule payment");
		expect(
			failures(candidate, {
				...scenario,
				assertions: { ...scenario.assertions, minNodeCount: candidate.nodes.length },
			}),
		).toEqual([]);
	});

	it("does not extend the director-only alias to a shared under-threshold target", () => {
		const candidate = {
			...diagram,
			nodes: diagram.nodes.filter((node) => node.id !== "sch"),
			edges: diagram.edges.map((edge) =>
				edge.source === "thr" && edge.label === "no" ? { ...edge, target: "pay" } : edge,
			),
		};
		expect(failures(candidate)).toContain(thresholdPayment);
	});
});
