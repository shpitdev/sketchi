import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram } from "@sketchi/diagram-core";

import { evaluateScenarioDiagram } from "./evaluate";
import { matchFlowchartSteps } from "./flowchart-matching";
import { getFlowchartScenario } from "./scenarios";

// Immutable normalized specs from Sonnet eval-20261019-213638-1md6.
const samples = JSON.parse(
	readFileSync(new URL("./fixtures/round16-restaurant-waitlist.json", import.meta.url), "utf8"),
) as { sample: number; runId: string; spec: Record<string, unknown> }[];
const scenario = getFlowchartScenario("restaurant-waitlist");
const labeled = parseFlowchartDiagram({ ...scenario.expectedDiagram, ...samples[0]!.spec });
const failures = (spec: Record<string, unknown>, expected = scenario) =>
	evaluateScenarioDiagram(expected, { ...expected.expectedDiagram, ...spec })
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);

function backEdge(label: string | undefined, target = "resp") {
	return {
		...labeled,
		edges: labeled.edges.map((edge) => {
			if (edge.source !== "ready" || edge.target !== "resp") return edge;
			const { label: _label, ...rest } = edge;
			return { ...rest, target, ...(label === undefined ? {} : { label }) };
		}),
	};
}

describe("stated wait/retry steps on labeled loop-back edges", () => {
	it.each(samples)("matches the judge for round 16 sample $sample ($runId)", ({ sample, spec }) => {
		// Requested-content judge: samples 1/3/4/5 pass; sample 2 fails because
		// 'not ready' gives the condition but never names the waiting action.
		if (sample === 2) {
			expect(failures(spec)).toEqual([
				"node-label:Keep waiting",
				"edge:Table ready?->Keep waiting:no",
				"edge:Keep waiting->Party responds?",
			]);
		} else {
			expect(failures(spec)).toEqual([]);
		}
	});

	it("rejects an unlabeled back-edge at the public validation boundary", () => {
		expect(() => failures(backEdge(undefined))).toThrow("outgoing branch without a label");
	});

	it("never matches a truly unlabeled return edge even before public validation", () => {
		const unlabeled = backEdge(undefined);
		expect(
			unlabeled.edges.find((edge) => edge.source === "ready" && edge.target === "resp"),
		).not.toHaveProperty("label");
		const matches = matchFlowchartSteps(scenario, unlabeled);
		expect(matches.matchedNodes.get("keep-waiting")).toEqual(new Set());
		expect(matches.graph.nodes).toHaveLength(unlabeled.nodes.length);
		expect(matches.graph.edges).toHaveLength(unlabeled.edges.length);
	});

	it("does not let a loop witness hide a missing model node or edge", () => {
		const short = {
			...labeled,
			nodes: labeled.nodes.filter((node) => node.id !== "notify"),
			edges: labeled.edges
				.filter((edge) => edge.source !== "notify")
				.map((edge) => (edge.target === "notify" ? { ...edge, target: "resp" } : edge)),
		};
		expect(failures(short)).toEqual(["min-node-count", "min-edge-count"]);
	});

	it.each(["lane", "group"] as const)("keeps the loop step in the decision's %s", (membership) => {
		const members = scenario.assertions.requiredNodes.map((step) => step.id);
		const host = { id: "host", label: "Host", labels: ["host"], members };
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
				? { lanes: [{ id: "host", label: "Host" }] }
				: { groups: [{ id: "host", label: "Host" }] }),
			nodes: labeled.nodes.map((node) => ({ ...node, [membership]: "host" })),
		};
		expect(failures(spec, expected)).toEqual([]);
	});

	it.each(["lane", "group"] as const)(
		"does not treat a loop inside a %s as ungrouped",
		(membership) => {
			const expected = {
				...scenario,
				assertions: { ...scenario.assertions, ungroupedSteps: ["keep-waiting"] },
			};
			const spec = {
				...labeled,
				...(membership === "lane"
					? { lanes: [{ id: "host", label: "Host" }] }
					: { groups: [{ id: "host", label: "Host" }] }),
				nodes: labeled.nodes.map((node) => ({ ...node, [membership]: "host" })),
			};
			expect(failures(spec, expected)).toEqual(["ungrouped:Keep waiting"]);
		},
	);

	it.each(["no", "not ready", "no (do not keep waiting)", "no (skip waiting)"])(
		"rejects a return edge without the performed step: %s",
		(label) => expect(failures(backEdge(label))).toContain("node-label:Keep waiting"),
	);

	it("rejects a named waiting action on a forward edge", () => {
		expect(failures(backEdge("no, keep waiting", "seat"))).toContain("node-label:Keep waiting");
	});

	it("requires a cycle in the model, not just the expected scenario", () => {
		const spec = backEdge("no, keep waiting");
		expect(
			failures({
				...spec,
				edges: [
					...spec.edges.map((edge) =>
						edge.source === "resp" && edge.target === "ready" ? { ...edge, target: "seat" } : edge,
					),
					{ id: "bypass", source: "notify", target: "ready", metadata: {} },
				],
			}),
		).toContain("node-label:Keep waiting");
	});

	it("accepts a loop returning to the stated preceding check process", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				requiredNodes: [
					...scenario.assertions.requiredNodes,
					{
						id: "check-response",
						kind: "process" as const,
						label: "Check response",
						labels: ["check response"],
					},
				],
				requiredEdges: [
					...scenario.assertions.requiredEdges.map((edge) =>
						edge.targetId === "party-responds" ? { ...edge, targetId: "check-response" } : edge,
					),
					{
						sourceId: "check-response",
						targetId: "party-responds",
						sourceLabel: "Check response",
						targetLabel: "Party responds?",
					},
				],
			},
		};
		const spec = backEdge("no, keep waiting", "notify");
		expect(
			failures(
				{
					...spec,
					nodes: spec.nodes.map((node) =>
						node.id === "notify" ? { ...node, label: "Check response" } : node,
					),
				},
				expected,
			),
		).toEqual([]);
	});

	it("rejects a labeled cycle returning to the wrong stated decision", () => {
		expect(failures(backEdge("no, keep waiting", "avail"))).toContain("node-label:Keep waiting");
	});

	it("rejects a return edge with the wrong branch answer", () => {
		expect(failures(backEdge("yes, keep waiting"))).toContain("node-label:Keep waiting");
	});

	it("does not fold a non-loop action into an edge, even on a cycle", () => {
		const expected = {
			...scenario,
			assertions: {
				...scenario.assertions,
				requiredNodes: scenario.assertions.requiredNodes.map((step) =>
					step.id === "keep-waiting"
						? { ...step, label: "Send reminder", labels: ["send reminder"] }
						: step,
				),
			},
		};
		expect(failures(backEdge("no, send reminder"), expected)).toContain("node-label:Send reminder");
	});

	it.each(["Wait", "Retry", "Try again", "Poll", "Check response again"])(
		"accepts the finite wait/retry vocabulary: %s",
		(label) => {
			const expected = {
				...scenario,
				assertions: {
					...scenario.assertions,
					requiredNodes: scenario.assertions.requiredNodes.map((step) =>
						step.id === "keep-waiting" ? { ...step, label, labels: [label] } : step,
					),
				},
			};
			expect(failures(backEdge(`no, ${label}`), expected)).toEqual([]);
		},
	);
});
