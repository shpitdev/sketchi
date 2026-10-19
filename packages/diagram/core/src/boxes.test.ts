import { describe, expect, it } from "vitest";

import { clearanceBelow } from "./boxes";

const box = (x0: number, x1: number, y0: number, y1: number) => ({ x0, x1, y0, y1 });

describe("clearanceBelow", () => {
	it("moves boxes below the lowest box they share columns with", () => {
		const placed = [box(0, 100, 0, 40), box(150, 250, 0, 120)];
		expect(clearanceBelow(placed, [box(50, 120, 0, 30)], 10)).toBe(50);
		expect(clearanceBelow(placed, [box(50, 200, 0, 30)], 10)).toBe(130);
	});

	it("counts boxes within the slack side by side as sharing columns", () => {
		const placed = [box(0, 100, 0, 40)];
		expect(clearanceBelow(placed, [box(105, 200, 0, 30)], 10)).toBe(-Infinity);
		expect(clearanceBelow(placed, [box(105, 200, 0, 30)], 10, 8)).toBe(50);
	});
});
