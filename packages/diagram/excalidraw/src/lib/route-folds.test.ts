import { describe, expect, it } from "vitest";
import { elbowFixedPointAt, routeEntersShape } from "./route-folds.js";

const box = { type: "rectangle", x: 0, y: 0, width: 100, height: 60, roundness: null };
const diamond = { type: "diamond", x: 0, y: 0, width: 120, height: 80 };

describe("routeEntersShape", () => {
	it("finds a route that runs back through its shape past a swallowed bend", () => {
		// The shape moved right over the bend, so the run from it crosses the shape.
		expect(
			routeEntersShape(
				[
					[50, -1],
					[50, 30],
					[160, 30],
				],
				box,
				"start",
			),
		).toBe(true);
	});

	it("leaves a route that meets its shape at the outline and leaves it", () => {
		expect(
			routeEntersShape(
				[
					[101, 30],
					[150, 30],
					[150, 120],
				],
				box,
				"start",
			),
		).toBe(false);
	});

	it("leaves a run that hugs the shape's side", () => {
		expect(
			routeEntersShape(
				[
					[10, 0],
					[90, 0],
					[90, -40],
				],
				box,
				"start",
			),
		).toBe(false);
	});

	it("reads a diamond by its outline, not its box", () => {
		// Inside the diamond's box, outside the diamond, near a corner.
		expect(
			routeEntersShape(
				[
					[110, 10],
					[140, 10],
				],
				diamond,
				"start",
			),
		).toBe(false);
		expect(
			routeEntersShape(
				[
					[61, 0],
					[61, 40],
					[200, 40],
				],
				diamond,
				"start",
			),
		).toBe(true);
	});

	it("leaves a route the shape holds at its other end, as a line inside a zone", () => {
		const zone = { type: "rectangle", x: 0, y: 0, width: 300, height: 200, roundness: null };
		expect(
			routeEntersShape(
				[
					[50, 50],
					[50, 199],
				],
				zone,
				"end",
			),
		).toBe(false);
	});
});

describe("elbowFixedPointAt", () => {
	it("binds at the end's place on the shape, reading a side's middle as Excalidraw does", () => {
		expect(elbowFixedPointAt(box, [100, 15])).toEqual([1, 0.25]);
		expect(elbowFixedPointAt(box, [50, 60])).toEqual([0.5001, 1]);
	});

	it("reads a rotated shape in its own frame", () => {
		const turned = { ...box, angle: Math.PI };
		const [x, y] = elbowFixedPointAt(turned, [0, 15]);
		expect(x).toBeCloseTo(1, 9);
		expect(y).toBeCloseTo(0.75, 9);
	});
});
