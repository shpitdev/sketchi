import { describe, expect, it } from "vitest";

import {
	candidateRouteQuality,
	routingQualityFindings,
	routingQualityScale,
	type RoutingQualityArrow,
} from "./routing-quality";

const arrow = (id: string, ...points: [number, number][]): RoutingQualityArrow => ({
	id,
	points: points.map(([x, y]) => ({ x, y })),
	sourceId: `${id}-source`,
	targetId: `${id}-target`,
});
const kinds = (arrows: readonly RoutingQualityArrow[], scale = 1) =>
	routingQualityFindings(arrows, scale).map((finding) => finding.kind);

describe("routing quality scale", () => {
	it("fits the exported content and its padding to 2000 px on the long side", () => {
		expect(routingQualityScale({ width: 1960, height: 600 })).toBe(1);
		expect(routingQualityScale({ width: 400, height: 960 })).toBe(2);
	});
});

describe("endpoint jogs", () => {
	it("flags a small sideways step just before the arrowhead or after the start", () => {
		expect(kinds([arrow("end", [0, 0], [0, 300], [15, 300], [15, 336])])).toEqual(["endpoint-jog"]);
		expect(kinds([arrow("start", [0, 0], [0, 36], [15, 36], [15, 336])])).toEqual(["endpoint-jog"]);
	});

	it("flags a long run that hooks sideways just above its target", () => {
		expect(kinds([arrow("hook", [0, 0], [0, 600], [120, 600], [120, 636])])).toEqual([
			"endpoint-jog",
		]);
	});

	it("judges the step at reader scale, so the same hook is a deliberate bend when drawn larger", () => {
		expect(kinds([arrow("hook", [0, 0], [0, 600], [120, 600], [120, 636])], 2)).toEqual([]);
	});

	it("counts each arrow end once", () => {
		expect(
			kinds([arrow("zigzag", [0, 0], [0, 300], [10, 300], [10, 320], [20, 320], [20, 340])]),
		).toEqual(["endpoint-jog"]);
	});

	it("accepts wide Z-bends, required short turns, staircases, loops and mid-route steps", () => {
		expect(
			kinds([
				arrow("wide-z", [0, 0], [0, 36], [300, 36], [300, 336]),
				arrow("short-turn", [1000, 0], [1060, 0], [1060, 30]),
				arrow("staircase", [2000, 0], [2080, 0], [2080, 110], [2200, 110], [2200, 150]),
				arrow("loop", [3000, 0], [2940, 0], [2940, -300], [3000, -300]),
				arrow("mid-route", [4000, 0], [4000, 200], [4015, 200], [4015, 400]),
			]),
		).toEqual([]);
	});
});

describe("near-coincident corridors", () => {
	it("flags parallel runs of different edges too close to read apart", () => {
		expect(
			kinds([arrow("a", [0, 0], [0, 200], [100, 200]), arrow("b", [12, 0], [12, 200])]),
		).toEqual(["near-coincident-corridor"]);
	});

	it("accepts separated lanes and brief side-by-side corners", () => {
		expect(kinds([arrow("a", [0, 0], [0, 200]), arrow("b", [30, 0], [30, 200])])).toEqual([]);
		expect(kinds([arrow("a", [0, 0], [0, 200]), arrow("b", [10, 190], [10, 400])])).toEqual([]);
	});

	it("leaves short side-by-side arrival stubs to the arrowhead check", () => {
		const arrivals = [
			{ ...arrow("a", [0, 0], [0, 36]), targetId: "sink" },
			{ ...arrow("b", [18, 0], [18, 36]), targetId: "sink" },
		];
		expect(kinds(arrivals)).toEqual(["touching-arrowheads"]);
		expect(
			kinds(arrivals.map((a) => ({ ...a, points: [{ ...a.points[0]!, y: -200 }, a.points[1]!] }))),
		).toEqual(["near-coincident-corridor", "touching-arrowheads"]);
	});
});

describe("touching arrowheads", () => {
	const into = (id: string, x: number) => ({ ...arrow(id, [x, 20], [x, 100]), targetId: "sink" });

	it("flags heads whose wings touch and accepts clearly separated arrivals", () => {
		expect(kinds([into("a", 0), into("b", 18)])).toEqual(["touching-arrowheads"]);
		expect(kinds([into("a", 0), into("b", 36)])).toEqual([]);
	});

	it("ignores arrows drawn without a head", () => {
		expect(kinds([{ ...into("a", 0), endArrowhead: false }, into("b", 18)])).toEqual([]);
	});
});

describe("candidate route quality", () => {
	it("scores a candidate's jogs and the distinct placed arrows it runs beside", () => {
		const score = candidateRouteQuality(
			[
				{ ...arrow("placed", [10, 0], [10, 300]), endArrowhead: false },
				arrow("placed", [10, 300], [10, 336]),
				arrow("self", [0, 0], [0, 336]),
			],
			1,
		);
		expect(score(arrow("self", [0, 0], [0, 300], [15, 300], [15, 336]))).toEqual({
			arrowheadsCrossed: 1,
			corridors: 1,
			jogs: 1,
		});
		expect(score(arrow("self", [100, 0], [100, 336]))).toEqual({
			arrowheadsCrossed: 0,
			corridors: 0,
			jogs: 0,
		});
	});

	it("counts a crossing through an arrowhead wing at a large reader scale", () => {
		const score = candidateRouteQuality(
			[arrow("down", [0, 0], [0, 200])],
			routingQualityScale({ width: 184, height: 320 }),
		);
		expect(score(arrow("across", [7, 178], [30, 178])).arrowheadsCrossed).toBe(1);
	});

	it("counts a crossing at another arrow's head but not one well clear of it", () => {
		const score = candidateRouteQuality([arrow("down", [0, 0], [0, 200])], 1);
		expect(score(arrow("across", [-100, 195], [100, 195])).arrowheadsCrossed).toBe(1);
		expect(score(arrow("across", [-100, 120], [100, 120])).arrowheadsCrossed).toBe(0);
	});
});
