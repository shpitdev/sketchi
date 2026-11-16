import { createEditSession, type ExcalidrawEditor } from "@sketchi/diagram-scenarios";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import * as excalidraw from "@sketchi/excalidraw-internals";
import { expect, it } from "vitest";

import { nativeElbowElements } from "./native-elbow.fixtures";

it("keeps a shared native elbow departure valid through a clear grouped move and reload", () => {
	const session = createEditSession(excalidraw as ExcalidrawEditor);
	const scene = session.open(nativeElbowElements);
	try {
		expect(validateExcalidrawScene({ appState: {}, elements: nativeElbowElements })).toEqual({
			ok: true,
			issues: [],
		});
		const report = scene.getNonDeletedElementsMap().get("node:dev");
		const peer = scene.getNonDeletedElementsMap().get("node:qa");
		if (!report || !peer) throw new Error("Missing report or peer");
		session.drag(scene, report, [10, -10]);
		expect(report.x + report.width).toBeLessThan(peer.x);
		const elements = scene.getNonDeletedElements().map((element) => ({ ...element }));
		for (const end of session.readEnds(scene)) {
			expect(end.listed).toBe(true);
			expect(end.off).toBeGreaterThanOrEqual(-end.slack);
			expect(end.off).toBeLessThanOrEqual(end.reach + 0.05);
		}
		expect(validateExcalidrawScene({ appState: {}, elements })).toEqual({ ok: true, issues: [] });
		const reloaded = session.open(elements);
		try {
			expect(session.snapshot(reloaded)).toEqual(session.snapshot(scene));
			expect(
				validateExcalidrawScene({
					appState: {},
					elements: reloaded.getNonDeletedElements().map((element) => ({ ...element })),
				}),
			).toEqual({ ok: true, issues: [] });
		} finally {
			session.close(reloaded);
		}

		const mismatched = structuredClone(elements);
		const mismatch = mismatched.find((element) => element.id === "edge:dev");
		if (!mismatch?.endBinding?.fixedPoint) throw new Error("Missing report fixed point");
		mismatch.endBinding = {
			...mismatch.endBinding,
			fixedPoint: [0.75, mismatch.endBinding.fixedPoint[1]],
		};
		expect(validateExcalidrawScene({ appState: {}, elements: mismatched }).issues).toContainEqual(
			expect.objectContaining({ code: "invalid-elbow-binding", elementId: "edge:dev" }),
		);
		const { elementId, focus, gap } = mismatch.endBinding;
		mismatch.endBinding = { elementId, focus, gap };
		expect(validateExcalidrawScene({ appState: {}, elements: mismatched }).issues).toContainEqual(
			expect.objectContaining({ code: "invalid-elbow-binding", elementId: "edge:dev" }),
		);

		const floating = structuredClone(elements);
		const detached = floating.find((element) => element.id === "edge:dev");
		if (!detached) throw new Error("Missing report arrow");
		detached.x += 100;
		expect(validateExcalidrawScene({ appState: {}, elements: floating }).issues).toContainEqual(
			expect.objectContaining({ code: "arrow-endpoint-off-shape", elementId: "edge:dev" }),
		);

		// A shared source does not permit a later, unrelated portion to overlap.
		const overlapping = structuredClone(elements);
		const other = overlapping.find((element) => element.id === "edge:qa");
		const end = other?.points?.at(-1);
		if (!other || !end) throw new Error("Missing peer arrow");
		const at = (x: number, y: number): [number, number] => [x - other.x, y - other.y];
		other.points = [
			[0, 0],
			at(265, 412),
			at(373.5, 412),
			at(373.5, 420),
			at(200, 420),
			at(200, 412),
			at(170, 412),
			at(170, 430),
			at(373.5, 430),
			end,
		];
		expect(validateExcalidrawScene({ appState: {}, elements: overlapping }).issues).toContainEqual(
			expect.objectContaining({ code: "overlapping-arrow-segment" }),
		);
	} finally {
		session.close(scene);
	}
});

