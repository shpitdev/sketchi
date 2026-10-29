import { describe, expect, it } from "vitest";
import type { VennDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { toDiagramGenerationPrompt } from "./prompt.js";
import { vennDrawnCheck, vennLayoutCheck, vennScenarios } from "./venn-scenarios.js";

const scenario = (id: string) => vennScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: VennDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const skills = scenario("team-skills-venn").expectedDiagram;
const plans = scenario("plan-features-venn").expectedDiagram;
const phones = scenario("ios-android-venn").expectedDiagram;
/** Move an item from wherever it is to the region of `sets`, creating it if needed. */
function moveItem(diagram: VennDiagram, item: string, sets: string[]): VennDiagram {
	const regions = diagram.regions.map((region) => ({
		...region,
		items: (region.items ?? []).filter((entry) => entry !== item),
	}));
	const target = regions.find(
		(region) => region.sets.length === sets.length && sets.every((id) => region.sets.includes(id)),
	);
	if (target) target.items = [...target.items, item];
	else regions.push({ sets, items: [item] });
	return { ...diagram, regions: regions.filter((region) => region.items.length > 0) };
}

describe("prompt-grounded Venn scenarios", () => {
	it("covers three sets with every region filled, a dense centre with an empty region, and two sets", () => {
		expect(vennScenarios.map((entry) => entry.id)).toEqual([
			"team-skills-venn",
			"plan-features-venn",
			"ios-android-venn",
		]);
		const count = (diagram: VennDiagram) =>
			diagram.regions.reduce((sum, region) => sum + (region.items?.length ?? 0), 0);
		expect([count(skills), count(plans), count(phones)]).toEqual([13, 20, 10]);
		expect(skills.regions).toHaveLength(7);
		expect(plans.regions.find((region) => region.sets.length === 3)?.items).toHaveLength(7);
		expect(scenario("plan-features-venn").difficulty).toBe("challenge");
		expect(phones.sets).toHaveLength(2);
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of vennScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts the equivalent forms: other ids, set order, key order, colors, bullets, an explicitly empty region", () => {
		const reordered: VennDiagram = {
			...plans,
			sets: [...plans.sets].reverse().map((set, index) => ({
				...set,
				id: `s${index}`,
				...(index === 0 ? { color: "violet" } : {}),
			})),
			regions: [
				...plans.regions.map((region) => ({
					...region,
					sets: [...region.sets]
						.reverse()
						.map((id) => `s${2 - plans.sets.findIndex((set) => set.id === id)}`),
					...(region.items ? { items: region.items.map((item) => `• ${item.toLowerCase()}`) } : {}),
				})),
				{ sets: ["s0", "s2"], items: [] },
			],
		};
		expect(failed("plan-features-venn", reordered)).toEqual([]);
		const zero = {
			...plans,
			regions: [...plans.regions, { sets: ["personal", "education"], count: 0 }],
		};
		expect(failed("plan-features-venn", zero)).toEqual([]);
	});

	it.each([
		[
			"an item in a neighbouring region",
			() => moveItem(skills, "Prototyping", ["design"]),
			["region:prototyping"],
		],
		[
			"an item in two regions",
			() => ({
				...skills,
				regions: skills.regions.map((region) =>
					region.sets.join() === "design"
						? { ...region, items: [...region.items!, "Analytics"] }
						: region,
				),
			}),
			["region:analytics", "items-exact"],
		],
		[
			"a missing item",
			() => ({
				...skills,
				regions: skills.regions.map((region) => ({
					...region,
					items: region.items!.filter((item) => item !== "Pricing"),
				})),
			}),
			["item:pricing", "region:pricing", "items-exact"],
		],
		[
			"an invented item",
			() => moveItem(skills, "Brand strategy", ["design", "product"]),
			["items-exact"],
		],
		[
			"a renamed set",
			() => ({
				...skills,
				sets: skills.sets.map((set) =>
					set.id === "product" ? { ...set, label: "Marketing" } : set,
				),
			}),
			[
				"set:product",
				"region:pricing",
				"region:roadmapping",
				"region:userresearch",
				"region:analytics",
				"region:technicalspecs",
				"region:problemframing",
				"region:stakeholdercommunication",
			],
		],
	])("fails %s on the stated check", (_, change, expected) => {
		expect(failed("team-skills-venn", change()).toSorted()).toEqual(expected.toSorted());
	});

	it("fails an invented set and anything drawn in the region stated empty", () => {
		expect(
			failed("ios-android-venn", {
				...phones,
				sets: [...phones.sets, { id: "web", label: "Web" }],
			}),
		).toEqual(["sets-exact"]);
		expect(
			failed("plan-features-venn", moveItem(plans, "Personal vault", ["personal", "education"])),
		).toEqual(["region:personalvault", "empty-region:personal+education"]);
		expect(
			failed("plan-features-venn", {
				...plans,
				regions: [...plans.regions, { sets: ["personal", "education"], label: "Nothing here" }],
			}),
		).toEqual(["empty-region:personal+education"]);
	});

	it("reads the drawing: swapped labels, an item across an outline and overlapping text fail the scene checks", () => {
		const scene = renderDiagram(skills);
		expect(vennDrawnCheck(skills, scene).passed).toBe(true);
		expect(vennLayoutCheck(scene).passed).toBe(true);
		const text = (id: string) => scene.elements.find((element) => element.id === id)!;
		const swapped = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "venn:set:0:label"
					? { ...text("venn:set:1:label"), id: element.id }
					: element.id === "venn:set:1:label"
						? { ...text("venn:set:0:label"), id: element.id }
						: element,
			),
		};
		expect(vennDrawnCheck(skills, swapped).message).toContain("design label");
		// The Design-only item nudged onto the Engineering outline.
		const engineering = scene.elements.find((element) => element.id === "node:venn:set:1")!;
		const across = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "venn:region:0:item:0" &&
				element.type === "text" &&
				engineering.type === "node"
					? { ...element, x: engineering.x }
					: element,
			),
		};
		expect(vennDrawnCheck(skills, across).message).toContain('"Visual design" outside its region');
		expect(vennLayoutCheck(across).passed).toBe(false);
		const stacked = {
			...scene,
			elements: scene.elements.map((element) =>
				element.id === "venn:region:0:item:1" && element.type === "text"
					? { ...element, y: (text("venn:region:0:item:0") as { y: number }).y }
					: element,
			),
		};
		expect(vennLayoutCheck(stacked).message).toContain("overlaps");
	});

	it("serves the fixture model's diagram, meeting its count and every named set", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("plan-features-venn")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(plans);
	});

	it("grades a buildVennDiagram receipt from an MCP execute", () => {
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildVennDiagram",
			buildId: "build-1",
			normalizedSpec: { ...plans, type: undefined },
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"venn",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("plan-features-venn", candidate.diagram as VennDiagram)).toEqual([]);
	});
});
