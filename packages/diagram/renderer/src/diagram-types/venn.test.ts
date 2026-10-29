import { describe, expect, it } from "vitest";

import {
	getCanvasValidationIssues,
	parseVennDiagram,
	SKETCHI_DIAGRAM_PALETTE,
	VENN_COLORS,
	vennFixture,
	vennStressFixtures,
	type VennDiagram,
} from "@sketchi/diagram-core";

import { renderDiagram } from "../diagram.js";
import type { RenderedDiagramScene, TextSceneElement } from "../scene.js";
import {
	contrastRatio,
	renderVennDiagram,
	VENN_FILL_OPACITY,
	vennFills,
	vennLabelColor,
	vennRegionFill,
} from "../venn.js";
import { layoutVennDiagram } from "../venn-layout.js";
import { readVennScene, vennLayoutIssues, vennTextLineBoxes } from "../venn-readout.js";

const texts = (scene: RenderedDiagramScene) =>
	scene.elements.filter((element): element is TextSceneElement => element.type === "text");
const text = (scene: RenderedDiagramScene, id: string) =>
	texts(scene).find((element) => element.id === id)!;
const element = (scene: RenderedDiagramScene, id: string) =>
	scene.elements.find((candidate) => candidate.id === id)!;

const all: VennDiagram[] = [vennFixture, ...Object.values(vennStressFixtures)];

describe("Venn renderer contract", () => {
	it("renders the fixture into a valid deterministic scene", () => {
		const scene = renderDiagram(vennFixture);
		expect(scene.diagramId).toBe("product-team-skills");
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(renderDiagram(vennFixture)).toEqual(scene);
	});

	it("draws every set, label, region label and item, each region's text inside its region", () => {
		for (const diagram of all) {
			const scene = renderVennDiagram(diagram);
			expect(getCanvasValidationIssues(scene), diagram.id).toEqual([]);
			expect(vennLayoutIssues(scene), diagram.id).toEqual([]);
			const readout = readVennScene(scene);
			expect(readout.sets.map((set) => set.label)).toEqual(diagram.sets.map((set) => set.label));
			for (const region of diagram.regions) {
				const key = region.sets
					.map((id) => diagram.sets.findIndex((set) => set.id === id))
					.sort((a, b) => a - b);
				const drawn = readout.regions.find((entry) => entry.key.join() === key.join());
				expect(drawn?.items, `${diagram.id} ${key.join("+")}`).toEqual(region.items ?? []);
				expect(drawn?.label).toBe(region.label);
				expect(drawn?.count).toBe(region.count?.toLocaleString("en-US"));
			}
		}
	});

	it("keeps the standard symmetric arrangement of equal circles", () => {
		const two = readVennScene(renderVennDiagram(vennStressFixtures.twoSets)).sets.map(
			(set) => set.circle,
		);
		expect(two[0]!.r).toBe(two[1]!.r);
		expect(two[0]!.y).toBe(two[1]!.y);
		const three = readVennScene(renderVennDiagram(vennFixture)).sets.map((set) => set.circle);
		const distance = (a: number, b: number) =>
			Math.hypot(three[a]!.x - three[b]!.x, three[a]!.y - three[b]!.y);
		expect(new Set(three.map((circle) => circle.r)).size).toBe(1);
		expect(distance(0, 1)).toBeCloseTo(distance(1, 2), 0);
		expect(distance(0, 1)).toBeCloseTo(distance(0, 2), 0);
		expect(three[2]!.x).toBeCloseTo((three[0]!.x + three[1]!.x) / 2, 1);
		// Overlapping, never nested or apart.
		expect(distance(0, 1)).toBeGreaterThan(three[0]!.r * 0.5);
		expect(distance(0, 1)).toBeLessThan(three[0]!.r * 1.5);
	});

	it("labels the upper sets above their circles, over their own part, and a third below", () => {
		const scene = renderVennDiagram(vennFixture);
		const circles = readVennScene(scene).sets.map((set) => set.circle);
		const top = Math.min(...circles.map((circle) => circle.y - circle.r));
		const [design, engineering, product] = [0, 1, 2].map((index) =>
			vennTextLineBoxes(text(scene, `venn:set:${index}:label`)).at(-1)!,
		);
		expect(design!.bottom).toBeLessThan(top);
		expect(engineering!.bottom).toBeLessThan(top);
		expect(product!.top).toBeGreaterThan(circles[2]!.y + circles[2]!.r);
		// Over each set's own part: left of its centre for the left set, right for the right.
		expect((design!.left + design!.right) / 2).toBeLessThan(circles[0]!.x);
		expect((engineering!.left + engineering!.right) / 2).toBeGreaterThan(circles[1]!.x);
		expect(text(scene, "venn:set:0:label").textColor).toBe(
			vennLabelColor(SKETCHI_DIAGRAM_PALETTE.card, VENN_COLORS.blue),
		);
	});

	it("keeps lines whole when the region has room, and centres a lone item in its crescent", () => {
		const phones = renderVennDiagram(vennStressFixtures.twoSets);
		for (const [index, item] of ["iMessage", "AirDrop", "Face ID", "Apple Pay"].entries())
			expect(text(phones, `venn:region:0:item:${index}`).text).toBe(item);
		const lens = renderVennDiagram(vennStressFixtures.heavyLens);
		const [python, javascript] = readVennScene(lens).sets.map((set) => set.circle);
		expect(text(lens, "venn:region:0:item:0").y).toBeCloseTo(python!.y, 0);
		expect(text(lens, "venn:region:1:item:0").y).toBeCloseTo(javascript!.y, 0);
		// Mirrored regions mirror their text.
		const middle = (python!.x + javascript!.x) / 2;
		expect(middle - text(lens, "venn:region:0:item:0").x).toBeGreaterThan(python!.r * 0.6);
		expect(text(lens, "venn:region:1:item:0").x - middle).toBeGreaterThan(python!.r * 0.6);
	});

	it("wraps long items at word boundaries, never inside a word", () => {
		const scene = renderVennDiagram(vennStressFixtures.heavySingles);
		const source = vennStressFixtures.heavySingles.regions.flatMap((region) => region.items ?? []);
		const words = new Set(source.flatMap((item) => item.split(" ")));
		for (const element of texts(scene).filter((entry) => entry.id.includes(":item:"))) {
			expect(source).toContain(element.text.split("\n").join(" "));
			for (const word of element.text.split(/\s+/u)) expect(words.has(word), word).toBe(true);
		}
		expect(text(scene, "venn:region:0:item:0").text.split("\n").length).toBeGreaterThan(1);
	});

	it("never breaks a long Latin token, though wide glyphs may break between them", () => {
		const scene = renderVennDiagram(
			parseVennDiagram({
				id: "tokens",
				title: "Endpoints",
				type: "venn",
				sets: [
					{ id: "a", label: "Public" },
					{ id: "b", label: "Partner" },
				],
				regions: [
					{ sets: ["a", "b"], items: ["Uses api.example.com/v2/organizations/members daily"] },
					{ sets: ["a"], items: ["東京都千代田区丸の内一丁目九番一号"] },
				],
			}),
		);
		expect(vennLayoutIssues(scene)).toEqual([]);
		expect(text(scene, "venn:region:0+1:item:0").text.split(/\s+/u)).toContain(
			"api.example.com/v2/organizations/members",
		);
	});

	it("keeps authored line breaks in items and region labels as line boundaries", () => {
		const scene = renderVennDiagram(
			parseVennDiagram({
				id: "breaks",
				title: "Authored breaks",
				type: "venn",
				sets: [
					{ id: "a", label: "Alpha" },
					{ id: "b", label: "Beta" },
				],
				regions: [
					{ sets: ["a"], items: ["First line\nSecond line", "Plain item"] },
					{ sets: ["a", "b"], label: "Shared\nground", items: ["Both"] },
				],
			}),
		);
		expect(getCanvasValidationIssues(scene)).toEqual([]);
		expect(vennLayoutIssues(scene)).toEqual([]);
		// The authored break stays a line boundary; words may still wrap within each line.
		const item = text(scene, "venn:region:0:item:0").text.split("\n");
		expect(item.join(" ")).toBe("First line Second line");
		expect(item.some((line) => line.startsWith("Second"))).toBe(true);
		expect(text(scene, "venn:region:0+1:label").text).toBe("Shared\nground");
	});

	it("grows the circles until a heavy region fits, and keeps an empty diagram readable", () => {
		const empty = layoutVennDiagram(vennStressFixtures.empty);
		const fixture = layoutVennDiagram(vennFixture);
		const heavy = layoutVennDiagram(vennStressFixtures.heavyCenter);
		expect(empty.radius).toBe(120);
		expect(fixture.radius).toBeGreaterThanOrEqual(empty.radius);
		expect(heavy.radius).toBeGreaterThan(fixture.radius);
		// A heavy middle pulls the circles together to widen it.
		expect(heavy.separation).toBeLessThan(1);
	});

	it("reads no wider than 2.45 to 1 and no taller than wide by much", () => {
		for (const diagram of all) {
			const scene = renderVennDiagram(diagram);
			expect(scene.width / scene.height, diagram.id).toBeLessThanOrEqual(2.45);
			expect(scene.height / scene.width, diagram.id).toBeLessThanOrEqual(1.4);
		}
	});

	it("fills each set translucently and groups each set, and each region's text", () => {
		const scene = renderVennDiagram(vennFixture);
		expect(element(scene, "node:venn:set:0:fill")).toMatchObject({
			type: "node",
			shape: "ellipse",
			rendererRole: "venn-set",
			opacity: VENN_FILL_OPACITY,
			fillStyle: "solid",
			strokeColor: VENN_COLORS.blue,
			groupIds: ["venn:set:0"],
		});
		expect(element(scene, "node:venn:set:0")).toMatchObject({
			shape: "ellipse",
			rendererRole: "venn-set",
			strokeColor: VENN_COLORS.blue,
			strokeWidth: 2,
			groupIds: ["venn:set:0"],
		});
		expect(element(scene, "node:venn:set:0")).not.toHaveProperty("fillColor");
		expect(text(scene, "venn:set:0:label").groupIds).toEqual(["venn:set:0"]);
		expect(text(scene, "venn:region:0+1+2:label").groupIds).toEqual(["venn:region:0+1+2"]);
		expect(text(scene, "venn:region:0+1+2:item:0").groupIds).toEqual(["venn:region:0+1+2"]);
		// Fills sit under every outline, and text over both.
		const order = scene.zOrder;
		const lastFill = Math.max(
			...[0, 1, 2].map((index) => order.indexOf(`node:venn:set:${index}:fill`)),
		);
		const firstOutline = Math.min(
			...[0, 1, 2].map((index) => order.indexOf(`node:venn:set:${index}`)),
		);
		expect(lastFill).toBeLessThan(firstOutline);
		expect(order.indexOf("venn:set:0:label")).toBeGreaterThan(firstOutline);
	});

	it("keeps ink readable on every blend, lightening dark set colors", () => {
		const surface = SKETCHI_DIAGRAM_PALETTE.card;
		for (const colors of [
			[VENN_COLORS.blue, VENN_COLORS.orange, VENN_COLORS.green],
			["#000000", "#222222", "#1a1712"],
			[VENN_COLORS.violet, VENN_COLORS.red, VENN_COLORS.gray],
		]) {
			const fills = vennFills(surface, colors);
			for (const key of [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]])
				expect(
					contrastRatio(SKETCHI_DIAGRAM_PALETTE.ink, vennRegionFill(surface, fills, key)),
				).toBeGreaterThanOrEqual(7);
		}
		// Palette colors fill with their own hue.
		expect(vennFills(surface, [VENN_COLORS.blue, VENN_COLORS.orange])).toEqual([
			VENN_COLORS.blue,
			VENN_COLORS.orange,
		]);
		for (const color of Object.values(VENN_COLORS))
			expect(contrastRatio(vennLabelColor(surface, color), surface)).toBeGreaterThanOrEqual(4.5);
	});

	it("draws a region whatever order its sets are listed in", () => {
		const forward = renderVennDiagram(vennStressFixtures.twoSets);
		const reversed = renderVennDiagram(
			parseVennDiagram({
				...vennStressFixtures.twoSets,
				regions: vennStressFixtures.twoSets.regions.map((region) => ({
					...region,
					sets: [...region.sets].reverse(),
				})),
			}),
		);
		expect(reversed).toEqual(forward);
	});

	it("places with bounded, deterministic work", () => {
		// Counts of placements tried, not wall clock: a regression in the search shows here.
		expect(layoutVennDiagram(vennStressFixtures.empty).work).toBeLessThan(2_000);
		expect(layoutVennDiagram(vennFixture).work).toBeLessThan(400_000);
		expect(layoutVennDiagram(vennStressFixtures.heavyCenter).work).toBeLessThan(600_000);
		expect(layoutVennDiagram(vennFixture).work).toBe(layoutVennDiagram(vennFixture).work);
	});
});

describe("Venn empty regions", () => {
	it("draws a region stated empty as empty: no items, an empty list or a count of 0", () => {
		const base = {
			id: "empty-region",
			title: "Plans",
			type: "venn",
			sets: [
				{ id: "personal", label: "Personal" },
				{ id: "education", label: "Education" },
			],
		} as const;
		const omitted = renderVennDiagram(
			parseVennDiagram({ ...base, regions: [{ sets: ["personal"], items: ["Vault"] }] }),
		);
		for (const empty of [{ items: [] }, { count: 0 }]) {
			const scene = renderVennDiagram(
				parseVennDiagram({
					...base,
					regions: [
						{ sets: ["personal"], items: ["Vault"] },
						{ sets: ["personal", "education"], ...empty },
					],
				}),
			);
			expect(scene.elements.filter((element) => element.id.startsWith("venn:region:0+1"))).toEqual(
				[],
			);
			expect(scene).toEqual(omitted);
		}
		// Where regions hold counts, a 0 is data and is drawn.
		const counted = renderVennDiagram(
			parseVennDiagram({
				...base,
				regions: [
					{ sets: ["personal"], count: 4 },
					{ sets: ["personal", "education"], count: 0 },
				],
			}),
		);
		expect(
			readVennScene(counted).regions.find((region) => region.key.join() === "0,1")?.count,
		).toBe("0");
		// A diagram of counts alone draws every count, though all are 0.
		const zeros = renderVennDiagram(
			parseVennDiagram({
				...base,
				regions: [
					{ sets: ["personal"], count: 0 },
					{ sets: ["personal", "education"], count: 0 },
				],
			}),
		);
		expect(
			readVennScene(zeros).regions.map((region) => [region.key.join("+"), region.count]),
		).toEqual([
			["0", "0"],
			["0+1", "0"],
		]);
	});
});
