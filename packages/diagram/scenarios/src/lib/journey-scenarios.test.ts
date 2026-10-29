import { describe, expect, it } from "vitest";
import type { JourneyDiagram } from "@sketchi/diagram-core";
import { renderDiagram, type RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { journeyDrawnCheck, journeyLayoutCheck, journeyScenarios } from "./journey-scenarios.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { toDiagramGenerationPrompt } from "./prompt.js";

const scenario = (id: string) => journeyScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: JourneyDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const online = scenario("online-purchase-journey").expectedDiagram;
const saas = scenario("saas-onboarding-journey").expectedDiagram;
const support = scenario("support-ticket-journey").expectedDiagram;
type Stage = JourneyDiagram["stages"][number];
const withStage = (
	diagram: JourneyDiagram,
	index: number,
	change: (stage: Stage) => Stage,
): JourneyDiagram => ({
	...diagram,
	stages: diagram.stages.map((stage, at) => (at === index ? change(stage) : stage)),
});
const withStep = (
	diagram: JourneyDiagram,
	stage: number,
	step: number,
	change: (value: Stage["steps"][number]) => Stage["steps"][number],
) =>
	withStage(diagram, stage, (value) => ({
		...value,
		steps: value.steps.map((entry, at) => (at === step ? change(entry) : entry)),
	}));

describe("prompt-grounded journey scenarios", () => {
	it("covers an online purchase, a six-stage SaaS onboarding and a support ticket", () => {
		expect(journeyScenarios.map((entry) => [entry.id, entry.difficulty])).toEqual([
			["online-purchase-journey", "smoke"],
			["saas-onboarding-journey", "challenge"],
			["support-ticket-journey", "standard"],
		]);
		expect(saas.stages.map((stage) => stage.steps.length)).toEqual([2, 2, 2, 2, 1, 1]);
		expect(journeyScenarios.every((entry) => entry.tags.includes("journey"))).toBe(true);
		// Every scored fact sits in the prompt, so it binds the grader too.
		for (const entry of journeyScenarios)
			for (const stage of entry.expectedDiagram.stages) {
				expect(entry.prompt).toContain(`${stage.name}:`);
				for (const step of stage.steps) expect(entry.prompt).toContain(`, ${step.score})`);
			}
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of journeyScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts the equivalent forms: a label without its actor's name, an article, another case", () => {
		const dropped = withStep(saas, 0, 0, (step) => ({
			...step,
			label: "Creates an account with his work email",
		}));
		expect(failed("saas-onboarding-journey", dropped)).toEqual([]);
		const it = withStep(saas, 1, 1, (step) => ({
			...step,
			label: "Approves the firewall allowlist request after two days",
		}));
		expect(failed("saas-onboarding-journey", it)).toEqual([]);
		const prefixed = withStep(online, 0, 0, (step) => ({
			...step,
			label: "Priya sees an Instagram ad",
		}));
		expect(failed("online-purchase-journey", prefixed)).toEqual([]);
		const article = withStep(support, 1, 1, (step) => ({
			...step,
			label: "agent asks for the invoice number",
		}));
		expect(failed("support-ticket-journey", article)).toEqual([]);
		// The persona may live in the title.
		const { persona: _persona, ...untitled } = online;
		expect(
			failed("online-purchase-journey", { ...untitled, title: "Priya's running shoe purchase" }),
		).toEqual([]);
	});

	it.each([
		[
			"a step moved to the next stage",
			() =>
				withStage(
					withStage(online, 1, (stage) => ({ ...stage, steps: stage.steps.slice(0, 1) })),
					2,
					(stage) => ({ ...stage, steps: [online.stages[1]!.steps[1]!, ...stage.steps] }),
				),
			["step:size", "step-order:choose"],
		],
		[
			"a changed score",
			() => withStep(online, 2, 1, (step) => ({ ...step, score: 4 })),
			["score:apple-pay"],
		],
		[
			"a changed touchpoint",
			() => withStep(online, 3, 0, (step) => ({ ...step, touchpoint: "SMS" })),
			["touchpoint:confirmation"],
		],
		[
			"swapped steps",
			() => withStage(online, 0, (stage) => ({ ...stage, steps: stage.steps.toReversed() })),
			["step-order:discover"],
		],
		[
			"swapped stages",
			() => ({
				...online,
				stages: [online.stages[1]!, online.stages[0]!, ...online.stages.slice(2)],
			}),
			["stage-order"],
		],
		[
			"a pain point under the wrong stage",
			() =>
				withStage(
					withStage(online, 3, ({ painPoints: _pains, ...stage }) => stage),
					2,
					(stage) => ({ ...stage, painPoints: ["No notice of the delay"] }),
				),
			["pain-point:receive:1"],
		],
		[
			"an invented step",
			() =>
				withStage(online, 2, (stage) => ({
					...stage,
					steps: [...stage.steps, { label: "Gets a receipt", score: 3 }],
				})),
			["steps-exact"],
		],
		[
			"an invented opportunity",
			() => withStage(online, 0, (stage) => ({ ...stage, opportunities: ["Show more reviews"] })),
			["opportunities-exact"],
		],
		[
			"a missing persona",
			() => {
				const { persona: _persona, ...rest } = online;
				return { ...rest, title: "Running shoe purchase" };
			},
			["persona"],
		],
	])("fails %s on the stated check", (_, change, expected) => {
		expect(failed("online-purchase-journey", change()).toSorted()).toEqual(expected.toSorted());
	});

	it("requires each step's stated actor, or a label opening with it, and no unnamed actor", () => {
		expect(
			failed(
				"saas-onboarding-journey",
				withStep(saas, 2, 1, (step) => ({ ...step, actor: "Marco" })),
			),
		).toEqual(["actor:slow-query"]);
		expect(
			failed(
				"saas-onboarding-journey",
				withStep({ ...saas, actors: [...saas.actors!, "Ops manager"] }, 4, 0, (step) => ({
					...step,
					actor: "Ops manager",
				})),
			).toSorted(),
		).toEqual(["actors-stated"]);
		expect(failed("saas-onboarding-journey", { ...saas, persona: "Marco" })).toEqual(["persona"]);
	});

	it("reads the drawing: a sad face on a 5, a face between columns and a note across stages fail", () => {
		const scene = renderDiagram(online);
		expect(journeyDrawnCheck(online, scene).passed).toBe(true);
		expect(journeyLayoutCheck(scene).passed).toBe(true);
		const edit = (
			id: string,
			change: (
				element: RenderedDiagramScene["elements"][number],
			) => RenderedDiagramScene["elements"][number],
		) => ({
			...scene,
			elements: scene.elements.map((element) => (element.id === id ? change(element) : element)),
		});
		const sad = edit("line:journey:face:2-1:mouth", (element) =>
			element.type === "line"
				? {
						...element,
						points: element.points.map((point, index) =>
							index === 1 ? { ...point, y: point.y - 12 } : point,
						) as typeof element.points,
					}
				: element,
		);
		expect(journeyDrawnCheck(online, sad).passed).toBe(false);
		const between = edit("node:journey:face:0-0", (element) =>
			element.type === "node" ? { ...element, x: element.x + 70 } : element,
		);
		expect(journeyDrawnCheck(online, between).passed).toBe(false);
		const across = edit("node:journey:pain:1-0", (element) =>
			element.type === "node" ? { ...element, x: element.x + 100 } : element,
		);
		expect(journeyDrawnCheck(online, across).passed).toBe(false);
		const rescored = edit("node:journey:face:1-1", (element) =>
			element.type === "node" ? { ...element, label: "Neutral (3)" } : element,
		);
		expect(journeyDrawnCheck(online, rescored).message).toContain("face");
		const unprinted = {
			...scene,
			elements: scene.elements.filter((element) => element.id !== "text:journey:score:2-1"),
		};
		expect(journeyDrawnCheck(online, unprinted).passed).toBe(false);
		const misprinted = edit("text:journey:score:2-1", (element) =>
			element.type === "text" ? { ...element, text: "4" } : element,
		);
		expect(journeyDrawnCheck(online, misprinted).message).toContain("prints 4");
		const overlapped = edit("node:journey:step:0-1", (element) =>
			element.type === "node" ? { ...element, x: element.x - 60 } : element,
		);
		expect(journeyLayoutCheck(overlapped).passed).toBe(false);
	});

	it("draws the six-stage challenge without overlap, wrapping into bands with its curve running on", () => {
		const scene = renderDiagram(saas);
		expect(journeyLayoutCheck(scene).passed).toBe(true);
		expect(journeyDrawnCheck(saas, scene).passed).toBe(true);
		expect((scene.width - 80) / (scene.height - 80)).toBeLessThanOrEqual(2.45);
	});

	it("serves the fixture model's diagram, meeting its step count and every stage", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("support-ticket-journey")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(support);
	});

	it("grades a buildJourneyMap receipt from an MCP execute", () => {
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildJourneyMap",
			buildId: "build-1",
			normalizedSpec: { ...saas, type: undefined },
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"journey",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("saas-onboarding-journey", candidate.diagram as JourneyDiagram)).toEqual([]);
	});
});
