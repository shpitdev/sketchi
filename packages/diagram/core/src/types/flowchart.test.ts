import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DiagramValidationError } from "../intermediate";
import {
	FLOWCHART_MAX_EDGES,
	FLOWCHART_MAX_GROUPS,
	FLOWCHART_MAX_LANES,
	FLOWCHART_MAX_ISSUES,
	FLOWCHART_MAX_NODES,
	FlowchartDiagramSchema,
	FlowchartValidationError,
	flowchartDiagramType,
	flowchartEvaluationFixtures,
	flowchartFixture,
	getFlowchartValidationIssues,
	parseFlowchartDiagram,
	pharmaBatchDispositionFlowchart,
} from "./flowchart";

function validationIssues(input: unknown) {
	return getFlowchartValidationIssues(
		Schema.decodeUnknownSync(FlowchartDiagramSchema, { errors: "all" })(input),
	);
}

function linearFlowchart(nodeCount: number) {
	const nodes = Array.from({ length: nodeCount }, (_, index) => ({
		id: `node-${index}`,
		label: `Concrete operation ${index}`,
		kind: index === 0 ? "start" : index === nodeCount - 1 ? "end" : "process",
	}));
	return {
		...flowchartFixture,
		id: `linear-${nodeCount}`,
		nodes,
		edges: nodes.slice(0, -1).map((node, index) => ({
			id: `edge-${index}`,
			source: node.id,
			target: nodes[index + 1]?.id,
		})),
	};
}

function denseAcyclicFlowchart(edgeCount: number) {
	const diagram = linearFlowchart(FLOWCHART_MAX_NODES);
	const chainKeys = new Set(diagram.edges.map((edge) => `${edge.source}->${edge.target}`));
	const extraEdges = diagram.nodes.flatMap((source, sourceIndex) =>
		diagram.nodes.slice(sourceIndex + 1).flatMap((target, targetOffset) => {
			const targetIndex = sourceIndex + targetOffset + 1;
			const key = `${source.id}->${target.id}`;
			return chainKeys.has(key)
				? []
				: [
						{
							id: `extra-${sourceIndex}-${targetIndex}`,
							source: source.id,
							target: target.id,
						},
					];
		}),
	);
	return {
		...diagram,
		edges: [...diagram.edges, ...extraEdges].slice(0, edgeCount),
	};
}

describe("parseFlowchartDiagram", () => {
	it("has a typed fixture that satisfies the flowchart contract", () => {
		expect(flowchartFixture.type).toBe(flowchartDiagramType);
		expect(parseFlowchartDiagram(flowchartFixture)).toEqual(flowchartFixture);
	});

	it("keeps canonical flowchart eval fixtures valid", () => {
		expect(flowchartEvaluationFixtures).toContain(pharmaBatchDispositionFlowchart);
		expect(flowchartEvaluationFixtures.map((fixture) => fixture.id)).toEqual([
			"onboarding-flow",
			"pharma-batch-disposition",
		]);
	});

	it("rejects decision branches without labels", () => {
		expect(() =>
			parseFlowchartDiagram({
				...flowchartFixture,
				edges: flowchartFixture.edges.map((edge) =>
					edge.id === "clear-draft" ? { ...edge, label: undefined } : edge,
				),
			}),
		).toThrow(DiagramValidationError);
	});

	it("reports canonical missing start and end failures", () => {
		expect(
			validationIssues({
				...flowchartFixture,
				nodes: flowchartFixture.nodes.map((node) =>
					node.kind === "start" ? { ...node, kind: "process" } : node,
				),
			}).map((issue) => issue.code),
		).toContain("missing_start");
		expect(
			validationIssues({
				...flowchartFixture,
				nodes: flowchartFixture.nodes.map((node) =>
					node.kind === "end" ? { ...node, kind: "process" } : node,
				),
			}).map((issue) => issue.code),
		).toContain("missing_end");
	});

	it("rejects every disconnected node, even when it has an incoming edge", () => {
		const issues = validationIssues({
			...flowchartFixture,
			nodes: [
				{ id: "start", label: "Start", kind: "start" },
				{ id: "done", label: "Done", kind: "end" },
				{ id: "orphan-a", label: "Orphan A", kind: "process" },
				{ id: "orphan-b", label: "Orphan B", kind: "process" },
			],
			edges: [
				{ id: "finish", source: "start", target: "done" },
				{ id: "orphan-a-b", source: "orphan-a", target: "orphan-b" },
				{ id: "orphan-b-a", source: "orphan-b", target: "orphan-a" },
			],
		});

		expect(
			issues.filter((issue) => issue.code === "unreachable_node").map((issue) => issue.ref?.id),
		).toEqual(["orphan-a", "orphan-b"]);
		expect(issues.map((issue) => issue.code)).not.toContain("nonterminating_node");
	});

	it("rejects a reachable closed cycle with no path to an end", () => {
		const issues = validationIssues({
			...flowchartFixture,
			nodes: [
				{ id: "start", label: "Start", kind: "start" },
				{ id: "route", label: "Ready?", kind: "decision" },
				{ id: "done", label: "Done", kind: "end" },
				{ id: "retry-a", label: "Retry A", kind: "process" },
				{ id: "retry-b", label: "Retry B", kind: "process" },
			],
			edges: [
				{ id: "start-route", source: "start", target: "route" },
				{ id: "route-done", source: "route", target: "done", label: "yes" },
				{
					id: "route-retry",
					source: "route",
					target: "retry-a",
					label: "retry",
				},
				{ id: "retry-a-b", source: "retry-a", target: "retry-b" },
				{ id: "retry-b-a", source: "retry-b", target: "retry-a" },
			],
		});

		expect(
			issues.filter((issue) => issue.code === "nonterminating_node").map((issue) => issue.ref?.id),
		).toEqual(["retry-a", "retry-b"]);
	});

	it("accepts a retry loop when every loop node retains an exit", () => {
		const diagram = {
			...flowchartFixture,
			nodes: [
				{ id: "start", label: "Start", kind: "start" },
				{ id: "attempt", label: "Attempt", kind: "process" },
				{ id: "retry", label: "Succeeded?", kind: "decision" },
				{ id: "done", label: "Done", kind: "end" },
			],
			edges: [
				{ id: "start-attempt", source: "start", target: "attempt" },
				{ id: "attempt-retry", source: "attempt", target: "retry" },
				{
					id: "retry-attempt",
					source: "retry",
					target: "attempt",
					label: "retry",
				},
				{ id: "retry-done", source: "retry", target: "done", label: "yes" },
			],
		};

		expect(validationIssues(diagram)).toEqual([]);
		expect(parseFlowchartDiagram(diagram)).toMatchObject({ id: diagram.id });
	});

	it("enforces the 24-node and 64-edge limits at the semantic boundary", () => {
		expect(validationIssues(linearFlowchart(FLOWCHART_MAX_NODES))).toEqual([]);
		expect(validationIssues(linearFlowchart(FLOWCHART_MAX_NODES + 1))).toContainEqual(
			expect.objectContaining({
				code: "flowchart_too_large",
				ref: expect.objectContaining({ path: "nodes" }),
			}),
		);
		expect(validationIssues(denseAcyclicFlowchart(FLOWCHART_MAX_EDGES))).toEqual([]);
		expect(validationIssues(denseAcyclicFlowchart(FLOWCHART_MAX_EDGES + 1))).toContainEqual(
			expect.objectContaining({
				code: "flowchart_too_large",
				ref: expect.objectContaining({ path: "edges" }),
			}),
		);
	});

	it("caps canonical issues deterministically", () => {
		const malformed = {
			...flowchartFixture,
			nodes: [
				{ id: "start", label: "Start", kind: "start" },
				{ id: "done", label: "Done", kind: "end" },
				...Array.from({ length: FLOWCHART_MAX_NODES - 2 }, (_, index) => ({
					id: `orphan-${index}`,
					label: `Orphan ${index}`,
					kind: "process",
				})),
			],
			edges: [{ id: "finish", source: "start", target: "done" }],
		};
		const first = validationIssues(malformed);
		const second = validationIssues(malformed);

		expect(first).toHaveLength(FLOWCHART_MAX_ISSUES);
		expect(second).toEqual(first);
	});

	it("throws the typed canonical validation error from parse", () => {
		expect(() =>
			parseFlowchartDiagram({
				...flowchartFixture,
				nodes: [
					...flowchartFixture.nodes,
					{ id: "orphan", label: "Orphan process", kind: "process" },
				],
			}),
		).toThrow(FlowchartValidationError);
	});
});

describe("flowchart groups", () => {
	const grouped = {
		...flowchartFixture,
		groups: [
			{ id: "intake", label: "Intake" },
			{ id: "authoring", label: "Authoring" },
		],
		nodes: flowchartFixture.nodes.map((node) =>
			node.id === "prompt" || node.id === "requirements"
				? { ...node, group: "intake" }
				: node.id === "draft"
					? { ...node, group: "authoring" }
					: node,
		),
	};

	it("accepts declared groups with grouped and ungrouped nodes", () => {
		const diagram = parseFlowchartDiagram(grouped);
		expect(diagram.groups?.map((group) => group.id)).toEqual(["intake", "authoring"]);
		expect(diagram.nodes.map((node) => node.group)).toEqual([
			"intake",
			"intake",
			undefined,
			"authoring",
			undefined,
		]);
	});

	it("names each group problem with a repair hint", () => {
		const issues = validationIssues({
			...grouped,
			groups: [
				...grouped.groups,
				{ id: "intake", label: "Twice" },
				{ id: "spare", label: "Spare" },
			],
			nodes: grouped.nodes.map((node) =>
				node.id === "review" ? { ...node, group: "Intake" } : node,
			),
		});
		expect(issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["duplicate_group_id", { kind: "group", id: "intake", path: "groups" }],
			["unknown_node_group", { kind: "node", id: "review", path: "nodes.group" }],
			["empty_group", { kind: "group", id: "spare", path: "groups" }],
		]);
		expect(issues[1]?.hint).toBe(
			'Set group to a declared group id ("intake", "authoring", "spare") or declare "Intake" in groups.',
		);
	});

	it("bounds the number of groups", () => {
		const nodes = linearFlowchart(FLOWCHART_MAX_GROUPS + 1).nodes;
		const issues = validationIssues({
			...linearFlowchart(FLOWCHART_MAX_GROUPS + 1),
			groups: nodes.map((node) => ({ id: `g-${node.id}`, label: `Team ${node.id}` })),
			nodes: nodes.map((node) => ({ ...node, group: `g-${node.id}` })),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_too_large"]);
		expect(issues[0]?.ref).toEqual({ kind: "diagram", id: "linear-9", path: "groups" });
	});
});

describe("flowchart lanes", () => {
	const laned = {
		...flowchartFixture,
		lanes: [
			{ id: "author", label: "Author" },
			{ id: "reviewer", label: "Reviewer" },
		],
		nodes: flowchartFixture.nodes.map((node) => ({
			...node,
			lane: node.id === "clear" || node.id === "review" ? "reviewer" : "author",
		})),
	};

	it("accepts declared lanes that hold every node", () => {
		const diagram = parseFlowchartDiagram(laned);
		expect(diagram.lanes?.map((lane) => lane.id)).toEqual(["author", "reviewer"]);
		expect(diagram.nodes.map((node) => node.lane)).toEqual([
			"author",
			"author",
			"reviewer",
			"author",
			"reviewer",
		]);
	});

	it("names each lane problem with a repair hint", () => {
		const issues = validationIssues({
			...laned,
			lanes: [...laned.lanes, { id: "author", label: "Twice" }, { id: "spare", label: "Spare" }],
			groups: [{ id: "team", label: "Team" }],
			nodes: laned.nodes.map(({ lane, ...node }) =>
				node.id === "review"
					? { ...node, lane: "Reviewer" }
					: node.id === "draft"
						? node
						: { ...node, lane },
			),
		});
		expect(issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["empty_group", { kind: "group", id: "team", path: "groups" }],
			["lanes_with_groups", { kind: "diagram", id: "onboarding-flow", path: "groups" }],
			["duplicate_lane_id", { kind: "lane", id: "author", path: "lanes" }],
			["unknown_node_lane", { kind: "node", id: "draft", path: "nodes.lane" }],
			["unknown_node_lane", { kind: "node", id: "review", path: "nodes.lane" }],
			["empty_lane", { kind: "lane", id: "spare", path: "lanes" }],
		]);
		expect(issues[3]?.hint).toBe(
			'Set lane to the declared lane id ("author", "reviewer", "spare") of the actor that does this step.',
		);
		expect(issues[4]?.hint).toBe(
			'Set lane to a declared lane id ("author", "reviewer", "spare") or declare "Reviewer" in lanes.',
		);
	});

	it("names a node's lane when no lanes are declared", () => {
		const issues = validationIssues({
			...flowchartFixture,
			nodes: flowchartFixture.nodes.map((node) =>
				node.id === "review" ? { ...node, lane: "reviewer" } : node,
			),
		});
		expect(issues.map((issue) => [issue.code, issue.ref])).toEqual([
			["unknown_node_lane", { kind: "node", id: "review", path: "nodes.lane" }],
		]);
		expect(issues[0]?.hint).toBe(
			'Declare "reviewer" in lanes as { id, label }, or remove the node\'s lane.',
		);
		expect(validationIssues({ ...flowchartFixture, lanes: [] })).toEqual([]);
	});

	it("bounds the number of lanes", () => {
		const nodes = linearFlowchart(FLOWCHART_MAX_LANES + 1).nodes;
		const issues = validationIssues({
			...linearFlowchart(FLOWCHART_MAX_LANES + 1),
			lanes: nodes.map((node) => ({ id: `l-${node.id}`, label: `Actor ${node.id}` })),
			nodes: nodes.map((node) => ({ ...node, lane: `l-${node.id}` })),
		});
		expect(issues.map((issue) => issue.code)).toEqual(["flowchart_too_large"]);
		expect(issues[0]?.ref).toEqual({ kind: "diagram", id: "linear-9", path: "lanes" });
	});
});
