import { describe, expect, it } from "vitest";

import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { candidateFromMcpResult } from "./mcp-results";
import { flowchartScenarios, getFlowchartScenario } from "./scenarios";

const ids = ["photo-resize-queue-zones", "support-chat-queue", "release-hotfix-rollback"];

const crossingCheck = (checks: readonly { id: string; passed: boolean; message: string }[]) =>
	checks.find((check) => check.id === "avoidable-crossings");

describe("crossing scenarios", () => {
	it.each(ids)("draws %s's fixture crossing no line its planar graph does not force", (id) => {
		const evaluation = evaluateScenarioFixture(getFlowchartScenario(id));
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
		expect(crossingCheck(evaluation.checks)?.message).toBe(
			"Lines cross nothing, as the planar graph allows.",
		);
	});

	it("counts the crossings of lines drawn at any angle", () => {
		// Drawn straight, the chat queue's hold loop and shortcut cross its lines
		// diagonally, which no orthogonal crossing count sees.
		const scenario = getFlowchartScenario("support-chat-queue");
		const evaluation = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			layout: { direction: "TB", edgeRouting: "straight" },
		});
		expect(crossingCheck(evaluation.checks)).toMatchObject({
			passed: false,
			message: expect.stringMatching(
				/^Lines cross [1-9]\d* time\(s\) where the planar graph allows none\.$/,
			),
		});
	});

	it("fails no drawing of a graph that is not planar, whose forced crossings are only bounded", () => {
		// Three steps that each lead to the same four: K3,4, whose bound is one
		// crossing though no drawing crosses fewer than two.
		const scenario = getFlowchartScenario("release-hotfix-rollback");
		const [a, b] = [
			["a1", "a2", "a3"],
			["b1", "b2", "b3", "b4"],
		];
		const evaluation = evaluateScenarioDiagram(scenario, {
			...scenario.expectedDiagram,
			nodes: [
				{ id: "start", label: "Start", kind: "start", metadata: {} },
				{ id: "split", label: "Split", kind: "process", metadata: {} },
				...[...a, ...b].map((id) => ({ id, label: `Step ${id}`, kind: "process", metadata: {} })),
				{ id: "end", label: "End", kind: "end", metadata: {} },
			],
			edges: [
				{ id: "start-split", source: "start", target: "split", metadata: {} },
				...a.map((id) => ({ id: `split-${id}`, source: "split", target: id, metadata: {} })),
				...a.flatMap((from) =>
					b.map((to) => ({ id: `${from}-${to}`, source: from, target: to, metadata: {} })),
				),
				...b.map((id) => ({ id: `${id}-end`, source: id, target: "end", metadata: {} })),
			],
			groups: [],
		});
		expect(crossingCheck(evaluation.checks)).toMatchObject({
			passed: true,
			message: expect.stringMatching(/^The graph is not planar: it forces at least 1 crossing/),
		});
	});

	it("bounds nothing by planarity once lanes fix where the nodes sit", () => {
		// The triage drawn in three lanes, every support step in one: the planar
		// graph cannot say whether the lanes force its one crossing.
		const support = { lane: "support" };
		const candidate = candidateFromMcpResult(
			{
				ok: true,
				status: "accepted",
				normalizedSpec: {
					id: "customer-feedback-triage",
					title: "Customer feedback triage",
					curved: true,
					nodes: {
						submit: { label: "Submit feedback", lane: "customer" },
						tag: { label: "Tag feedback", lane: "bot" },
						bug: { label: "Is it a bug?", lane: "bot" },
						reproduce: { label: "Reproduce bug", ...support },
						reproduced: { label: "Can reproduce?", ...support },
						ticket: { label: "File ticket", ...support },
						details: { label: "Ask customer for details", ...support },
						again: { label: "Reproduce bug again", ...support },
						thank: { label: "Thank customer", lane: "bot" },
					},
					edges: [
						["submit", "tag"],
						["tag", "bug"],
						["bug", "reproduce", "yes"],
						["bug", "thank", "no"],
						["reproduce", "reproduced"],
						["reproduced", "ticket", "yes"],
						["reproduced", "details", "no"],
						["details", "again"],
						["again", "reproduced"],
					],
					lanes: { customer: "Customer", bot: "Bot", support: "Support team" },
				},
			},
			"flowchart",
		);
		if (!candidate?.ok) throw new Error("The laned triage build is not a flowchart candidate.");
		const evaluation = evaluateScenarioDiagram(
			getFlowchartScenario("feedback-triage-curved"),
			candidate.diagram,
		);
		expect(crossingCheck(evaluation.checks)).toMatchObject({
			passed: true,
			message: expect.stringMatching(
				/^Lanes fix where the nodes sit, so planarity bounds nothing; lines cross 1 time\(s\)\.$/,
			),
		});
		expect(evaluation.checks.filter((check) => !check.passed)).toEqual([]);
	});

	it("checks crossings only where a scenario asks for it", () => {
		const checked = flowchartScenarios.filter((scenario) =>
			evaluateScenarioFixture(scenario).checks.some((check) => check.id === "avoidable-crossings"),
		);
		expect(checked.map((scenario) => scenario.id)).toEqual([
			...ids,
			"feedback-triage-curved",
			"ingest-pipeline-curved-lr",
			"checkout-services-curved-zones",
		]);
	});
});
