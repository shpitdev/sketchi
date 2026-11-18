import { expect, it } from "vitest";

import { canvasFit } from "../components/excalidraw-scene-canvas/canvas-fit";

it("fits a tall diagram beneath the centered toolbar instead of pushing it to the right", () => {
	const stage = { height: 472, width: 1244 };
	// Fractional scene bounds make the fit land at the toolbar gap to float precision.
	const diagram = { height: 1035.375, width: 480 };
	const toolbar = { bottom: 92, left: 320, right: 924, top: 16 };
	const cornerControls = [
		{ bottom: 175, left: 1204, right: 1240, top: 80 },
		{ bottom: 456, left: 16, right: 236, top: 416 },
	];
	const fit = canvasFit(stage, diagram, [toolbar, ...cornerControls]);
	if (!fit) throw new Error("Expected the diagram to fit");

	const { bottom, left, right, top } = fit.canvasOffsets;
	const drawnHeight = diagram.height * fit.zoom;
	const drawnTop = top + (stage.height - top - bottom - drawnHeight) / 2;
	expect(left).toBe(right);
	expect(drawnTop).toBeGreaterThan(toolbar.bottom);
	expect(fit.zoom).toBe(canvasFit(stage, diagram, [toolbar])?.zoom);
});
