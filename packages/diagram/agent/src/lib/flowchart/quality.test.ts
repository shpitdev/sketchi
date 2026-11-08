import { describe, expect, it } from "@effect/vitest";

import {
	FLOWCHART_MAX_NODES,
	type FlowchartDiagram,
	parseFlowchartDiagram,
} from "@sketchi/diagram-core";

import { assessFlowchartQuality } from "./quality";

function decisionLoopFlowchart() {
	return parseFlowchartDiagram({
		id: "review-loop",
		title: "Release review loop",
		type: "flowchart",
		nodes: [
			{ id: "start", kind: "start", label: "Open release" },
			{ id: "review", kind: "decision", label: "Release ready?" },
			{ id: "publish", kind: "process", label: "Publish release" },
			{ id: "revise", kind: "process", label: "Revise release" },
			{ id: "done", kind: "end", label: "Release live" },
		],
		edges: [
			{ id: "open-review", source: "start", target: "review" },
			{
				id: "review-publish",
				label: "yes",
				source: "review",
				target: "publish",
			},
			{
				id: "review-revise",
				label: "no",
				source: "review",
				target: "revise",
			},
			{ id: "revise-review", source: "revise", target: "review" },
			{ id: "publish-done", source: "publish", target: "done" },
		],
		layout: { direction: "TB", edgeRouting: "orthogonal" },
		style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
	});
}

function linearFlowchart(nodeCount = 3): FlowchartDiagram {
	return {
		...decisionLoopFlowchart(),
		nodes: Array.from({ length: nodeCount }, (_, index): FlowchartDiagram["nodes"][number] => ({
			id: `node-${index}`,
			kind: index === 0 ? "start" : index === nodeCount - 1 ? "end" : "process",
			label: `Handle refund phase ${index}`,
			metadata: {},
		})),
		edges: Array.from({ length: nodeCount - 1 }, (_, index) => ({
			id: `edge-${index}`,
			source: `node-${index}`,
			target: `node-${index + 1}`,
			metadata: {},
		})),
	};
}

describe("assessFlowchartQuality", () => {
	it("accepts a specific canonical decision flow with a terminating loop", () => {
		const quality = assessFlowchartQuality(decisionLoopFlowchart(), 8);

		expect(quality).toMatchObject({
			accepted: true,
			score: 10,
			summary: { edgeCount: 5, nodeCount: 5 },
			threshold: 8,
		});
		expect(quality.checks).toEqual([]);
	});

	it("returns deterministic canonical checks for weak labels", () => {
		const diagram = decisionLoopFlowchart();
		const publish = diagram.nodes[2];
		if (!publish) {
			throw new Error("Expected the release flow to contain a publish node.");
		}
		diagram.nodes[2] = { ...publish, label: "Step 2" };

		const first = assessFlowchartQuality(diagram, 8);
		const second = assessFlowchartQuality(diagram, 8);

		expect(second).toEqual(first);
		expect(first.accepted).toBe(true);
		expect(first.checks).toEqual([
			expect.objectContaining({
				code: "generic_label",
				message: expect.stringContaining("Step 2"),
				severity: "warning",
				refs: [{ kind: "node", id: "publish" }],
			}),
		]);
	});

	it.each([
		{ id: "node-2", label: "Refund issued?" },
		{ id: "node-1", label: "Check stock?" },
	])("warns without rejecting a non-decision question: $label", ({ id, label }) => {
		const base = linearFlowchart();
		const diagram = {
			...base,
			nodes: base.nodes.map((node) => (node.id === id ? { ...node, label } : node)),
		};

		const quality = assessFlowchartQuality(parseFlowchartDiagram(diagram), 10);

		expect(quality.accepted).toBe(true);
		expect(quality.score).toBe(10);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "question_label_not_decision",
				severity: "warning",
				passed: false,
				refs: [{ kind: "node", id }],
			}),
		]);
	});

	it("accepts a question with one stated way on, without asking for an invented branch", () => {
		const base = linearFlowchart();
		const diagram: FlowchartDiagram = {
			...base,
			nodes: base.nodes.map((node): FlowchartDiagram["nodes"][number] =>
				node.id === "node-1" ? { ...node, kind: "decision", label: "Verify deployment?" } : node,
			),
		};

		const quality = assessFlowchartQuality(diagram, 8);

		expect(quality.accepted).toBe(true);
		expect(quality.score).toBe(10);
		expect(quality.checks).toEqual([]);
	});

	it("identifies decisions with unlabeled branches", () => {
		const base = decisionLoopFlowchart();
		const diagram = {
			...base,
			edges: base.edges.map((edge) =>
				edge.id === "review-publish" ? { ...edge, label: undefined } : edge,
			),
		};

		const quality = assessFlowchartQuality(diagram, 8);

		expect(quality.score).toBe(9);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "unlabeled_decision_branch",
				severity: "warning",
				refs: [{ kind: "node", id: "review" }],
			}),
		]);
	});

	it("reports every node with a duplicate normalized label without rejecting the repeat", () => {
		const base = linearFlowchart(4);
		const diagram = {
			...base,
			nodes: base.nodes.map((node, index) => ({
				...node,
				label: index === 1 ? " Approve refund " : index === 2 ? "approve REFUND" : node.label,
			})),
		};

		// A request may name the same step on two branches, as a large order-to-cash flow does.
		const quality = assessFlowchartQuality(diagram, 10);

		expect(quality.score).toBe(10);
		expect(quality.accepted).toBe(true);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "duplicate_label",
				refs: [
					{ kind: "node", id: "node-1" },
					{ kind: "node", id: "node-2" },
				],
			}),
		]);
	});

	it("uses graph_too_sparse for graph scope", () => {
		const diagram = linearFlowchart(2);
		const quality = assessFlowchartQuality(diagram, 8);

		expect(quality.score).toBe(8);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "graph_too_sparse",
				refs: [{ kind: "diagram", id: diagram.id, path: "spec.nodes" }],
			}),
		]);
	});

	it("scores a flowchart at its family limit without a size penalty", () => {
		const quality = assessFlowchartQuality(linearFlowchart(FLOWCHART_MAX_NODES), 8);

		expect(quality.score).toBe(10);
		expect(quality.checks).toEqual([]);
	});

	it("identifies a weak title separately from label problems", () => {
		const diagram = { ...linearFlowchart(), title: "Flowchart" };
		const quality = assessFlowchartQuality(diagram, 8);

		expect(quality.score).toBe(9.5);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "weak_title",
				refs: [{ kind: "diagram", id: diagram.id, path: "spec.title" }],
			}),
		]);
	});

	it("identifies the nodes with overly long labels", () => {
		const base = linearFlowchart();
		const diagram = {
			...base,
			nodes: base.nodes.map((node) =>
				node.id === "node-1"
					? {
							...node,
							label: "Review every detail of the refund application before approval",
						}
					: node,
			),
		};
		const quality = assessFlowchartQuality(diagram, 8);

		expect(quality.score).toBe(9.5);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "label_too_long",
				refs: [{ kind: "node", id: "node-1" }],
			}),
		]);
	});

	it.each([
		{ edgeIds: [], refs: ["node-0", "node-1", "node-2", "node-3"], score: 5 },
		{ edgeIds: ["edge-0", "edge-1"], refs: ["node-3"], score: 8.5 },
		{
			edgeIds: ["edge-0", "edge-2"],
			refs: ["node-0", "node-1", "node-2", "node-3"],
			score: 8,
		},
	])("identifies disconnected nodes with edges $edgeIds", ({ edgeIds, refs, score }) => {
		const base = linearFlowchart(4);
		const diagram = {
			...base,
			edges: base.edges.filter((edge) => edgeIds.includes(edge.id)),
		};
		const quality = assessFlowchartQuality(diagram, 0);

		expect(quality.accepted).toBe(false);
		expect(quality.score).toBe(score);
		expect(quality.checks).toEqual([
			expect.objectContaining({
				code: "disconnected_graph",
				severity: "error",
				refs: refs.map((id) => ({ kind: "node", id })),
			}),
		]);
	});
});
