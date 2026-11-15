import { describe, expect, it } from "vitest";

import { excalifontInkBox } from "./excalifont-ink";
import { estimateTextWidth } from "./text-metrics";

const width = (text: string, size: number) => {
	const box = excalifontInkBox(text, size);
	return box.right - box.left;
};

describe("Excalifont ink", () => {
	it("measures capitals wider and lowercase narrower than the layout estimate's average", () => {
		// Painted at 100 px by resvg from Excalidraw's Excalifont: CACHE 310.5, Aurora 316.3.
		expect(width("CACHE", 100)).toBeCloseTo(313.5, 0);
		expect(width("Aurora", 100)).toBeCloseTo(320.3, 0);
		expect(width("WWW", 100)).toBeGreaterThan(estimateTextWidth("WWW", 100));
		expect(width("illi", 100)).toBeLessThan(estimateTextWidth("illi", 100) / 2);
	});

	it("centers the advance across and the line box down, as Excalidraw lays a word out", () => {
		const box = excalifontInkBox("HH", 100);
		expect(box.left).toBeCloseTo(-box.right, -1);
		// The baseline sits 0.256 em below center; an H rises 0.646 em from it.
		expect(box.bottom).toBeGreaterThan(25);
		expect(box.top).toBeCloseTo(25.6 - 64.6, 0);
	});

	it("scales with the font size and skips spaces at the ends", () => {
		expect(width("RDS", 10)).toBeCloseTo(width("RDS", 100) / 10, 5);
		expect(width(" RDS ", 100)).toBeCloseTo(width("RDS", 100), 5);
		expect(excalifontInkBox(" ", 10)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
	});

	it("takes a glyph outside printable ASCII at the estimate's advance and full height", () => {
		const box = excalifontInkBox("é", 100);
		expect(box.right - box.left).toBeCloseTo(62, 5);
		expect(box.bottom - box.top).toBeCloseTo(126, 5);
	});
});
