import { describe, expect, it } from "vitest";

import {
	ICON_RECIPE_LIMITS,
	iconRecipeByteLength,
	iconRecipeFitIssues,
	iconRecipeIssues,
	iconRecipeTextBox,
	iconRecipeTextFitSize,
	isIconRecipe,
	type IconRecipe,
} from "./icon-recipe";

const DATABASE: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 5, rx: 9, ry: 3 },
		{
			kind: "stroke",
			smooth: true,
			points: [
				[3, 5],
				[3, 19],
				[12, 22],
				[21, 19],
				[21, 5],
			],
		},
		{ kind: "rect", x: 2, y: 8, width: 20, height: 8, rounded: true, fill: "ink", stroke: "none" },
		{
			kind: "arrow",
			points: [
				[1, 12],
				[6, 12],
			],
			pen: 2,
		},
		{ kind: "text", cx: 12, cy: 12, text: "db", size: 8, color: "#336791" },
		{ kind: "ellipse", cx: 12, cy: 12, rx: 2, ry: 2, stroke: "none", fill: "paper" },
	],
};

describe("icon recipes", () => {
	it("accepts every part kind on the grid", () => {
		expect(iconRecipeIssues(DATABASE)).toEqual([]);
		expect(isIconRecipe(DATABASE)).toBe(true);
	});

	it("names each problem with its path", () => {
		expect(
			iconRecipeIssues({
				parts: [
					{ kind: "blob" },
					{ kind: "ellipse", cx: 12, cy: 40, rx: 0, ry: 3 },
					{ kind: "stroke", points: [[1, 1]], stroke: "red" },
					{ kind: "rect", x: 1, y: 1, width: 4, height: 4, stroke: "none", extra: 1 },
					{ kind: "text", cx: 12, cy: 12, text: "far too long", size: 8 },
				],
				scale: 2,
			}),
		).toEqual([
			"recipe.scale is not a recipe field.",
			"recipe.parts[0].kind must be one of rect, ellipse, stroke, arrow, text.",
			"recipe.parts[1].cx and cy must sit on the grid.",
			"recipe.parts[1].rx and ry must be positive grid lengths.",
			"recipe.parts[2].stroke must be ink, paper, none, a lowercase #rrggbb color.",
			"recipe.parts[2].points must hold 2-48 points.",
			"recipe.parts[3].extra is not a rect field.",
			"recipe.parts[3].stroke none needs a fill.",
			"recipe.parts[4].text must be 1-8 characters.",
		]);
	});

	it("bounds the parts an icon may draw", () => {
		const dot = { kind: "ellipse", cx: 12, cy: 12, rx: 1, ry: 1 } as const;
		expect(iconRecipeIssues({ parts: [] })).toEqual(["recipe.parts must hold 1-8 parts."]);
		expect(
			iconRecipeIssues({
				parts: Array.from({ length: ICON_RECIPE_LIMITS.maxParts + 1 }, () => dot),
			}),
		).toEqual(["recipe.parts must hold 1-8 parts."]);
		expect(iconRecipeIssues(null)).toEqual(["recipe must be an object with a parts array."]);
	});

	it("measures serialized bytes for the scene budget", () => {
		expect(iconRecipeByteLength(DATABASE)).toBe(JSON.stringify(DATABASE).length);
	});

	it("finds a word that would clip past the grid, across or down", () => {
		const wide: IconRecipe = {
			parts: [{ kind: "text", cx: 12, cy: 10.5, text: "tinyhttp", size: 9 }],
		};
		// Still drawable, so a stored recipe keeps loading; only making or accepting one checks the fit.
		expect(isIconRecipe(wide)).toBe(true);
		expect(iconRecipeFitIssues(wide)).toEqual([expect.stringContaining('"tinyhttp"')]);
		const box = iconRecipeTextBox({ kind: "text", cx: 12, cy: 10.5, text: "tinyhttp", size: 9 });
		expect(box.right - box.left).toBeGreaterThan(24);
		const low: IconRecipe = { parts: [{ kind: "text", cx: 12, cy: 22, text: "py", size: 8 }] };
		expect(iconRecipeFitIssues(low)).toHaveLength(1);
	});

	it("keeps a word inside the rounded frame around it, corners included", () => {
		const frame = {
			kind: "rect",
			x: 2.5,
			y: 2.5,
			width: 19,
			height: 19,
			rounded: true,
			pen: 2,
		} as const;
		const crowded: IconRecipe = {
			parts: [frame, { kind: "text", cx: 12, cy: 7.5, text: "CACHE", size: 5.5 }],
		};
		// Inside the frame's straight sides, but into the rounded corner at that height.
		const box = iconRecipeTextBox(crowded.parts[1] as never);
		expect(box.left).toBeGreaterThan(2.5 + 0.5);
		expect(box.right).toBeLessThan(21.5 - 0.5);
		expect(iconRecipeFitIssues(crowded)).toEqual([
			expect.stringContaining(
				'"CACHE" spans 3.3 to 20.6 across and runs into the frame drawn by parts[0]',
			),
		]);
		expect(iconRecipeTextFitSize(crowded, 1)).toBe(5);
		const lower: IconRecipe = {
			parts: [frame, { kind: "text", cx: 12, cy: 8.5, text: "CACHE", size: 5.25 }],
		};
		expect(iconRecipeFitIssues(lower)).toEqual([]);
	});

	it("treats an open stroke around a word as its frame", () => {
		const corner: IconRecipe = {
			parts: [
				{
					kind: "stroke",
					points: [
						[13, 21.5],
						[2.5, 21.5],
						[2.5, 2.5],
						[21.5, 2.5],
						[21.5, 10],
					],
					pen: 2,
				},
				{ kind: "text", cx: 9, cy: 8, text: "Aurora", size: 4.5 },
			],
		};
		expect(iconRecipeFitIssues(corner)).toEqual([expect.stringContaining('"Aurora"')]);
		expect(iconRecipeTextFitSize(corner, 1)).toBeUndefined();
		expect(iconRecipeFitIssues(corner)[0]).toContain("drop the frame");
		const moved = {
			parts: [corner.parts[0]!, { ...(corner.parts[1] as object), cx: 10.5, size: 4.25 }],
		};
		expect(iconRecipeFitIssues(moved as IconRecipe)).toEqual([]);
	});

	it("follows the curve a smooth stroke draws, not the chords between its points", () => {
		const diamond = (smooth: boolean): IconRecipe => ({
			parts: [
				{
					kind: "stroke",
					points: [
						[12, 2],
						[22, 12],
						[12, 22],
						[2, 12],
					],
					closed: true,
					smooth,
				},
				{ kind: "text", cx: 12, cy: 12, text: "CACHE", size: 5 },
			],
		});
		// The curve bows out past the straight sides, leaving the word room.
		expect(iconRecipeFitIssues(diamond(false))).toHaveLength(1);
		expect(iconRecipeFitIssues(diamond(true))).toEqual([]);
	});

	it("lets a word fill a badge drawn in one color, but not cross it", () => {
		const badge = (size: number): IconRecipe => ({
			parts: [
				{
					kind: "rect",
					x: 3,
					y: 14,
					width: 18,
					height: 6,
					rounded: true,
					stroke: "#11567f",
					fill: "#11567f",
				},
				{ kind: "text", cx: 12, cy: 17, text: "AVRO", size, color: "paper" },
			],
		});
		expect(iconRecipeFitIssues(badge(4.5))).toEqual([]);
		expect(iconRecipeFitIssues(badge(6))).toHaveLength(1);
	});

	it("judges a word only by the outline left visible around it", () => {
		const layered: IconRecipe = {
			parts: [
				// A backdrop whose edge runs under the square the word sits on.
				{
					kind: "stroke",
					points: [
						[3, 12],
						[13, 8],
						[8, 20],
					],
					closed: true,
					stroke: "#d249fc",
					fill: "#d249fc",
				},
				{ kind: "rect", x: 5, y: 5, width: 14, height: 14, fill: "ink" },
				{ kind: "text", cx: 11, cy: 9.5, text: "PS", size: 6, color: "paper" },
			],
		};
		expect(iconRecipeFitIssues(layered)).toEqual([]);
		// The same word with nothing over the backdrop's edge runs into it.
		const bare = { parts: [layered.parts[0]!, layered.parts[2]!] };
		expect(iconRecipeFitIssues(bare)).toHaveLength(1);
	});

	it("leaves a word beside a shape alone", () => {
		const beside: IconRecipe = {
			parts: [
				{ kind: "ellipse", cx: 6, cy: 12, rx: 4, ry: 4 },
				{ kind: "text", cx: 16, cy: 12, text: "db", size: 6 },
			],
		};
		expect(iconRecipeFitIssues(beside)).toEqual([]);
	});
});
