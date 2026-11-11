import { describe, expect, it } from "vitest";

import { packPreviewLayout, packPreviewSvg } from "./pack-preview";

describe("pack preview", () => {
	it("lays marks out 6 a row in 128px boxes 8px apart, as Excalidraw's publish dialog does", () => {
		expect(packPreviewLayout(3)).toMatchObject({ width: 432, height: 144 });
		const layout = packPreviewLayout(13);
		expect(layout).toMatchObject({ width: 864, height: 432 });
		expect(layout.boxes[7]).toEqual({ x: 144, y: 144 });
	});

	it("draws each mark centered in its bordered box, on white, with its words in Excalifont", () => {
		const svg = packPreviewSvg([
			{ parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#2496ed" }] },
			{ parts: [{ kind: "text", cx: 12, cy: 12, text: "<M>", size: 8 }] },
		]);
		expect(svg).toContain('width="288" height="144"');
		expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
		expect(svg.match(/stroke="#ced4da"/gu)).toHaveLength(2);
		// The 96px drawing sits 16px inside its 128px box, which sits 8px inside its cell.
		expect(svg).toContain('transform="translate(24 24)"');
		expect(svg).toContain('transform="translate(168 24)"');
		expect(svg).toContain('font-family="Excalifont"');
		expect(svg).toContain(">&#60;M&#62;</text>");
	});
});
