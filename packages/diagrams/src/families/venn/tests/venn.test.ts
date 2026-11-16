// Positive fixtures deliberately unwrap Results: failure here is invalid test/story data, not user input.
import { Effect, Result } from "effect";
import { type CanvasSpec, SKETCHI_DIAGRAM_PALETTE } from "@sketchi/drawing";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { describe, expect, it } from "vitest";

import { CodeModeArtifactStorage, makeMemoryArtifactStorage } from "../../../build/artifacts";
import { buildVennDiagram } from "../../../build/builds";
import { CodeModeRuntimeEnvironment } from "../../../build/runtime";
import { buildResponse } from "../../../build/operation";
import {
	parseVennDiagram,
	VENN_COLORS,
	vennFixture,
	VennValidationIssueCodeSchema,
} from "../document";
import { vennStressFixtures } from "../fixtures";
import { layoutVennDiagram } from "../layout";
import { type VennLayoutIssue, vennLayoutIssues } from "../readout";
import {
	contrastRatio,
	renderVennDiagram,
	vennFills,
	vennLabelColor,
	vennRegionFill,
} from "../render";

const storage = makeMemoryArtifactStorage();
function build(spec: unknown) {
	return Effect.runPromise(
		buildVennDiagram({
			spec,
			options: {
				inlineArtifacts: ["scene", "excalidraw"],
				artifactFormats: ["scene", "excalidraw"],
			},
		}).pipe(
			buildResponse,
			Effect.provideService(CodeModeRuntimeEnvironment, {
				createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`,
			}),
			Effect.provideService(CodeModeArtifactStorage, storage),
		),
	);
}

describe("Venn diagrams", () => {
	it("build the documented spec into a valid Excalidraw file", async () => {
		const built = await build({
			title: "iOS vs Android",
			sets: [
				{ id: "ios", label: "iOS" },
				{ id: "android", label: "Android" },
			],
			regions: [
				{ sets: ["ios"], items: ["Live Activities", "Apple Pay"] },
				{ sets: ["android"], items: ["Google Pay"] },
				{ sets: ["ios", "android"], items: ["Push notifications", "Dark mode"] },
			],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const formats = new Map(built.artifact.formats.map((format) => [format.format, format.inline]));
		const excalidraw = formats.get("excalidraw") as Parameters<typeof validateExcalidrawScene>[0];
		expect(validateExcalidrawScene(excalidraw)).toEqual({ ok: true, issues: [] });
	});

	it("read sets named by label, members and whole memberships", async () => {
		const built = await build({
			title: "Plans",
			sets: [
				{ label: "Basic", items: ["SSO", "API access"] },
				{ label: "Pro", items: ["SSO", "API access", "Audit log"] },
			],
			regions: [{ sets: "Pro", members: ["Priority support"] }],
		});
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		expect(built.normalizedSpec.sets).toEqual([
			{ id: "Basic", label: "Basic" },
			{ id: "Pro", label: "Pro" },
		]);
		expect(built.normalizedSpec.regions).toEqual([
			{ sets: ["Pro"], items: ["Priority support", "Audit log"] },
			{ sets: ["Basic", "Pro"], items: ["SSO", "API access"] },
		]);
	});

	// Authors may give any hex color; the fuzz draws palette names only.
	it("keep ink readable on every blend, lightening dark set colors", () => {
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
		for (const color of Object.values(VENN_COLORS))
			expect(contrastRatio(vennLabelColor(surface, color), surface)).toBeGreaterThanOrEqual(4.5);
	});

	it("place with bounded work and repeatable scenes", () => {
		// Counts of placements tried, not wall clock: a regression in the search shows here.
		expect(layoutVennDiagram(vennStressFixtures.empty).work).toBeLessThan(2_000);
		expect(layoutVennDiagram(vennFixture).work).toBeLessThan(400_000);
		expect(layoutVennDiagram(vennStressFixtures.heavyCenter).work).toBeLessThan(600_000);
		expect(renderVennDiagram(vennFixture)).toEqual(renderVennDiagram(vennFixture));
	});
});

const twoSets = {
	id: "phones",
	title: "iOS and Android",
	type: "venn",
	sets: [
		{ id: "ios", label: "iOS" },
		{ id: "android", label: "Android" },
	],
};
const items = (count: number) => Array.from({ length: count }, (_, index) => `Item ${index}`);

/** One minimal bad diagram per code the validator owns. */
const bad: Record<string, Record<string, unknown>> = {
	venn_set_count: { sets: [{ id: "ios", label: "iOS" }] },
	duplicate_venn_set: {
		sets: [
			{ id: "ios", label: "iOS" },
			{ id: "ios", label: "IOS" },
		],
	},
	// An inherited object key is no palette name.
	invalid_venn_color: {
		sets: [{ id: "ios", label: "iOS", color: "constructor" }, twoSets.sets[1]],
	},
	unknown_venn_set: { regions: [{ sets: ["ios", "web"], items: ["Push"] }] },
	duplicate_venn_region: {
		regions: [
			{ sets: ["ios", "android"], items: ["Push"] },
			{ sets: ["android", "ios"], items: ["Maps"] },
		],
	},
	invalid_venn_region: { regions: [{ sets: ["ios", "ios"], items: ["Push"] }] },
	venn_text_too_long: { regions: [{ sets: ["ios"], items: ["x".repeat(61)] }] },
	venn_too_large: { regions: [{ sets: ["ios"], items: items(13) }] },
};

describe("Venn validator", () => {
	it("covers every issue code it can raise", () => {
		expect(new Set(Object.keys(bad))).toEqual(new Set(VennValidationIssueCodeSchema.literals));
	});

	it.each(Object.entries(bad))("raises %s for a minimal bad diagram", (code, change) => {
		const result = parseVennDiagram({ ...twoSets, ...change });
		if (Result.isSuccess(result)) return expect.fail("Expected an invalid diagram");
		const error = result.failure;
		if (error._tag !== "VennValidationError") return expect.fail(error.message);
		expect(error.issues.map((issue) => issue.code)).toContain(code);
	});
});

const scene = renderVennDiagram(vennFixture);
const find = (id: string) =>
	scene.elements.find((element) => element.id === id) as { x: number; y: number };
const moved = (id: string, to: string): CanvasSpec => ({
	...scene,
	elements: scene.elements.map((element) =>
		element.id === id ? { ...element, x: find(to).x, y: find(to).y } : element,
	),
});

/** One deliberately broken scene per layout issue the fuzz relies on. */
const broken: Record<VennLayoutIssue["code"], () => CanvasSpec> = {
	"circle-missing": () => ({
		...scene,
		elements: scene.elements.filter(
			(element) => element.id !== "node:venn:set:1" && element.id !== "node:venn:set:2",
		),
	}),
	"opaque-fill": () => ({
		...scene,
		elements: scene.elements.map((element) =>
			element.id === "node:venn:set:0:fill" ? { ...element, opacity: 100 } : element,
		),
	}),
	"text-outside-region": () => moved("venn:region:0:item:0", "venn:region:1:item:0"),
	"set-label-on-circle": () => moved("venn:set:0:label", "venn:region:0:item:0"),
	"text-overlap": () => moved("venn:region:0:item:1", "venn:region:0:item:0"),
};

describe("Venn layout readout", () => {
	it("passes the drawn scene", () => {
		expect(vennLayoutIssues(scene)).toEqual([]);
	});

	it.each(Object.entries(broken))("reports %s", (code, breakScene) => {
		expect(vennLayoutIssues(breakScene()).map((issue) => issue.code)).toContain(code);
	});
});
