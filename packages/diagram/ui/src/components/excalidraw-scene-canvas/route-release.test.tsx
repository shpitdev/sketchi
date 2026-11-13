import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it, vi } from "vitest";
import { createFoldedRouteRelease, createRouteRelease } from "./route-release";

type Point = [number, number];

const shape = (id: string, x: number, y: number) =>
	({
		id,
		type: "rectangle",
		x,
		y,
		width: 100,
		height: 60,
		angle: 0,
		isDeleted: false,
		roundness: null,
		version: 1,
		boundElements: [{ id: "route", type: "arrow" }],
	}) as unknown as OrderedExcalidrawElement;

/** A sharp polyline from a's right side to b's top, bending once. */
const route = (points: Point[], version = 1, extra: Record<string, unknown> = {}) =>
	({
		id: "route",
		type: "arrow",
		x: points[0]![0],
		y: points[0]![1],
		points: points.map(([x, y]) => [x - points[0]![0], y - points[0]![1]]),
		angle: 0,
		elbowed: false,
		roundness: null,
		isDeleted: false,
		version,
		startBinding: { elementId: "a", focus: 0, gap: 1 },
		endBinding: { elementId: "b", focus: 0, gap: 1 },
		...extra,
	}) as unknown as OrderedExcalidrawElement;

const drawn: Point[] = [
	[101, 30],
	[250, 30],
	[250, 199],
];

/** a dragged right past the bend: Excalidraw aims the end from inside it. */
const folded: Point[] = [
	[230, 30],
	[250, 30],
	[250, 199],
];

const QUARTER = Math.PI / 2;
const PIVOT: Point = [150, 150];
const turned = ([x, y]: Point): Point => [PIVOT[0] - (y - PIVOT[1]), PIVOT[1] + (x - PIVOT[0])];

/**
 * An element as Excalidraw leaves it when a person rotates the whole scene a
 * quarter turn about PIVOT: its middle turns about the pivot and its angle
 * turns, while an arrow's points stay in its own frame.
 */
function turn(element: OrderedExcalidrawElement): OrderedExcalidrawElement {
	const { x, y, width, height } = element;
	const points = element.type === "arrow" ? (element.points as readonly Point[]) : [];
	const xs = points.map(([px]) => x + px);
	const ys = points.map(([, py]) => y + py);
	const middle: Point = points.length
		? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
		: [x + width / 2, y + height / 2];
	const [mx, my] = turned(middle);
	return { ...element, angle: QUARTER, x: x + mx - middle[0], y: y + my - middle[1] };
}

describe("createRouteRelease", () => {
	it("releases nothing when the scene opens or when nothing moved", () => {
		const release = createRouteRelease();
		const scene = [shape("a", 0, 0), shape("b", 200, 200), route(drawn)];
		expect(release(scene).released).toEqual([]);
		expect(release(scene).released).toEqual([]);
	});

	it("leaves a moved route that still clears its shapes", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		const moved = [
			shape("a", 20, 0),
			shape("b", 200, 200),
			route(
				[
					[121, 30],
					[250, 30],
					[250, 199],
				],
				2,
			),
		];
		expect(release(moved).released).toEqual([]);
	});

	it("releases a route a drag folds through its shape, at the port where it is drawn", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		const { elements, released } = release([
			shape("a", 180, 0),
			shape("b", 200, 200),
			route(folded, 2),
		]);
		expect(released).toHaveLength(1);
		expect(released[0]).toMatchObject({
			elbowed: true,
			fixedSegments: [],
			roundness: null,
			startBinding: { elementId: "a", fixedPoint: [1.01, 0.5001] },
			endBinding: { elementId: "b", fixedPoint: [0.5001, -1 / 60] },
			version: 3,
		});
		expect(elements.find((element) => element.id === "route")).toBe(released[0]);
	});

	it("keeps a selected route, which a person is editing, and arrows drawn after the scene opened", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200)]);
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		expect(release([shape("a", 180, 0), shape("b", 200, 200), route(folded, 2)]).released).toEqual(
			[],
		);

		const editing = createRouteRelease();
		editing([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		expect(
			editing([shape("a", 180, 0), shape("b", 200, 200), route(folded, 2)], { route: true })
				.released,
		).toEqual([]);
	});

	it("leaves curved arrows and elbow arrows with nothing pinned to Excalidraw", () => {
		const release = createRouteRelease();
		const curved = { roundness: { type: 2 } };
		const elbow = { elbowed: true, fixedSegments: [] };
		release([shape("a", 0, 0), route(drawn, 1, curved)]);
		expect(release([shape("a", 180, 0), route(folded, 2, curved)]).released).toEqual([]);
		const elbows = createRouteRelease();
		elbows([shape("a", 0, 0), route(drawn, 1, elbow)]);
		expect(elbows([shape("a", 180, 0), route(folded, 2, elbow)]).released).toEqual([]);
	});

	it("reads a rotated route where Excalidraw draws it, and releases it unrotated", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)].map(turn));
		// A one-pixel nudge of b leaves the route clear of both shapes.
		const nudged = [shape("a", 0, 0), shape("b", 201, 200), route(drawn, 2)].map(turn);
		expect(release(nudged).released).toEqual([]);

		const { released } = release(
			[shape("a", 180, 0), shape("b", 200, 200), route(folded, 3)].map(turn),
		);
		expect(released).toHaveLength(1);
		const arrow = released[0]!;
		expect(arrow).toMatchObject({ angle: 0, elbowed: true, fixedSegments: [] });
		// The ports a quarter turn leaves where they were on each shape, read in its own frame.
		const expectClose = (actual: readonly number[], expected: readonly number[]) =>
			expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
		expectClose(arrow.startBinding!.fixedPoint, [1.01, 0.5001]);
		expectClose(arrow.endBinding!.fixedPoint, [0.5001, -1 / 60]);
		folded.map(turned).forEach((point, index) => {
			const [x, y] = arrow.points[index]!;
			expectClose([arrow.x + x, arrow.y + y], point);
		});
	});

	it("releases an elbow arrow with pinned runs once its shape turns, even while selected", () => {
		const pinned = {
			elbowed: true,
			fixedSegments: [{ index: 2, start: [149, 0], end: [149, 169] }],
			startBinding: { elementId: "a", focus: 0, gap: 0, fixedPoint: [1.01, 0.5001] },
			endBinding: { elementId: "b", focus: 0, gap: 0, fixedPoint: [0.5001, -1 / 60] },
		};
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn, 1, pinned)]);
		const all = { a: true, b: true, route: true } as const;
		// Moved with its shapes, unturned, a selected route is left alone.
		const moved = [shape("a", 10, 0), shape("b", 210, 200), route(drawn, 2, pinned)];
		expect(release(moved, all).released).toEqual([]);
		// Turned with them, its pinned run no longer fits; Excalidraw never turns an elbow arrow.
		const turning = [...moved.slice(0, 2).map(turn), route(drawn, 3, pinned)];
		const { released } = release(turning, all);
		expect(released).toHaveLength(1);
		expect(released[0]).toMatchObject({
			fixedSegments: [],
			startBinding: { elementId: "a", fixedPoint: [1.01, 0.5001] },
			endBinding: { elementId: "b", fixedPoint: [0.5001, -1 / 60] },
		});
	});

	it("takes the port where a person reconnects an end of the route", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		// The person moves the end from b's top to its left side, then lets go.
		const reconnected: Point[] = [
			[101, 30],
			[150, 30],
			[150, 230],
			[199, 230],
		];
		const scene = [shape("a", 0, 0), shape("b", 200, 200), route(reconnected, 2)];
		expect(release(scene, { route: true }).released).toEqual([]);
		// a dragged right over the first bend.
		const swallowed: Point[] = [[160, 30], ...reconnected.slice(1)];
		const { released } = release([shape("a", 100, 0), shape("b", 200, 200), route(swallowed, 3)]);
		expect(released).toHaveLength(1);
		expect(released[0]!.endBinding).toMatchObject({ elementId: "b", fixedPoint: [-0.01, 0.5001] });
	});

	it("meets a shape an end is bound to since where the end is", () => {
		const release = createRouteRelease();
		release([shape("a", 0, 0), shape("b", 200, 200), shape("c", 400, 200), route(drawn)]);
		// The end is now bound to c's left side, as after an undo, and a sits over the bend.
		const rebound = route(
			[
				[230, 30],
				[350, 30],
				[350, 230],
				[399, 230],
			],
			2,
			{ endBinding: { elementId: "c", focus: 0, gap: 1 } },
		);
		const { released } = release([
			shape("a", 180, 0),
			shape("b", 200, 200),
			shape("c", 400, 200),
			rebound,
		]);
		expect(released).toHaveLength(1);
		expect(released[0]!.endBinding).toMatchObject({ elementId: "c", fixedPoint: [-0.01, 0.5001] });
	});
});

describe("createFoldedRouteRelease", () => {
	it("puts a released route in the scene and has Excalidraw route it", () => {
		const mutateElement = vi.fn();
		let scene = [shape("a", 0, 0), shape("b", 200, 200), route(drawn)];
		const api = {
			getSceneElementsIncludingDeleted: () => scene,
			updateScene: vi.fn(({ elements }: { elements: typeof scene }) => {
				scene = elements;
			}),
		};
		const release = createFoldedRouteRelease(mutateElement as never);
		expect(release(api as never, scene)).toBe(scene);
		scene = [shape("a", 180, 0), shape("b", 200, 200), route(folded, 2)];
		const next = release(api as never, scene);
		expect(api.updateScene).toHaveBeenCalledOnce();
		const live = scene.find((element) => element.id === "route");
		expect(next).toBe(scene);
		expect(mutateElement).toHaveBeenCalledWith(live, {
			points: [
				[0, 0],
				[20, 169],
			],
		});
	});
});
