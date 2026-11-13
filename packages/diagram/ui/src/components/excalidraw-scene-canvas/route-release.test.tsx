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
		// a dragged right past the bend: Excalidraw aims the end from inside it.
		const folded = route(
			[
				[230, 30],
				[250, 30],
				[250, 199],
			],
			2,
		);
		const { elements, released } = release([shape("a", 180, 0), shape("b", 200, 200), folded]);
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
		const folded = route(
			[
				[230, 30],
				[250, 30],
				[250, 199],
			],
			2,
		);
		release([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		expect(release([shape("a", 180, 0), shape("b", 200, 200), folded]).released).toEqual([]);

		const editing = createRouteRelease();
		editing([shape("a", 0, 0), shape("b", 200, 200), route(drawn)]);
		expect(
			editing([shape("a", 180, 0), shape("b", 200, 200), folded], { route: true }).released,
		).toEqual([]);
	});

	it("leaves curved arrows and elbow arrows with nothing pinned to Excalidraw", () => {
		const release = createRouteRelease();
		const curved = { roundness: { type: 2 } };
		const elbow = { elbowed: true, fixedSegments: [] };
		release([shape("a", 0, 0), route(drawn, 1, curved)]);
		const folded: Point[] = [
			[230, 30],
			[250, 30],
			[250, 199],
		];
		expect(release([shape("a", 180, 0), route(folded, 2, curved)]).released).toEqual([]);
		const elbows = createRouteRelease();
		elbows([shape("a", 0, 0), route(drawn, 1, elbow)]);
		expect(elbows([shape("a", 180, 0), route(folded, 2, elbow)]).released).toEqual([]);
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
		const folded = [
			shape("a", 180, 0),
			shape("b", 200, 200),
			route(
				[
					[230, 30],
					[250, 30],
					[250, 199],
				],
				2,
			),
		];
		scene = folded;
		const next = release(api as never, folded);
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
