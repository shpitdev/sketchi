import { describe, expect, it } from "vitest";

import {
	arrowheadsNear,
	candidateRouteQuality,
	candidateTouches,
	routingQualityFindings,
	routingQualityScale,
	sharedSegments,
	touchingLines,
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

describe("shared segments", () => {
	it("flags two lines drawn along one run, once per pair, with its longest shared run", () => {
		expect(
			sharedSegments(
				[
					arrow("yes", [0, 0], [0, 100], [500, 100], [500, 160]),
					arrow("monitoring", [-200, 101], [300, 101], [300, 300], [520, 300]),
				],
				1,
			),
		).toEqual([{ arrowIds: ["yes", "monitoring"], gap: 1, length: 300 }]);
	});

	it("judges the gap at reader scale, so lines a few units apart share a run only when drawn small", () => {
		const pair = [arrow("a", [0, 0], [400, 0]), arrow("b", [0, 6], [400, 6])];
		expect(sharedSegments(pair, 1)).toEqual([]);
		expect(sharedSegments(pair, 0.5)).toHaveLength(1);
	});

	it("accepts separate lanes, runs side by side no longer than an arrowhead's approach, and one line's own pieces", () => {
		expect(
			sharedSegments([arrow("a", [0, 0], [400, 0]), arrow("b", [0, 18], [400, 18])], 1),
		).toEqual([]);
		expect(
			sharedSegments([arrow("a", [0, 0], [400, 0]), arrow("b", [350, 1], [600, 1])], 1),
		).toEqual([]);
		expect(sharedSegments([arrow("a", [0, 0], [400, 0]), arrow("a", [0, 1], [400, 1])], 1)).toEqual(
			[],
		);
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

describe("arrowheads near a step", () => {
	it("counts each other line's head a step passes through once, its own never", () => {
		const near = arrowheadsNear(
			[
				{ ...arrow("down", [0, 0], [0, 36]), endArrowhead: false },
				arrow("down", [0, 100], [0, 200]),
				arrow("left", [100, 190], [10, 190]),
			],
			1,
		);
		expect(near({ x: -100, y: 190 }, { x: 100, y: 190 }, "across")).toBe(2);
		expect(near({ x: -100, y: 190 }, { x: 100, y: 190 }, "down")).toBe(1);
		expect(near({ x: -100, y: 120 }, { x: 100, y: 120 }, "across")).toBe(0);
	});

	it("draws a reserved stub's head full size", () => {
		const stub = arrow("stub", [0, 164], [0, 200]);
		const step = [{ x: -100, y: 170 }, { x: 100, y: 170 }, "across"] as const;
		// A 36-unit stub draws an 18-unit head; its line, once routed, draws 25.
		expect(arrowheadsNear([stub], 1)(...step)).toBe(0);
		expect(arrowheadsNear([{ ...stub, headRun: 50 }], 1)(...step)).toBe(1);
	});
});

describe("touching lines", () => {
	const pairs = (arrows: readonly RoutingQualityArrow[], scale = 1) =>
		touchingLines(arrows, scale).map((touch) => touch.arrowIds.join("+"));

	it("flags two branches that turn one unit apart in the gap between their checks", () => {
		// The middle check's no branch and the right check's yes branch, as drawn on main.
		expect(
			pairs([
				arrow("no", [589, 1493], [645, 1493], [645, 1638]),
				arrow("yes", [701, 1493], [646, 1493], [646, 1507], [621, 1507], [621, 1579]),
			]),
		).toEqual(["no+yes"]);
	});

	it("flags a bend or an end on another line, and runs that meet end to end", () => {
		expect(
			pairs([arrow("a", [0, 50], [200, 50]), arrow("b", [100, 0], [100, 49], [300, 49])]),
		).toEqual(["a+b"]);
		expect(pairs([arrow("a", [0, 0], [100, 0]), arrow("b", [101, 0], [200, 0])])).toEqual(["a+b"]);
		expect(pairs([arrow("a", [0, 0], [0, 100]), arrow("b", [-50, 105], [50, 105])])).toEqual([
			"a+b",
		]);
	});

	it("accepts a clean crossing and lines that keep the gap", () => {
		expect(pairs([arrow("a", [0, 0], [0, 200]), arrow("b", [-100, 100], [100, 100])])).toEqual([]);
		expect(pairs([arrow("a", [0, 0], [100, 0]), arrow("b", [113, 0], [200, 0])])).toEqual([]);
	});

	it("judges the gap at reader scale", () => {
		const near = [arrow("a", [0, 0], [100, 0]), arrow("b", [110, 0], [110, 100])];
		expect(pairs(near, 1)).toEqual(["a+b"]);
		expect(pairs(near, 2)).toEqual([]);
	});

	it("lets lines leave one node at one point but not fork off a shared stem, and one line's pieces never pair", () => {
		const out = (id: string, ...points: [number, number][]) => ({
			...arrow(id, ...points),
			sourceId: "check",
		});
		expect(
			pairs([out("yes", [0, 0], [0, 40], [-100, 40]), out("no", [0, 0], [0, 40], [100, 40])]),
		).toEqual(["yes+no"]);
		expect(pairs([out("yes", [0, 0], [0, 40]), out("no", [0, 0], [-40, 0])])).toEqual([]);
		expect(pairs([arrow("a", [0, 0], [100, 0]), arrow("a", [100, 1], [100, 100])])).toEqual([]);
	});

	it("takes a reserved stub's free end for no bend, its run for part of the line", () => {
		const stub = { ...arrow("stub", [0, 0], [0, 36]), openEnd: "end" as const };
		const score = candidateTouches([stub], 1);
		expect(score(arrow("across", [-100, 36], [100, 36]))).toBe(0);
		expect(score(arrow("bend", [-100, 20], [2, 20], [2, -50]))).toBe(1);
		expect(score(arrow("stub", [0, 36], [0, 100], [50, 100]))).toBe(0);
	});
});
