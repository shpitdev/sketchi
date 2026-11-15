import {
	type ExcalidrawElbowArrowElement,
	type OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import { type EditorElement, type ExcalidrawEditor } from "@sketchi/diagram-scenarios";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import * as excalidraw from "@sketchi/excalidraw-internals";
import { describe, expect, it, vi } from "vitest";
import { createFoldedRouteRelease, type MutateElement } from "./route-release";
import nativeReleaseElements from "./route-release.fixture.json";

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
	it("keeps native endpoints and fixed metadata together through release and a later bound move", () => {
		// Captured from Studio's Release flow before the failing rename/ellipse drag.
		// Only the two shapes and their retry route remain; geometry is unchanged.
		const native = excalidraw as ExcalidrawEditor;
		const scene = new native.Scene_default();
		scene.replaceAllElements(
			native.restoreElements(structuredClone(nativeReleaseElements), null, {
				refreshDimensions: false,
				repairBindings: true,
			}),
		);
		const read = () =>
			scene.getElementsIncludingDeleted() as unknown as readonly OrderedExcalidrawElement[];
		const api: Parameters<ReturnType<typeof createFoldedRouteRelease>>[0] = {
			getSceneElementsIncludingDeleted: read,
			updateScene: ({ elements }) => {
				if (elements) scene.replaceAllElements(elements as unknown as readonly EditorElement[]);
			},
		};
		const release = createFoldedRouteRelease(native.mutateElement.bind(native) as MutateElement);
		const move = (id: string, offset: Point) => {
			const shape = scene.getNonDeletedElementsMap().get(id);
			if (!shape) throw new Error(`Missing ${id}`);
			const originalElements = new Map(
				scene.getNonDeletedElements().map((element) => [element.id, structuredClone(element)]),
			);
			for (let step = 1; step <= 30; step += 1) {
				native.dragSelectedElements(
					{ originalElements },
					[shape],
					{ x: (offset[0] * step) / 30, y: (offset[1] * step) / 30 },
					scene,
					{ x: 0, y: 0 },
					null,
				);
				expect(release(api, read(), { [id]: true })).toBe(read());
			}
		};
		const expectNativeEnds = () => {
			const elements = read();
			const arrow = elements.find(
				(element): element is OrderedExcalidrawElement & ExcalidrawElbowArrowElement =>
					element.id === "edge:check->start" &&
					element.type === "arrow" &&
					"elbowed" in element &&
					element.elbowed,
			);
			if (!arrow) throw new Error("Missing native retry elbow");
			expect(validateExcalidrawScene({ appState: {}, elements })).toEqual({ ok: true, issues: [] });
			for (const [key, point] of [
				["startBinding", arrow.points[0]],
				["endBinding", arrow.points.at(-1)],
			] as const) {
				const binding = arrow[key];
				const target = elements.find((element) => element.id === binding?.elementId);
				if (!binding?.fixedPoint || !target || !point) throw new Error(`Missing ${key}`);
				expect(target.boundElements).toContainEqual({ id: arrow.id, type: "arrow" });
				expect(arrow.x + point[0]).toBeCloseTo(target.x + binding.fixedPoint[0] * target.width, 8);
				expect(arrow.y + point[1]).toBeCloseTo(target.y + binding.fixedPoint[1] * target.height, 8);
			}
			return structuredClone([arrow.startBinding, arrow.endBinding]);
		};
		try {
			expect(release(api, read())).toBe(read());
			expect(validateExcalidrawScene({ appState: {}, elements: read() })).toEqual({
				ok: true,
				issues: [],
			});
			// The reported (-50,+18) viewport drag at the captured editor zoom.
			move("node:start", [-61.041862509308885, 21.97507050335119]);
			const bindings = expectNativeEnds();
			move("node:start", [-12, 10]);
			expect(expectNativeEnds()).toEqual(bindings);
			move("node:check", [12, 8]);
			expect(expectNativeEnds()).toEqual(bindings);
		} finally {
			scene.destroy();
		}
	});

	it("routes the live arrow and returns the post-mutation scene", () => {
		const mutateElement = vi.fn((arrow: OrderedExcalidrawElement) => {
			// Native scene replacement need not retain the submitted array or objects.
			scene = scene.map((element) => (element.id === arrow.id ? { ...element, x: 999 } : element));
		});
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
				scene = elements.map((element) => ({ ...element }));
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
		expect(next).toBe(scene);
		expect(next.find((element) => element.id === "route")?.x).toBe(999);
		expect(mutateElement).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ id: "route", elbowed: true }),
			{ points: [expect.any(Array), expect.any(Array)] },
		);
	});
});
