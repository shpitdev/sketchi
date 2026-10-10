import { assert, describe, it } from "@effect/vitest";

import { withSelectorSafeImageIds } from "./render-image-ids.js";

type DrawingElement = {
	readonly id: string;
	readonly type: string;
	readonly [key: string]: unknown;
};

describe("render-only image ids", () => {
	it("rewrites selector-unsafe image ids uniquely and follows references", () => {
		const arrow = {
			id: "arrow",
			type: "arrow",
			startBinding: { elementId: "node:a:icon", focus: 0, gap: 4 },
			endBinding: { elementId: "node:a", focus: 0, gap: 4 },
		};
		const elements: DrawingElement[] = [
			{
				id: "node:a",
				type: "rectangle",
				boundElements: [{ id: "arrow", type: "arrow" }],
			},
			{
				id: "node:a:icon",
				type: "image",
				boundElements: [{ id: "arrow", type: "arrow" }],
			},
			{ id: "node-a-icon", type: "image" },
			arrow,
		];
		const rendered = withSelectorSafeImageIds(elements);

		assert.deepStrictEqual(
			rendered.map((element) => element.id),
			["node:a", "node-a-icon-2", "node-a-icon", "arrow"],
		);
		assert.deepStrictEqual(rendered[3], {
			...arrow,
			startBinding: { elementId: "node-a-icon-2", focus: 0, gap: 4 },
		});
		// Non-image ids and the input drawing stay as they were.
		assert.strictEqual(rendered[0]?.id, "node:a");
		assert.strictEqual(elements[1]?.id, "node:a:icon");
	});

	it("returns safe drawings unchanged", () => {
		const elements = [
			{ id: "node-a-icon", type: "image" },
			{ id: "node:a", type: "rectangle" },
		];
		assert.deepStrictEqual(withSelectorSafeImageIds(elements), elements);
	});
});
