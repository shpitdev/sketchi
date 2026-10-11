import { assert, layer } from "@effect/vitest";
import { type SequenceDiagram, flowchartFixture } from "@sketchi/diagram-core";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { logosNamedInText } from "@sketchi/icon-catalog";
import { nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { diagramScenarios, getDiagramScenario } from "./diagram-scenarios";
import { evaluateScenarioDiagram, evaluateScenarioFixture } from "./evaluate";
import { FixtureGenerationClientLayer } from "./fixture-client";
import { getGenerationScenario } from "./generation-registry";
import { buildScenarioPrompt, toDiagramGenerationPrompt } from "./prompt";
import { getSequenceScenario, sequenceScenarios } from "./sequence-scenarios";

function failedChecks(scenarioId: string, diagram: SequenceDiagram): string[] {
	return evaluateScenarioDiagram(getSequenceScenario(scenarioId), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
}

describe("maintained sequence scenarios", () => {
	it("register every sequence scenario for the CLI, fixtures, and the eval harness", () => {
		expect(sequenceScenarios.length).toBeGreaterThanOrEqual(4);
		for (const scenario of sequenceScenarios) {
			expect(getDiagramScenario(scenario.id)).toBe(scenario);
			expect(getGenerationScenario(scenario.id)).toBe(scenario);
		}
		expect(new Set(diagramScenarios.map((scenario) => scenario.id)).size).toBe(
			diagramScenarios.length,
		);
	});

	it("ask generation for a native sequence diagram and offer exactly the logos the prompt names", () => {
		for (const scenario of sequenceScenarios) {
			expect(scenario.logos, scenario.id).toEqual(logosNamedInText(scenario.prompt, nodeLogoIcons));
			expect(toDiagramGenerationPrompt(scenario).requestedType).toBe("sequence");
			expect(buildScenarioPrompt(scenario)).toContain("The caller explicitly requires sequence.");
		}
	});

	it("pass their own maintained diagrams on every check", () => {
		for (const scenario of sequenceScenarios) {
			const evaluation = evaluateScenarioFixture(scenario);
			expect(
				evaluation.checks.filter((check) => !check.passed),
				scenario.id,
			).toEqual([]);
			expect(evaluation.checks.map((check) => check.id)).toEqual(
				expect.arrayContaining([
					"message-order",
					"answered-calls",
					"returns-answer-calls",
					"excalidraw-scene",
				]),
			);
			expect(evaluation.scene.elements.some((element) => element.type === "node")).toBe(true);
		}
	});

	it("fail message order when calls are drawn after the replies that answer them", () => {
		const expected = getSequenceScenario("checkout-payment-sequence").expectedDiagram;
		const [submit, charge, approved, confirmation] = expected.messages;
		if (!submit || !charge || !approved || !confirmation) throw new Error("Missing messages.");
		expect(
			failedChecks("checkout-payment-sequence", {
				...expected,
				messages: [submit, approved, charge, confirmation],
			}),
		).toEqual(["message-order", "answered-calls", "returns-answer-calls"]);
	});

	it("fail answered calls when responses are drawn as new calls", () => {
		const expected = getSequenceScenario("api-cache-miss-sequence").expectedDiagram;
		expect(
			failedChecks("api-cache-miss-sequence", {
				...expected,
				messages: expected.messages.map(({ type: _type, ...message }) => message),
			}),
		).toEqual(["message:3", "message:5", "message:7", "message-order", "answered-calls"]);
	});

	it("fail participant and message checks when a participant is missing", () => {
		const expected = getSequenceScenario("oauth-authorization-code-sequence").expectedDiagram;
		const failed = failedChecks("oauth-authorization-code-sequence", {
			...expected,
			participants: expected.participants.map((participant) =>
				participant.id === "idp" ? { ...participant, label: "Login Server" } : participant,
			),
		});
		expect(failed).toEqual([
			"participant:identity",
			"message:1",
			"message:2",
			"message:3",
			"message:4",
			"message-order",
		]);
	});

	it("score the model's own diagram, not a repaired one", () => {
		const scenario = getSequenceScenario("payment-webhook-reentrant-sequence");
		const modelDiagram = {
			...scenario.expectedDiagram,
			messages: scenario.expectedDiagram.messages.filter((message) => message.type !== "return"),
		};
		const evaluation = evaluateScenarioDiagram(scenario, scenario.expectedDiagram, modelDiagram);
		expect(evaluation.ok).toBe(false);
		expect(evaluation.checks.find((check) => check.id === "answered-calls")?.passed).toBe(false);
		expect(evaluation.diagram).toEqual(scenario.expectedDiagram);
	});

	it("reject a flowchart returned for a sequence scenario instead of scoring it", () => {
		expect(() =>
			evaluateScenarioDiagram(getSequenceScenario("checkout-payment-sequence"), flowchartFixture),
		).toThrow(/participants/u);
	});
});

describe("sequence eval matching", () => {
	it("fails the fire-and-forget check when the analytics call is answered", () => {
		const expected = getSequenceScenario("api-cache-miss-sequence").expectedDiagram;
		const usage = expected.messages.findIndex((message) => message.id === "usage");
		const withAck = {
			...expected,
			messages: [
				...expected.messages.slice(0, usage + 1),
				{ id: "ack", source: "analytics", target: "api", label: "Ack", type: "return" as const },
				...expected.messages.slice(usage + 1),
			],
		};
		expect(failedChecks("api-cache-miss-sequence", withAck)).toEqual(["unanswered:1"]);
	});

	it("matches short alternatives as whole words only", () => {
		const scenario = getSequenceScenario("payment-webhook-reentrant-sequence");
		const expected = scenario.expectedDiagram;
		// "200 OK" relabelled so that "ok" and "ack" only appear inside other words.
		const relabelled = {
			...expected,
			messages: expected.messages.map((message) =>
				message.id === "ack" ? { ...message, label: "Callback token" } : message,
			),
		};
		expect(failedChecks(scenario.id, relabelled)).toEqual(["message:5", "message-order"]);
	});
});

layer(FixtureGenerationClientLayer)("fixture generation for sequence scenarios", (it) => {
	it.effect("returns the maintained sequence through candidate enforcement", () =>
		Effect.gen(function* () {
			const client = yield* DiagramGenerationClient;
			for (const scenario of sequenceScenarios) {
				const candidate = yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario),
				});
				assert.isUndefined(candidate.error, scenario.id);
				assert.deepEqual(candidate.diagram, scenario.expectedDiagram);
			}
		}),
	);
});
