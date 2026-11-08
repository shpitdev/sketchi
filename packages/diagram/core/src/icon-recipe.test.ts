import { describe, expect, it } from "vitest";

import {
	ICON_RECIPE_LIMITS,
	iconRecipeByteLength,
	iconRecipeIssues,
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
});
