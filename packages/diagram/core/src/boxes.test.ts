import { describe, expect, it } from "vitest";

import { clearanceBelow, clearanceLeft, clearanceRight } from "./boxes";

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

describe("clearanceRight and clearanceLeft", () => {
	it("moves boxes right of, or keeps them left of, the boxes they share rows with", () => {
		const placed = [box(0, 100, 0, 40), box(0, 300, 100, 140)];
		expect(clearanceRight(placed, [box(0, 50, 10, 30)], 20)).toBe(120);
		expect(clearanceRight(placed, [box(0, 50, 10, 120)], 20)).toBe(320);
		expect(clearanceLeft(placed, [box(500, 550, 10, 30)], 20)).toBe(-570);
	});

	it("counts boxes within the slack above or below as sharing rows", () => {
		const placed = [box(0, 100, 0, 40)];
		expect(clearanceRight(placed, [box(0, 50, 45, 60)], 20)).toBe(-Infinity);
		expect(clearanceRight(placed, [box(0, 50, 45, 60)], 20, 8)).toBe(120);
		expect(clearanceLeft(placed, [box(0, 50, 45, 60)], 20)).toBe(Infinity);
	});
});
