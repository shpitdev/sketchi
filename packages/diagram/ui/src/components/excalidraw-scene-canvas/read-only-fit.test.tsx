import { describe, expect, it } from "vitest";

import { type CanvasRect, readOnlyFit } from "./read-only-fit";

// A laptop Playground stage: Excalidraw's menu at the top left, its zoom bar at the bottom left.
const stage = { height: 564, width: 820 };
const menu: CanvasRect = { bottom: 52, left: 16, right: 52, top: 16 };
const zoomBar: CanvasRect = { bottom: 548, left: 16, right: 148, top: 512 };
const padding = { bottom: 16, left: 16, right: 16, top: 16 };

describe("readOnlyFit", () => {
	it("fits a diagram exactly inside the padding when no control is drawn", () => {
		const fit = readOnlyFit(stage, { height: 1070, width: 1500 }, []);
		expect(fit?.canvasOffsets).toEqual(padding);
		expect(fit?.zoom).toBeCloseTo(532 / 1070, 6);
	});

	it("keeps the zoom Excalidraw would round down on a phone", () => {
		// A Sankey on a phone stage: Excalidraw's own fit draws it at 0.4.
		const fit = readOnlyFit({ height: 524, width: 357 }, { height: 495, width: 719 }, []);
		expect(fit?.zoom).toBeCloseTo(325 / 719, 6);
		expect(fit?.zoom).toBeGreaterThan(0.45);
	});

	it("keeps the plain fit when the diagram already sits clear of the controls", () => {
		// A tall flowchart fits by height and leaves wide margins at both sides.
		const fit = readOnlyFit(stage, { height: 1100, width: 900 }, [menu, zoomBar]);
		expect(fit?.canvasOffsets).toEqual(padding);
		expect(fit?.zoom).toBeCloseTo(532 / 1100, 6);
	});

	it("leaves room beside the controls when that keeps a wide diagram larger", () => {
		// A Sankey with its title at the top left would otherwise sit under the menu.
		const fit = readOnlyFit(stage, { height: 1070, width: 1500 }, [menu, zoomBar]);
		expect(fit?.canvasOffsets).toEqual({ ...padding, left: 156 });
		expect(fit?.zoom).toBeCloseTo(648 / 1500, 6);
	});

	it("leaves room above and below the controls when that keeps the diagram larger", () => {
		const fit = readOnlyFit(stage, { height: 1000, width: 1500 }, [menu, zoomBar]);
		expect(fit?.canvasOffsets).toEqual({ ...padding, bottom: 60, top: 60 });
		expect(fit?.zoom).toBeCloseTo(444 / 1000, 6);
	});

	it("keeps the plain fit when no fit clears the controls", () => {
		// At Excalidraw's smallest zoom this scene still reaches the zoom bar, and
		// insetting it would only clip its far edge.
		const fit = readOnlyFit(stage, { height: 4500, width: 7000 }, [menu, zoomBar]);
		expect(fit?.canvasOffsets).toEqual(padding);
		expect(fit?.zoom).toBeCloseTo(788 / 7000, 6);
	});

	it("measures nothing for an empty scene or a hidden canvas", () => {
		expect(readOnlyFit(stage, { height: 0, width: 0 }, [])).toBeUndefined();
		expect(readOnlyFit({ height: 0, width: 0 }, { height: 100, width: 100 }, [])).toBeUndefined();
	});
});
