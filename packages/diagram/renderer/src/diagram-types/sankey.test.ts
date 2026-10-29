import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	parseSankeyDiagram,
	sankeyFixture,
	sankeyStressFixtures,
	type SankeyDiagram,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import { layoutSankeyDiagram, SANKEY_MIN_BAND, SANKEY_SINK_COLOR } from "../sankey-layout.js";
import {
	readSankeyScene,
	sankeyCrossingPairs,
	sankeyLayoutIssues,
	sankeyWeightedCrossings,
} from "../sankey-readout.js";
import { isStructurallyValidSankeyMark, renderSankeyDiagram } from "../sankey.js";

const { cloudBudget, traffic, hiring, energy, slivers, longLabels, chain } = sankeyStressFixtures;

const aspect = (scene: { width: number; height: number }) =>
	(scene.width - 80) / (scene.height - 80);

/** A drawing's crossings weighted by the product of the crossing flows' values. */
function weightedCrossings(diagram: SankeyDiagram, scene = renderSankeyDiagram(diagram)) {
	const valueOf = new Map(
		diagram.links.map((link) => [`${link.source}>${link.target}`, link.value]),
	);
	return sankeyWeightedCrossings(scene, (band) => valueOf.get(`${band.source}>${band.target}`)!);
}

function bandOf(diagram: SankeyDiagram, source: string, target: string) {
	const band = readSankeyScene(renderSankeyDiagram(diagram)).bands.find(
		(entry) => entry.source === source && entry.target === target,
	);
	if (!band) throw new Error(`No band ${source} → ${target}.`);
	return band;
}

describe("Sankey renderer", () => {
	it("renders the fixture into a valid deterministic scene", () => {
		const scene = renderDiagram(sankeyFixture);
		expect(scene.diagramId).toBe("cloud-budget");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(sankeyLayoutIssues(scene)).toEqual([]);
		expect(renderDiagram(sankeyFixture)).toEqual(scene);
	});

	it.each(Object.entries(sankeyStressFixtures))("draws %s cleanly", (_name, diagram) => {
		const scene = renderSankeyDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(sankeyLayoutIssues(scene)).toEqual([]);
		expect(aspect(scene)).toBeLessThanOrEqual(2.45);
		// The ordering never crosses more band weight than the authored order does.
		expect(weightedCrossings(diagram, scene)).toBeLessThanOrEqual(
			layoutSankeyDiagram(diagram, { ordering: "authored" }).weightedCrossings,
		);
	});

	it("orders columns so less band weight crosses than in the authored order", () => {
		for (const diagram of [cloudBudget, traffic, energy, sankeyStressFixtures.dense]) {
			const optimized = layoutSankeyDiagram(diagram).weightedCrossings;
			expect(optimized).toBeLessThan(
				layoutSankeyDiagram(diagram, { ordering: "authored" }).weightedCrossings,
			);
			expect(weightedCrossings(diagram)).toBeCloseTo(optimized, 6);
		}
	});

	it("orders the same flows the same way in any unit", () => {
		// Weighted crossings scale with the square of the values; the ordering must not.
		for (const factor of [1e-8, 1e-3, 1e6]) {
			const scaled = {
				...cloudBudget,
				links: cloudBudget.links.map((link) => ({ ...link, value: link.value * factor })),
			};
			const optimized = layoutSankeyDiagram(scaled).weightedCrossings;
			expect(optimized, String(factor)).toBeLessThanOrEqual(
				layoutSankeyDiagram(scaled, { ordering: "authored" }).weightedCrossings,
			);
			expect(optimized / (factor * factor), String(factor)).toBeCloseTo(
				layoutSankeyDiagram(cloudBudget).weightedCrossings,
				3,
			);
		}
	});

	it("keeps the widest flows from crossing each other, accepting slivers instead", () => {
		// Engineering → Compute ($310k) crossed both Data Science → GPU ($220k) and → Object
		// storage ($60k) when the ordering counted crossings; weighted, only small flows cross.
		const pairs = sankeyCrossingPairs(renderSankeyDiagram(cloudBudget));
		const value = (band: { source: string; target: string }) =>
			cloudBudget.links.find((link) => link.source === band.source && link.target === band.target)!
				.value;
		expect(pairs.length).toBeGreaterThan(3);
		for (const pair of pairs)
			expect(value(pair.a) * value(pair.b), `${pair.a.target} × ${pair.b.target}`).toBeLessThan(
				7_000,
			);
		expect(weightedCrossings(cloudBudget)).toBeLessThanOrEqual(8_300);
	});

	it("places each node in its longest-path column, shared sinks in the last", () => {
		const { nodes } = readSankeyScene(renderSankeyDiagram(hiring));
		const left = (id: string) => nodes.find((node) => node.id === id)!.box.left;
		const columns = [...new Set(nodes.map((node) => node.box.left))].toSorted((a, b) => a - b);
		const column = (id: string) => columns.indexOf(left(id));
		expect(["applicants", "phone-screen", "onsite", "offer", "hired"].map(column)).toEqual([
			0, 1, 2, 3, 4,
		]);
		// Shared drop-offs, fed by several stages, align with the outcomes in the last column;
		// their long bands pass the columns between through their gaps.
		expect(column("rejected")).toBe(4);
		expect(column("withdrew")).toBe(4);
		// A drop-off fed by one stage stays beside it.
		const perStage = readSankeyScene(renderSankeyDiagram(sankeyStressFixtures.stageDropOffs)).nodes;
		const perStageLefts = [...new Set(perStage.map((node) => node.box.left))].toSorted(
			(a, b) => a - b,
		);
		const perStageColumn = (id: string) =>
			perStageLefts.indexOf(perStage.find((node) => node.id === id)!.box.left);
		expect(perStageColumn("rejected-at-résumé")).toBe(1);
		expect(perStageColumn("rejected-after-onsite")).toBe(3);
	});

	it("draws bands as wide as their values, with slivers at a small documented floor", () => {
		const big = bandOf(cloudBudget, "engineering", "compute");
		const scale = big.width / 310;
		for (const [source, target, value] of [
			["data-science", "gpu-training-clusters", 220],
			["engineering", "managed-databases", 120],
			["marketing", "content-delivery-network", 25],
		] as const)
			expect(bandOf(cloudBudget, source, target).width).toBeCloseTo(value * scale, 1);
		expect(SANKEY_MIN_BAND).toBe(3);
		for (const [source, target, value] of [
			["sales", "compute", 2],
			["finance", "managed-databases", 3],
			["marketing", "compute", 4],
		] as const) {
			const band = bandOf(cloudBudget, source, target);
			expect(band.width).toBeCloseTo(Math.max(value * scale, SANKEY_MIN_BAND), 1);
			// The value stays exact, and sits beside its band rather than on a leader.
			expect(band.text).toBe(`$${value}k`);
			expect(band.leader).toBeUndefined();
		}
	});

	it("draws a node at the larger of its inflow and outflow, labeled with that total", () => {
		const diagram = parseSankeyDiagram({
			id: "unbalanced",
			title: "Unbalanced",
			type: "sankey",
			nodes: [
				{ id: "in", label: "In" },
				{ id: "mid", label: "Middle" },
				{ id: "out", label: "Out" },
			],
			links: [
				{ source: "in", target: "mid", value: 100 },
				{ source: "mid", target: "out", value: 60 },
			],
		});
		const scene = renderSankeyDiagram(diagram);
		const { nodes, bands } = readSankeyScene(scene);
		const middle = nodes.find((node) => node.id === "mid")!;
		expect(middle.box.bottom - middle.box.top).toBeCloseTo(bands[0]!.width, 1);
		expect(bands[1]!.width).toBeCloseTo(bands[0]!.width * 0.6, 1);
		expect(middle.text).toBe("Middle\n100");
		expect(sankeyLayoutIssues(scene)).toEqual([]);
	});

	it("labels every node with its total and every flow with its value", () => {
		const scene = renderSankeyDiagram(traffic);
		const { nodes, bands } = readSankeyScene(scene);
		expect(nodes.find((node) => node.id === "home")?.text).toBe("Home\n5,300 visits");
		expect(nodes.find((node) => node.id === "bounced")?.text).toBe("Bounced\n11,200 visits");
		expect(bands).toHaveLength(traffic.links.length);
		// A word unit reads once on each total; flow values stay bare beside them.
		expect(
			bands.find((band) => band.source === "organic-search" && band.target === "home")?.text,
		).toBe("4,200");
		const energyBands = readSankeyScene(renderSankeyDiagram(energy)).bands;
		expect(
			energyBands.find((band) => band.target === "rejected-energy" && band.source === "electricity")
				?.text,
		).toBe("conversion losses\n17.4");
	});

	it("puts first-column labels left of their bars and the rest to the right", () => {
		const { nodes } = readSankeyScene(renderSankeyDiagram(traffic));
		for (const node of nodes) {
			if (["organic-search", "paid-ads", "social"].includes(node.id))
				expect(node.textBox!.right).toBeLessThanOrEqual(node.box.left);
			else expect(node.textBox!.left).toBeGreaterThanOrEqual(node.box.right);
		}
	});

	it("colors bands by source and draws nodes nothing leaves in gray", () => {
		const scene = renderSankeyDiagram(hiring);
		const fill = (id: string) =>
			scene.elements.find((element) => element.id === id && element.type === "node") as
				| { fillColor?: string }
				| undefined;
		expect(fill("node:sankey:link:applicants:rejected")?.fillColor).toBe(
			fill("node:sankey:node:applicants")?.fillColor,
		);
		expect(fill("node:sankey:node:hired")?.fillColor).toBe(SANKEY_SINK_COLOR);
		const sources = ["applicants", "phone-screen", "onsite", "offer"].map(
			(id) => fill(`node:sankey:node:${id}`)?.fillColor,
		);
		expect(new Set(sources).size).toBe(4);
		const custom = renderSankeyDiagram({
			...hiring,
			nodes: hiring.nodes.map((node) =>
				node.id === "rejected" ? { ...node, color: "#e34948" } : node,
			),
		});
		expect(
			(
				custom.elements.find((element) => element.id === "node:sankey:node:rejected") as {
					fillColor?: string;
				}
			).fillColor,
		).toBe("#e34948");
	});

	it("keeps band outlines translucent, square bars and every mark's role", () => {
		const scene = renderSankeyDiagram(sankeyFixture);
		for (const element of scene.elements) {
			if (element.type !== "node") continue;
			expect(element.rendererRole).toBe("sankey-mark");
			expect(isStructurallyValidSankeyMark(element)).toBe(true);
			if (element.shape === "polygon") expect(element.opacity).toBeLessThan(60);
			expect(element.points?.length ?? 0).toBeLessThanOrEqual(256);
		}
	});

	it("wraps long labels at word boundaries", () => {
		const { nodes } = readSankeyScene(renderSankeyDiagram(longLabels));
		for (const node of longLabels.nodes) {
			const text = nodes.find((entry) => entry.id === node.id)!.text!;
			expect(text.split("\n").slice(0, -1).join(" ")).toBe(node.label);
		}
	});

	it("handles eight stages, slivers and long labels within the aspect", () => {
		for (const diagram of [chain, slivers, longLabels]) {
			const scene = renderSankeyDiagram(diagram);
			expect(aspect(scene)).toBeLessThanOrEqual(2.45);
			expect(sankeyLayoutIssues(scene)).toEqual([]);
		}
	});

	it("draws authored newlines in labels, link labels and the title as line breaks", () => {
		const diagram = parseSankeyDiagram({
			id: "newlines",
			title: "Spend\nby team",
			type: "sankey",
			unit: "$k",
			nodes: [
				{ id: "data", label: "Data\nScience" },
				{ id: "gpu", label: "GPU\n\nclusters" },
			],
			links: [{ source: "data", target: "gpu", value: 220, label: "training\nruns" }],
		});
		const scene = renderSankeyDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(sankeyLayoutIssues(scene)).toEqual([]);
		const { nodes, bands } = readSankeyScene(scene);
		expect(nodes.find((node) => node.id === "data")?.text).toBe("Data\nScience\n$220k");
		expect(nodes.find((node) => node.id === "gpu")?.text).toBe("GPU\n\nclusters\n$220k");
		expect(bands[0]?.text).toBe("training\nruns\n$220k");
		const title = scene.elements.find((element) => element.id === "sankey:title");
		expect(title?.type === "text" && title.text).toBe("Spend\nby team");
	});

	it("draws nodes whose ids and labels name Object members", () => {
		const diagram = parseSankeyDiagram({
			id: "object-members",
			title: "Object members",
			type: "sankey",
			nodes: [
				{ id: "__proto__", label: "constructor" },
				{ id: "constructor", label: "__proto__" },
				{ id: "toString", label: "hasOwnProperty" },
			],
			links: [
				{ source: "__proto__", target: "constructor", value: 5 },
				{ source: "__proto__", target: "toString", value: 2 },
			],
		});
		const scene = renderSankeyDiagram(diagram);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(sankeyLayoutIssues(scene)).toEqual([]);
		expect(readSankeyScene(scene).nodes.map((node) => node.text)).toEqual([
			"constructor\n7",
			"__proto__\n5",
			"hasOwnProperty\n2",
		]);
	});

	it("reflows a crowded diagram, and reports the values still without a clear spot", () => {
		const teams = Array.from({ length: 8 }, (_, index) => ({
			id: `t${index}`,
			label: `Team ${index + 1}`,
		}));
		const services = Array.from({ length: 8 }, (_, index) => ({
			id: `s${index}`,
			label: `Service ${index + 1}`,
		}));
		const crowded = (label?: string) =>
			parseSankeyDiagram({
				id: "all-to-all",
				title: "All to all",
				type: "sankey",
				nodes: [...teams, ...services],
				links: teams.flatMap((team) =>
					services.map((service) => ({
						source: team.id,
						target: service.id,
						value: 1,
						...(label ? { label } : {}),
					})),
				),
			});
		// 64 flows, each labeled "Renewals and expansions and other income": no layout reads.
		const labeled = crowded("Renewals and expansions and other income");
		const layout = layoutSankeyDiagram(labeled);
		expect(layout.unplacedValues).toBeGreaterThan(0);
		expect(sankeyLayoutIssues(renderSankeyDiagram(labeled)).length).toBeGreaterThan(0);
		// The same flows without link labels reflow cleanly.
		const plain = crowded();
		expect(layoutSankeyDiagram(plain).unplacedValues).toBe(0);
		expect(sankeyLayoutIssues(renderSankeyDiagram(plain))).toEqual([]);
		// No maintained diagram needs a value drawn over another mark.
		for (const diagram of [sankeyFixture, ...Object.values(sankeyStressFixtures)])
			expect(layoutSankeyDiagram(diagram).unplacedValues, diagram.id).toBe(0);
	});

	it("labels a tiny flow's nodes with its exact total", () => {
		const tiny = parseSankeyDiagram({
			id: "tiny",
			title: "Tiny",
			type: "sankey",
			nodes: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
			links: [{ source: "a", target: "b", value: 1e-13 }],
		});
		const { nodes, bands } = readSankeyScene(renderSankeyDiagram(tiny));
		expect(nodes.map((node) => node.text)).toEqual(["A\n1e-13", "B\n1e-13"]);
		expect(bands[0]?.text).toBe("1e-13");
	});

	it("bounds the ordering work", () => {
		// Deterministic pair comparisons, not wall clock.
		expect(layoutSankeyDiagram(sankeyFixture).work).toBeLessThan(15_000);
		expect(layoutSankeyDiagram(energy).work).toBeLessThan(250_000);
		expect(layoutSankeyDiagram(sankeyStressFixtures.dense).work).toBeLessThan(4_200_000);
	});
});
