import { describe, expect, it } from "vitest";
import type { SankeyDiagram } from "@sketchi/diagram-core";
import { renderDiagram } from "@sketchi/diagram-renderer";
import { DiagramGenerationClient } from "@sketchi/diagram-generation";
import { Effect } from "effect";

import { evaluateScenarioDiagram } from "./evaluate.js";
import { FixtureGenerationClientLayer } from "./fixture-client.js";
import { candidateFromMcpResult } from "./mcp-results.js";
import { toDiagramGenerationPrompt } from "./prompt.js";
import { sankeyDrawnCheck, sankeyLayoutCheck, sankeyScenarios } from "./sankey-scenarios.js";

const scenario = (id: string) => sankeyScenarios.find((entry) => entry.id === id)!;
const failed = (id: string, diagram: SankeyDiagram) =>
	evaluateScenarioDiagram(scenario(id), diagram)
		.checks.filter((check) => !check.passed)
		.map((check) => check.id);
const budget = scenario("cloud-budget-sankey-v2").expectedDiagram;
const hiring = scenario("hiring-funnel-sankey-v2").expectedDiagram;
const withLink = (
	diagram: SankeyDiagram,
	source: string,
	target: string,
	change: (link: SankeyDiagram["links"][number]) => SankeyDiagram["links"][number],
): SankeyDiagram => ({
	...diagram,
	links: diagram.links.map((link) =>
		link.source === source && link.target === target ? change(link) : link,
	),
});

describe("prompt-grounded Sankey scenarios", () => {
	it("covers a sliver-heavy budget, crossing traffic, a funnel and a five-column energy flow", () => {
		expect(sankeyScenarios.map((entry) => entry.id)).toEqual([
			"cloud-budget-sankey-v2",
			"website-traffic-sankey-v2",
			"hiring-funnel-sankey-v2",
			"city-energy-sankey-v2",
		]);
		expect(scenario("cloud-budget-sankey-v2").difficulty).toBe("challenge");
		expect(
			budget.links
				.map((link) => link.value)
				.toSorted((a, b) => a - b)
				.slice(0, 3),
		).toEqual([2, 3, 4]);
		expect(scenario("website-traffic-sankey-v2").expectedDiagram.links).toHaveLength(15);
		expect(hiring.links).toHaveLength(10);
		// Every fact a check scores is in the prompt, as a pasted CSV row.
		for (const entry of sankeyScenarios) {
			const label = (id: string) =>
				entry.expectedDiagram.nodes.find((node) => node.id === id)!.label;
			for (const link of entry.expectedDiagram.links)
				expect(entry.prompt, `${entry.id} ${link.source}->${link.target}`).toContain(
					`${label(link.source)},${label(link.target)},${link.value}`,
				);
		}
	});

	it("passes its own expected diagram, including what the scene draws and its layout", () => {
		for (const entry of sankeyScenarios)
			expect(failed(entry.id, entry.expectedDiagram), entry.id).toEqual([]);
	});

	it("accepts other ids, link order and the same amounts in dollars", () => {
		const renamed: SankeyDiagram = {
			...budget,
			unit: "$",
			nodes: budget.nodes.map((node) => ({ ...node, id: `n-${node.id}` })),
			links: budget.links
				.map((link) => ({
					...link,
					source: `n-${link.source}`,
					target: `n-${link.target}`,
					value: link.value * 1_000,
				}))
				.toReversed(),
		};
		expect(failed("cloud-budget-sankey-v2", renamed)).toEqual([]);
		expect(failed("cloud-budget-sankey-v2", { ...budget, unit: "thousand dollars" })).toEqual([]);
		expect(failed("cloud-budget-sankey-v2", { ...budget, unit: "€k" })).toEqual(["unit"]);
		// Units naming Object members read as unknown units, never as accepted ones.
		for (const unit of ["constructor", "__proto__", "toString"])
			expect(failed("cloud-budget-sankey-v2", { ...budget, unit }), unit).toEqual(["unit"]);
	});

	it("accepts one drop-off per stage as the stated shared one", () => {
		const perStage: SankeyDiagram = {
			...hiring,
			nodes: [
				...hiring.nodes.filter((node) => node.id !== "rejected" && node.id !== "withdrew"),
				{ id: "rejected-applicants", label: "Rejected applicants" },
				{ id: "rejected-at-screen", label: "Rejected at phone screen" },
				{ id: "rejected-onsite", label: "Rejected after onsite" },
				{ id: "withdrew-screen", label: "Withdrew at phone screen" },
				{ id: "withdrew-onsite", label: "Withdrew after onsite" },
			],
			links: hiring.links.map((link) => {
				const target =
					link.target === "rejected"
						? {
								applicants: "rejected-applicants",
								"phone-screen": "rejected-at-screen",
								onsite: "rejected-onsite",
							}[link.source]!
						: link.target === "withdrew"
							? { "phone-screen": "withdrew-screen", onsite: "withdrew-onsite" }[link.source]!
							: link.target;
				return { ...link, target };
			}),
		};
		expect(failed("hiring-funnel-sankey-v2", perStage)).toEqual([]);
	});

	it.each([
		[
			"a changed value",
			() => withLink(budget, "engineering", "compute", (link) => ({ ...link, value: 301 })),
			["flow:engineering->compute"],
		],
		[
			"a flow into the wrong target",
			() =>
				withLink(budget, "sales", "compute", (link) => ({ ...link, target: "managed-databases" })),
			["flow:sales->compute"],
		],
		[
			"a reversed flow",
			() =>
				withLink(budget, "finance", "managed-databases", (link) => ({
					...link,
					source: "managed-databases",
					target: "finance",
				})),
			["flow:finance->managed-databases"],
		],
		[
			"a missing unit",
			() => {
				const { unit: _unit, ...rest } = budget;
				return rest;
			},
			["unit"],
		],
		[
			"a balancing Unallocated node",
			() => ({
				...budget,
				nodes: [...budget.nodes, { id: "unallocated", label: "Unallocated" }],
				links: [...budget.links, { source: "finance", target: "unallocated", value: 7 }],
			}),
			["nodes-exact", "flows-exact"],
		],
		[
			"a flow split into two",
			() => ({
				...budget,
				nodes: [...budget.nodes, { id: "compute-2", label: "Compute" }],
				links: [
					...budget.links.filter(
						(link) => !(link.source === "engineering" && link.target === "compute"),
					),
					{ source: "engineering", target: "compute", value: 200 },
					{ source: "engineering", target: "compute-2", value: 110 },
				],
			}),
			["flow:engineering->compute", "nodes-exact", "flows-exact"],
		],
		[
			"a missing node",
			() => ({
				...budget,
				nodes: budget.nodes.filter((node) => node.id !== "finance"),
				links: budget.links.filter((link) => link.source !== "finance"),
			}),
			["node:finance", "flow:finance->managed-databases", "flows-exact"],
		],
	])("fails %s on the stated check", (_, change, expected) => {
		expect(failed("cloud-budget-sankey-v2", change()).toSorted()).toEqual(expected.toSorted());
	});

	it("reads the drawing: a dropped band, a wrong width or a covered label fails the scene checks", () => {
		const scene = renderDiagram(budget);
		expect(sankeyDrawnCheck(budget, scene).passed).toBe(true);
		expect(sankeyLayoutCheck(budget, scene).passed).toBe(true);
		const dropped = {
			...scene,
			elements: scene.elements.filter(
				(element) => element.id !== "node:sankey:link:engineering:compute",
			),
		};
		expect(sankeyDrawnCheck(budget, dropped).message).toContain("engineering->compute band");
		const doubled = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "node" &&
				element.id === "node:sankey:link:marketing:content-delivery-network" &&
				element.points
					? {
							...element,
							points: element.points.map((point, index, all) =>
								index >= all.length / 2 ? { ...point, y: point.y + 9 } : point,
							) as typeof element.points,
						}
					: element,
			),
		};
		expect(sankeyDrawnCheck(budget, doubled).message).toContain("width");
		const relabeled = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" && element.id === "text:sankey:link:engineering:compute"
					? { ...element, text: "$301k" }
					: element,
			),
		};
		expect(sankeyDrawnCheck(budget, relabeled).message).toContain("engineering->compute value");
		const covered = {
			...scene,
			elements: scene.elements.map((element) =>
				element.type === "text" && element.id === "text:sankey:node:compute"
					? { ...element, x: element.x - 120 }
					: element,
			),
		};
		expect(sankeyLayoutCheck(budget, covered).passed).toBe(false);
	});

	it("serves the fixture model's diagram, meeting its count and every named node", async () => {
		const candidate = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* DiagramGenerationClient;
				return yield* client.generate({
					model: "fixture",
					prompt: toDiagramGenerationPrompt(scenario("website-traffic-sankey-v2")),
				});
			}).pipe(Effect.provide(FixtureGenerationClientLayer)),
		);
		expect(candidate.error).toBeUndefined();
		expect(candidate.diagram).toEqual(scenario("website-traffic-sankey-v2").expectedDiagram);
	});

	it("grades a buildSankey receipt from an MCP execute", () => {
		const receipt = {
			ok: true,
			status: "accepted",
			operation: "buildSankey",
			buildId: "build-1",
			normalizedSpec: { ...budget, type: undefined },
			quality: { accepted: true },
		};
		const candidate = candidateFromMcpResult(
			{ ok: true, result: { ok: true, status: "accepted", buildId: "build-1" }, builds: [receipt] },
			"sankey",
		);
		expect(candidate?.ok).toBe(true);
		if (!candidate?.ok) throw new Error("Expected the accepted receipt.");
		expect(failed("cloud-budget-sankey-v2", candidate.diagram as SankeyDiagram)).toEqual([]);
	});
});
