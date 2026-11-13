import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { describe, expect, it, vi } from "vitest";
import { createFoldedRouteRelease } from "./route-release";

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
const route = (points: Point[], version = 1) =>
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
	}) as unknown as OrderedExcalidrawElement;

describe("createFoldedRouteRelease", () => {
	it("puts a released route in the scene and has Excalidraw route it", () => {
		const mutateElement = vi.fn();
		let scene = [
			shape("a", 0, 0),
			shape("b", 200, 200),
			route([
				[101, 30],
				[250, 30],
				[250, 199],
			]),
		];
		const api = {
			getSceneElementsIncludingDeleted: () => scene,
			updateScene: vi.fn(({ elements }: { elements: typeof scene }) => {
				scene = elements;
			}),
		};
		const release = createFoldedRouteRelease(mutateElement as never);
		expect(release(api as never, scene)).toBe(scene);
		// a dragged right past the bend: Excalidraw aims the end from inside it.
		scene = [
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
