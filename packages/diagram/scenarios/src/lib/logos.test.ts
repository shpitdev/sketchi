import { assert, layer } from "@effect/vitest";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { logosNamedInText } from "@sketchi/icon-catalog";
import { nodeLogoIcons } from "@sketchi/icon-catalog/catalog";
import { GENERIC_PROMPTS } from "@sketchi/icon-catalog/generic-prompts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { evaluateScenarioDiagram, evaluateScenarioFixture, scenarioLogoChecks } from "./evaluate";
import { FixtureGenerationClientLayer } from "./fixture-client";
import { buildScenarioPrompt, toDiagramGenerationPrompt } from "./prompt";
import { flowchartScenarios, getScenario } from "./scenarios";

const logoScenarioIds = ["deploy-pipeline-logos", "ai-app-stack-logos"];

function check(id: string, scenarioId: string, diagram: unknown) {
	return evaluateScenarioDiagram(getScenario(scenarioId), diagram).checks.find(
		(entry) => entry.id === id,
	);
}

describe("scenario logos", () => {
	it("declares exactly the logos production offers for each prompt, aliases included", () => {
		for (const scenario of flowchartScenarios) {
			expect(scenario.logos, scenario.id).toEqual(logosNamedInText(scenario.prompt, nodeLogoIcons));
		}
		expect(getScenario("ai-app-stack-logos").logos[0]?.aliases).toContain("next.js");
		expect(toDiagramGenerationPrompt(getScenario("ai-app-stack-logos")).logos).toEqual(
			getScenario("ai-app-stack-logos").logos,
		);
	});

	it("offers logos in the model prompt only for logo scenarios", () => {
		for (const id of logoScenarioIds) {
			expect(buildScenarioPrompt(getScenario(id))).toContain("Available logos (flowchart only):");
		}
		expect(buildScenarioPrompt(getScenario("sketchi-onboarding-decision-flow"))).not.toContain(
			"Available logos",
		);
	});

	it("passes the maintained logo fixtures with recall and grounding checks", () => {
		for (const id of logoScenarioIds) {
			const evaluation = evaluateScenarioFixture(getScenario(id));
			expect(evaluation.ok, id).toBe(true);
			expect(evaluation.checks.filter((entry) => entry.id.startsWith("icon:"))).not.toHaveLength(0);
		}
	});

	it("fails recall when a named logo is missing and grounding when one is invented", () => {
		const scenario = getScenario("deploy-pipeline-logos");
		const withoutDocker = {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === "build" ? { ...node, icon: undefined } : node,
			),
		};
		const invented = {
			...scenario.expectedDiagram,
			nodes: scenario.expectedDiagram.nodes.map((node) =>
				node.id === "tests" ? { ...node, icon: { slug: "kubernetes" } } : node,
			),
		};

		expect(check("icon:docker", scenario.id, withoutDocker)?.passed).toBe(false);
		expect(check("icons-grounded", scenario.id, invented)).toMatchObject({
			passed: false,
			message: expect.stringContaining("kubernetes"),
		});
		expect(
			check("icons-grounded", "sketchi-onboarding-decision-flow", {
				...getScenario("sketchi-onboarding-decision-flow").expectedDiagram,
				nodes: getScenario("sketchi-onboarding-decision-flow").expectedDiagram.nodes.map(
					(node, index) => (index === 0 ? { ...node, icon: { slug: "github" } } : node),
				),
			})?.passed,
		).toBe(false);
	});
});

describe("logo checks on the model's diagram", () => {
	const scenario = getScenario("deploy-pipeline-logos");
	const expected = {
		logos: scenario.logos,
		requiredIconSlugs: scenario.assertions.requiredIconSlugs,
	};
	const failing = (diagram: typeof scenario.expectedDiagram) =>
		scenarioLogoChecks(expected, diagram)
			.filter((entry) => !entry.passed)
			.map((entry) => entry.id);

	it("fails when a logo sits on a step that does not name it", () => {
		expect(failing(scenario.expectedDiagram)).toEqual([]);
		expect(
			failing({
				...scenario.expectedDiagram,
				nodes: scenario.expectedDiagram.nodes.map((node) =>
					node.id === "tests" ? { ...node, icon: { slug: "docker" } } : node,
				),
			}),
		).toEqual(["icons-on-named-steps"]);
	});

	it("offers nothing for generic prompts and fails any logo on their steps", () => {
		const generic = getScenario("sketchi-onboarding-decision-flow");
		const falsePositives = ["processing", "sync", "stream", "segment", "magic"];
		for (const [index, prompt] of GENERIC_PROMPTS.entries()) {
			const logos = logosNamedInText(prompt, nodeLogoIcons);
			expect(logos, prompt).toEqual([]);
			const checks = { logos, requiredIconSlugs: [] };
			expect(
				scenarioLogoChecks(checks, generic.expectedDiagram).every((entry) => entry.passed),
				prompt,
			).toBe(true);
			const slug = falsePositives[index % falsePositives.length] ?? "sync";
			const withLogo = {
				...generic.expectedDiagram,
				nodes: generic.expectedDiagram.nodes.map((node, nodeIndex) =>
					nodeIndex === index % generic.expectedDiagram.nodes.length
						? { ...node, icon: { slug } }
						: node,
				),
			};
			expect(
				scenarioLogoChecks(checks, withLogo)
					.filter((entry) => !entry.passed)
					.map((entry) => entry.id),
				prompt,
			).toEqual(["icons-grounded", "icons-on-named-steps"]);
		}
	});
});

layer(FixtureGenerationClientLayer)("fixture generation with logos", (it) => {
	it.effect("keeps grounded logos through candidate enforcement", () =>
		Effect.gen(function* () {
			const scenario = getScenario("deploy-pipeline-logos");
			const client = yield* DiagramGenerationClient;
			const candidate = yield* client.generate({
				model: "fixture",
				prompt: toDiagramGenerationPrompt(scenario),
			});

			assert.isUndefined(candidate.error);
			assert.deepEqual(candidate.diagram, scenario.expectedDiagram);
		}),
	);
});
