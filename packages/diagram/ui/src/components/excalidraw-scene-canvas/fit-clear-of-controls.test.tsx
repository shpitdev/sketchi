import { describe, expect, it } from "vitest";

import { type CanvasRect, fitClearOfControls } from "./fit-clear-of-controls";

// A laptop Playground stage: Excalidraw's menu at the top left, its zoom bar at the bottom left.
const stage = { height: 564, width: 820 };
const menu: CanvasRect = { bottom: 52, left: 16, right: 52, top: 16 };
const zoomBar: CanvasRect = { bottom: 548, left: 16, right: 148, top: 512 };

describe("fitClearOfControls", () => {
	it("keeps the plain fit when no control is drawn", () => {
		expect(fitClearOfControls(stage, { height: 1070, width: 1500 }, [])).toBeUndefined();
	});

	it("keeps the plain fit when the diagram already sits clear of the controls", () => {
		// A tall flowchart fits by height and leaves wide margins at both sides.
		expect(
			fitClearOfControls(stage, { height: 1100, width: 900 }, [menu, zoomBar]),
		).toBeUndefined();
	});

	it("leaves room above and below a wide diagram whose corner the menu would cover", () => {
		// A Sankey with its title at the top left fills the stage edge to edge.
		expect(fitClearOfControls(stage, { height: 1070, width: 1500 }, [menu, zoomBar])).toEqual({
			bottom: 60,
			top: 60,
		});
	});

	it("leaves room at the side when that keeps the diagram larger", () => {
		// A tall diagram that fills the height, but whose sides reach the controls.
		expect(fitClearOfControls(stage, { height: 600, width: 760 }, [menu, zoomBar])).toEqual({
			left: 156,
			right: 0,
		});
	});

	it("clears the menu alone when it is the only control", () => {
		// A strip beside the menu costs this wide diagram less than bands above and below.
		expect(fitClearOfControls(stage, { height: 1070, width: 1500 }, [menu])).toEqual({
			left: 60,
			right: 0,
		});
	});
});
