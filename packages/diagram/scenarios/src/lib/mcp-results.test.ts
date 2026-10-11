import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { getDiagramScenario } from "./diagram-scenarios.js";
import { evaluateScenarioDiagram } from "./evaluate.js";
import {
	candidateFromMcpResult,
	normalizedSpecFrom,
	specToSequenceCandidate,
} from "./mcp-results.js";

const ExecuteFixture = Schema.fromJsonString(
	Schema.Struct({
		ok: Schema.Boolean,
		result: Schema.Struct({
			ok: Schema.Boolean,
			status: Schema.String,
			normalizedSpec: Schema.Record(Schema.String, Schema.Unknown),
		}),
	}),
);
const sequence = Schema.decodeUnknownSync(ExecuteFixture)(
	readFileSync(new URL("./fixtures/sequence-execute.json", import.meta.url), "utf8"),
);
const flowchart = Schema.decodeUnknownSync(ExecuteFixture)(
	readFileSync(new URL("./fixtures/flowchart-execute.json", import.meta.url), "utf8"),
);
const failedToolResult: unknown = JSON.parse(
	readFileSync(new URL("./fixtures/failed-tool-result.json", import.meta.url), "utf8"),
);

describe("MCP scenario adapter", () => {
	it.each([
		undefined,
		null,
		"done",
		{ built: flowchart.result },
		{ ok: false, reason: "optional step skipped" },
		{ ok: true, status: "accepted", artifact: {} },
	])("grades build receipts when result is %j", (result) => {
		const value = {
			structuredContent: {
				ok: true,
				result,
				builds: [{ ...flowchart.result, operation: "buildFlowchart" }],
			},
		};
		expect(candidateFromMcpResult(value, "flowchart")).toEqual(
			candidateFromMcpResult(flowchart, "flowchart"),
		);
		expect(normalizedSpecFrom(value)).toEqual(flowchart.result.normalizedSpec);
	});
	it("grades an accepted flowchart when the script returns a searchIcons validation failure", () => {
		// await sketchi.buildFlowchart(...); return sketchi.searchIcons({ q: "" });
		const value = {
			structuredContent: {
				ok: true,
				result: {
					ok: false,
					status: "invalid_input",
					issues: [{ code: "invalid_input", message: "Query must not be empty" }],
				},
				builds: [{ ...flowchart.result, operation: "buildFlowchart" }],
			},
		};
		expect(candidateFromMcpResult(value, "flowchart")).toEqual(
			candidateFromMcpResult(flowchart, "flowchart"),
		);
		expect(normalizedSpecFrom(value)).toEqual(flowchart.result.normalizedSpec);
	});
	it("uses the last matching build attempt, including rejection, without masking execute errors", () => {
		const builds = [
			{ ...flowchart.result, operation: "buildFlowchart" },
			{ ok: false, status: "invalid_input", operation: "buildFlowchart" },
		];
		expect(candidateFromMcpResult({ ok: true, result: null, builds }, "flowchart")).toMatchObject({
			ok: false,
		});
		expect(normalizedSpecFrom({ ok: true, builds })).toBeUndefined();
		expect(
			candidateFromMcpResult({ ok: false, builds: builds.slice(0, 1) }, "flowchart"),
		).toMatchObject({ ok: false });
	});
	it("preserves a returned pre-ID rejection matched to a receipt before a later success", () => {
		const rejected = {
			ok: false,
			status: "invalid_input",
			issues: [{ code: "missing_field", message: "Missing spec.nodes" }],
		};
		const value = {
			ok: true,
			result: structuredClone(rejected),
			builds: [
				{ ...rejected, operation: "buildFlowchart" },
				{ ...flowchart.result, operation: "buildFlowchart" },
			],
		};
		expect(candidateFromMcpResult(value, "flowchart")).toMatchObject({ ok: false });
		expect(normalizedSpecFrom(value)).toBeUndefined();
	});
	it("keeps an explicitly returned build authoritative and selects receipts by diagram family", () => {
		const builds = [
			{ ...flowchart.result, operation: "buildFlowchart" },
			{ ...sequence.result, operation: "buildSequenceDiagram" },
		];
		expect(candidateFromMcpResult({ ok: true, result: null, builds }, "flowchart")).toEqual(
			candidateFromMcpResult(flowchart, "flowchart"),
		);
		expect(candidateFromMcpResult({ ok: true, result: null, builds }, "sequence")).toEqual(
			candidateFromMcpResult(sequence, "sequence"),
		);
		expect(
			candidateFromMcpResult(
				{ ok: true, result: { ...flowchart.result, ok: false }, builds },
				"flowchart",
			),
		).toMatchObject({ ok: false });
	});
	it("recognizes protocol-level failures without structuredContent and retains their error text", () => {
		expect(candidateFromMcpResult(failedToolResult, "flowchart")).toEqual({
			ok: false,
			check: {
				id: "mcp-build-accepted",
				passed: false,
				message: "MCP execute/build failed. Error: Code execution timed out",
			},
		});
	});
	it("extracts the same normalized spec at every supported envelope depth", () => {
		for (const input of [sequence.result, sequence, { structuredContent: sequence }]) {
			expect(normalizedSpecFrom(input)).toEqual(sequence.result.normalizedSpec);
		}
		expect(normalizedSpecFrom(null)).toBeUndefined();
		expect(normalizedSpecFrom({ result: false })).toBeUndefined();
	});

	it("preserves sequence message order, return types, styles, and participant logos", () => {
		const spec = {
			...sequence.result.normalizedSpec,
			participants: [{ id: "github", label: "GitHub", icon: { slug: "github" } }],
		};
		expect(specToSequenceCandidate(spec)).toEqual({ ...spec, type: "sequence" });
		const candidate = candidateFromMcpResult(sequence, "sequence");
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected accepted sequence fixture.");
		const evaluation = evaluateScenarioDiagram(
			getDiagramScenario("checkout-payment-sequence"),
			candidate.diagram,
		);
		expect(evaluation.ok).toBe(true);
		expect(
			evaluation.checks
				.filter(({ id }) =>
					["message-order", "answered-calls", "returns-answer-calls"].includes(id),
				)
				.every(({ passed }) => passed),
		).toBe(true);
	});

	it("grades retained flowchart logos without adding or moving them", () => {
		const scenario = getDiagramScenario("deploy-pipeline-logos");
		if (scenario.diagramType !== "flowchart") throw new Error("Expected a flowchart.");
		const spec = {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map(({ icon: _icon, ...node }) =>
				node.id === "tests" ? { ...node, icon: { slug: "github" } } : node,
			),
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, status: "accepted", normalizedSpec: spec },
			"flowchart",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected accepted flowchart.");
		const evaluation = evaluateScenarioDiagram(scenario, candidate.diagram);
		expect(evaluation.checks.find(({ id }) => id === "icons-on-named-steps")?.passed).toBe(false);
		expect(evaluation.checks.find(({ id }) => id === "icon:docker")?.passed).toBe(false);
	});

	it.each([
		[
			"failed outer execute with an accepted inner build",
			{ ...flowchart, ok: false, error: "Execution failed" },
		],
		["failed MCP tool result", { isError: true, structuredContent: flowchart }],
		[
			"unaccepted nested build retaining a spec",
			{ ...flowchart, result: { ...flowchart.result, ok: false, status: "quality_failed" } },
		],
		["unaccepted status despite ok", { ...flowchart.result, status: "render_failed" }],
		["missing acceptance status", { ok: true, normalizedSpec: flowchart.result.normalizedSpec }],
		["contradictory quality verdict", { ...flowchart.result, quality: { accepted: false } }],
		["missing spec", { ok: true, status: "accepted" }],
		["null spec", { ok: true, status: "accepted", normalizedSpec: null }],
	])("returns a diagnostic check for %s", (_name, input) => {
		expect(candidateFromMcpResult(input, "flowchart")).toMatchObject({
			ok: false,
			check: { id: "mcp-build-accepted", passed: false, message: expect.any(String) },
		});
	});

	it("leaves bare IR and typed generation envelopes on their existing path", () => {
		const scenario = getDiagramScenario("checkout-payment-sequence");
		expect(candidateFromMcpResult(scenario.expectedDiagram, "sequence")).toBeUndefined();
		expect(
			candidateFromMcpResult(
				{ title: scenario.title, intent: {}, diagram: scenario.expectedDiagram },
				"sequence",
			),
		).toBeUndefined();
	});
});
