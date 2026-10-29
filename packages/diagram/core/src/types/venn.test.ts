import { describe, expect, it } from "vitest";

import { parseCanonicalDiagram } from "../diagram";
import {
	getVennValidationIssues,
	parseVennDiagram,
	resolveVennShorthand,
	VENN_COLORS,
	VennValidationError,
	vennDiagramType,
	vennFixture,
	vennRegionKey,
	vennSetColor,
} from "./venn";

const twoSets = {
	id: "phones",
	title: "iOS and Android",
	type: "venn",
	sets: [
		{ id: "ios", label: "iOS" },
		{ id: "android", label: "Android" },
	],
};

function issueCodes(input: Record<string, unknown>): string[] {
	try {
		parseVennDiagram(input);
		return [];
	} catch (error) {
		if (error instanceof VennValidationError) return error.issues.map((issue) => issue.code);
		throw error;
	}
}

describe("Venn diagram type", () => {
	it("has a typed fixture that satisfies the canonical diagram contract", () => {
		expect(vennFixture.type).toBe(vennDiagramType);
		expect(parseCanonicalDiagram(vennFixture)).toEqual(vennFixture);
	});

	it("defaults regions to none and keys a region by set order", () => {
		const diagram = parseVennDiagram(twoSets);
		expect(diagram.regions).toEqual([]);
		expect(vennRegionKey(diagram, { sets: ["android", "ios"] })).toEqual([0, 1]);
	});

	it("takes palette names and hex colors, and defaults to blue, orange and green", () => {
		expect(vennSetColor({}, 0)).toBe(VENN_COLORS.blue);
		expect(vennSetColor({}, 2)).toBe(VENN_COLORS.green);
		expect(vennSetColor({ color: "Violet" }, 0)).toBe(VENN_COLORS.violet);
		expect(vennSetColor({ color: "#AA3300" }, 1)).toBe("#aa3300");
		expect(
			issueCodes({
				...twoSets,
				sets: [
					{ id: "a", label: "A", color: "teal-ish" },
					{ id: "b", label: "B" },
				],
			}),
		).toEqual(["invalid_venn_color"]);
	});

	it("rejects inherited object keys as palette names", () => {
		for (const color of ["constructor", "__proto__", "toString"]) {
			expect(vennSetColor({ color }, 1)).toBe(VENN_COLORS.orange);
			expect(
				issueCodes({
					...twoSets,
					sets: [
						{ id: "a", label: "A", color },
						{ id: "b", label: "B" },
					],
				}),
				color,
			).toEqual(["invalid_venn_color"]);
		}
	});

	it("reads a lone region object as a list of one, and leaves other malformed regions to the schema", () => {
		const lone = parseVennDiagram(
			resolveVennShorthand({ ...twoSets, regions: { sets: ["ios"], items: ["Feature"] } }),
		);
		expect(lone.regions).toEqual([{ sets: ["ios"], items: ["Feature"] }]);
		for (const regions of ["Feature", null, 3])
			expect(
				() => parseVennDiagram(resolveVennShorthand({ ...twoSets, regions })),
				String(regions),
			).toThrow(/regions/u);
		// Whole memberships never replace stated regions that are malformed.
		expect(() =>
			parseVennDiagram(
				resolveVennShorthand({
					...twoSets,
					sets: [
						{ id: "ios", label: "iOS", items: ["Push"] },
						{ id: "android", label: "Android" },
					],
					regions: "Push",
				}),
			),
		).toThrow(/regions/u);
	});

	it("rejects one set or four", () => {
		expect(issueCodes({ ...twoSets, sets: [{ id: "a", label: "A" }] })).toEqual(["venn_set_count"]);
		expect(
			issueCodes({
				...twoSets,
				sets: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() })),
			}),
		).toEqual(["venn_set_count"]);
	});

	it("returns a repair hint with every semantic issue", () => {
		try {
			parseVennDiagram({
				...twoSets,
				sets: [
					{ id: "ios", label: "iOS", color: "plaid" },
					{ id: "ios", label: "ios" },
				],
				regions: [{ sets: ["web"], items: ["Push"], count: 2, label: "y".repeat(41) }],
			});
			expect.unreachable();
		} catch (error) {
			if (!(error instanceof VennValidationError)) throw error;
			expect(error.issues.length).toBeGreaterThanOrEqual(5);
			for (const issue of error.issues) expect(issue.hint.length).toBeGreaterThan(10);
		}
	});

	it("names repeated sets, unknown sets, repeated regions, and items with counts", () => {
		expect(
			issueCodes({
				...twoSets,
				sets: [
					{ id: "ios", label: "iOS" },
					{ id: "ios", label: "IOS" },
				],
			}),
		).toEqual(["duplicate_venn_set", "duplicate_venn_set"]);
		expect(
			issueCodes({ ...twoSets, regions: [{ sets: ["ios", "web"], items: ["Push"] }] }),
		).toEqual(["unknown_venn_set"]);
		expect(
			issueCodes({
				...twoSets,
				regions: [
					{ sets: ["ios", "android"], items: ["Push"] },
					{ sets: ["android", "ios"], items: ["Maps"] },
				],
			}),
		).toEqual(["duplicate_venn_region"]);
		expect(
			issueCodes({ ...twoSets, regions: [{ sets: ["ios", "ios"], items: ["Push"] }] }),
		).toEqual(["invalid_venn_region"]);
		expect(
			issueCodes({ ...twoSets, regions: [{ sets: ["ios"], items: ["Push"], count: 3 }] }),
		).toEqual(["invalid_venn_region"]);
	});

	it("caps text length and item counts", () => {
		expect(
			issueCodes({ ...twoSets, regions: [{ sets: ["ios"], items: ["x".repeat(61)] }] }),
		).toEqual(["venn_text_too_long"]);
		expect(
			issueCodes({
				...twoSets,
				regions: [
					{ sets: ["ios"], items: Array.from({ length: 13 }, (_, index) => `Item ${index}`) },
				],
			}),
		).toEqual(["venn_too_large"]);
		expect(
			issueCodes({
				...twoSets,
				regions: [
					{ sets: ["ios"], items: Array.from({ length: 12 }, (_, index) => `A ${index}`) },
					{ sets: ["android"], items: Array.from({ length: 12 }, (_, index) => `B ${index}`) },
					{
						sets: ["ios", "android"],
						items: Array.from({ length: 12 }, (_, index) => `C ${index}`),
					},
				],
			}).length,
		).toBe(0);
		const issues = getVennValidationIssues({
			...parseVennDiagram(twoSets),
			sets: [...twoSets.sets, { id: "web", label: "Web" }],
			regions: [
				{ sets: ["ios"], items: Array.from({ length: 12 }, (_, index) => `A ${index}`) },
				{ sets: ["android"], items: Array.from({ length: 12 }, (_, index) => `B ${index}`) },
				{ sets: ["web"], items: Array.from({ length: 12 }, (_, index) => `C ${index}`) },
				{ sets: ["ios", "web"], items: Array.from({ length: 5 }, (_, index) => `D ${index}`) },
			],
		});
		expect(issues.map((issue) => issue.code)).toEqual(["venn_too_large"]);
		expect(issues[0]?.hint).toMatch(/counts/u);
	});

	it("reads labels as set references, string sets, members, and whole memberships", () => {
		const resolved = parseVennDiagram(
			resolveVennShorthand({
				id: "plans",
				title: "Plan features",
				type: "venn",
				sets: [
					{ label: "Basic", items: ["SSO", "API access"] },
					{ label: "Pro", items: ["sso", "API access", "Audit log"] },
					"Enterprise",
				],
				regions: [{ in: ["Enterprise", "Pro"], members: ["Audit export"] }],
			}),
		);
		expect(resolved.sets).toEqual([
			{ id: "Basic", label: "Basic" },
			{ id: "Pro", label: "Pro" },
			{ id: "Enterprise", label: "Enterprise" },
		]);
		expect(resolved.regions).toEqual([
			{ sets: ["Enterprise", "Pro"], items: ["Audit export"] },
			{ sets: ["Basic", "Pro"], items: ["SSO", "API access"] },
			{ sets: ["Pro"], items: ["Audit log"] },
		]);
	});

	it("merges whole memberships into a stated region of the same sets", () => {
		const resolved = parseVennDiagram(
			resolveVennShorthand({
				...twoSets,
				sets: [
					{ id: "ios", label: "iOS", items: ["Push", "Widgets"] },
					{ id: "android", label: "Android", items: ["Push"] },
				],
				regions: [{ sets: ["iOS", "Android"], label: "Both", items: ["push", "Maps"] }],
			}),
		);
		expect(resolved.regions).toEqual([
			{ sets: ["ios", "android"], label: "Both", items: ["push", "Maps"] },
			{ sets: ["ios"], items: ["Widgets"] },
		]);
	});
});
