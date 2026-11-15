import { createEditSession, type ExcalidrawEditor } from "@sketchi/diagram-scenarios";
import { validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import * as excalidraw from "@sketchi/excalidraw-internals";
import { expect, it } from "vitest";

import { nativeBindingElements } from "./native-binding.fixtures";

it.each([
	{ offset: [2, 1] as [number, number], corner: false },
	{ offset: [26, 16] as [number, number], corner: true },
])("accepts native grouped drag and reload (corner: $corner)", ({ offset, corner }) => {
	const session = createEditSession(excalidraw as ExcalidrawEditor);
	const scene = session.open(nativeBindingElements);
	try {
		const bar = scene.getNonDeletedElementsMap().get("node:gantt:task:api");
		if (!bar) throw new Error("Missing task bar");
		session.drag(scene, bar, offset);
		const elements = scene.getNonDeletedElements().map((element) => ({ ...element }));
		// Excalidraw computes both ends against the previous points, then moves
		// them together. Its valid edited result need not be a placement fixed point.
		const before = session.snapshot(scene);
		for (const end of session.readEnds(scene)) {
			expect(end.listed).toBe(true);
			expect(end.off).toBeGreaterThanOrEqual(1 - 1e-8);
			expect(end.off).toBeLessThanOrEqual(end.reach + 0.05);
		}
		if (corner) expect(session.readEnds(scene).some((end) => end.off > 1.05)).toBe(true);
		expect(validateExcalidrawScene({ appState: {}, elements })).toEqual({ ok: true, issues: [] });
		session.touch(scene);
		const after = session.snapshot(scene);
		const id = "gantt:dependency:design:api";
		const [start] = before.get(id) ?? [];
		const [replaced] = after.get(id) ?? [];
		if (!start || !replaced) throw new Error("Missing dependency endpoints");
		expect(Math.hypot(start[0] - replaced[0], start[1] - replaced[1])).toBeGreaterThan(0.01);

		const reloaded = session.open(elements);
		try {
			expect(session.snapshot(reloaded)).toEqual(before);
			expect(
				validateExcalidrawScene({
					appState: {},
					elements: reloaded.getNonDeletedElements().map((element) => ({ ...element })),
				}),
			).toEqual({ ok: true, issues: [] });
		} finally {
			session.close(reloaded);
		}

		// A square corner can be sqrt(2) gaps away, but a side cannot. Reject
		// a detached side end even though it is closer than that corner radius.
		const detached = structuredClone(elements);
		const arrow = detached.find((element) => element.id === id);
		const target = detached.find((element) => element.id === bar.id);
		if (!arrow?.points || !target) throw new Error("Missing bound arrow or task");
		arrow.points[arrow.points.length - 1] = [
			target.x - 1.2 - arrow.x,
			target.y + target.height / 2 - arrow.y,
		];
		expect(validateExcalidrawScene({ appState: {}, elements: detached }).issues).toContainEqual(
			expect.objectContaining({
				code: "arrow-endpoint-off-shape",
				elementId: id,
				message: expect.stringContaining("endBinding"),
			}),
		);
	} finally {
		session.close(scene);
	}
});
