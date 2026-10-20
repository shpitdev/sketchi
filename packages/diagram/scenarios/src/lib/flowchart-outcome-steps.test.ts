import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { matchFlowchartSteps } from "./flowchart-matching";
import { specToFlowchartCandidate } from "./mcp-results";
import { getFlowchartScenario } from "./scenarios";

// Unmodified normalized specs from the retained production/icon-attach evals.
const samples = JSON.parse(
	readFileSync(new URL("./fixtures/cached-answer-folds.json", import.meta.url), "utf8"),
) as { runId: string; spec: Record<string, unknown> }[];
const scenario = getFlowchartScenario("ai-app-stack-logos");
const labeled = parseFlowchartDiagram(specToFlowchartCandidate(samples[0]!.spec));
const failures = (diagram = labeled, expected = scenario) =>
	evaluateScenarioDiagram(expected, diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const missing = "node-label:Return cached answer";
function hitEdge(label: string | undefined, target = "ret") {
	return {
		...labeled,
		edges: labeled.edges.map((edge) => {
			if (edge.source !== "hit" || edge.target !== "ret") return edge;
			const { label: _label, ...rest } = edge;
			return { ...rest, target, ...(label === undefined ? {} : { label }) };
		}),
	};
}

describe("explicit cached-answer outcome on a branch into the shared answer", () => {
	it.each(samples)("accepts the real folded spec $runId", ({ spec }) => {
		expect(failures(parseFlowchartDiagram(specToFlowchartCandidate(spec)))).toEqual([]);
	});

	it.each(["yes", "hit", "hit: return cached answer", "yes (return cached answer)"])(
		"accepts %s",
		(label) => {
			expect(failures(hitEdge(label))).toEqual([]);
		},
	);

	it("takes yes from the stated cached-in-Redis condition too", () => {
		const spec = {
			...hitEdge("yes"),
			edges: hitEdge("yes").edges.map((edge) =>
				edge.label === "no" ? { ...edge, label: "miss" } : edge,
			),
			nodes: labeled.nodes.map((node) =>
				node.id === "hit" ? { ...node, label: "Cached in Redis?" } : node,
			),
		};
		expect(failures(spec)).toEqual([]);
	});

	it.each(["Redis cache miss?", "Redis cache?"])(
		"does not infer a hit from bare yes without a positive cache condition: %s",
		(decision) => {
			const spec = {
				...hitEdge("yes"),
				nodes: labeled.nodes.map((node) =>
					node.id === "hit" ? { ...node, label: decision } : node,
				),
				// No unrelated "no" branch can witness "hit" on the miss-polarity decision.
				edges: hitEdge("yes").edges.map((edge) =>
					edge.label === "no" ? { ...edge, label: "miss" } : edge,
				),
			};
			expect(failures(spec)).toEqual(
				expect.arrayContaining([
					missing,
					"branch-label:hit",
					"edge:Cached in Redis?->Return cached answer:hit",
				]),
			);
			expect(matchFlowchartSteps(scenario, spec).matchedNodes.get("cached")).toEqual(new Set());
		},
	);

	it("requires an explicit hit label when the decision asks about a cache miss", () => {
		const spec = {
			...hitEdge("hit: return cached answer"),
			nodes: labeled.nodes.map((node) =>
				node.id === "hit" ? { ...node, label: "Redis cache miss?" } : node,
			),
			edges: hitEdge("hit: return cached answer").edges.map((edge) =>
				edge.label === "no" ? { ...edge, label: "miss" } : edge,
			),
		};
		expect(failures(spec)).toEqual([]);
	});

	it.each([
		"yes: do not return cached answer",
		"yes: skip cached answer",
		"miss",
		"no: return cached answer",
		"miss: return cached answer",
	])("rejects an incomplete or wrong branch: %s", (label) => {
		expect(failures(hitEdge(label))).toContain(missing);
	});

	it("rejects a bare no branch before and after public validation", () => {
		const spec = hitEdge("no");
		expect(matchFlowchartSteps(scenario, spec).matchedNodes.get("cached")).toEqual(new Set());
		expect(() => failures(spec)).toThrow('repeats branch label "no"');
	});

	it("rejects an unlabeled branch at the public boundary and in the matcher", () => {
		const spec = hitEdge(undefined);
		expect(() => failures(spec)).toThrow("outgoing branch without a label");
		expect(matchFlowchartSteps(scenario, spec).matchedNodes.get("cached")).toEqual(new Set());
	});

	it.each(["yes", "hit", "yes: return cached answer"])(
		"rejects the wrong target even if it later reaches the answer: %s",
		(label) => {
			expect(failures(hitEdge(label, "llm"))).toContain(missing);
		},
	);

	it("requires the named shared answer end, not just any end", () => {
		const spec = {
			...labeled,
			nodes: labeled.nodes.map((node) => (node.id === "ret" ? { ...node, label: "Done" } : node)),
		};
		expect(failures(spec)).toContain(missing);
	});

	it.each(["yes", "hit", "yes: return cached answer"])(
		"requires the stated decision for %s",
		(label) => {
			const spec = {
				...hitEdge(label),
				nodes: labeled.nodes.map((node) =>
					node.id === "hit" ? { ...node, label: "Request valid?" } : node,
				),
			};
			expect(failures(spec)).toContain(missing);
		},
	);

	it("requires a decision node, not a cache-named process", () => {
		const spec = {
			...labeled,
			nodes: labeled.nodes.map((node) =>
				node.id === "hit" ? { ...node, kind: "process" as const } : node,
			),
		};
		expect(failures(spec)).toContain(missing);
	});

	it("requires explicit scenario opt-in", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				requiredNodes: scenario.assertions.requiredNodes.map(
					({ sharedEndId: _shared, ...step }) => step,
				),
			},
		};
		expect(failures(labeled, expected)).toContain(missing);
	});

	it("never pads minimum drawn counts with an outcome witness", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				minNodeCount: labeled.nodes.length + 1,
				minEdgeCount: labeled.edges.length + 1,
			},
		};
		expect(failures(labeled, expected)).toEqual(["min-node-count", "min-edge-count"]);
	});

	it.each(["lane", "group"] as const)("inherits the decision's %s", (membership) => {
		const members = scenario.assertions.requiredNodes.map((step) => step.id);
		const host = { id: "app", label: "App", labels: ["app"], members };
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				...(membership === "lane" ? { requiredLanes: [host] } : { requiredGroups: [host] }),
			},
		};
		const spec = {
			...labeled,
			...(membership === "lane"
				? { lanes: [{ id: "app", label: "App" }] }
				: { groups: [{ id: "app", label: "App" }] }),
			nodes: labeled.nodes.map((node) => ({ ...node, [membership]: "app" })),
		};
		expect(failures(spec, expected)).toEqual([]);
		const ungrouped = {
			...expected,
			assertions: { ...expected.assertions, ungroupedSteps: ["cached"] },
		};
		expect(failures(spec, ungrouped)).toContain("ungrouped:Return cached answer");
	});
});
