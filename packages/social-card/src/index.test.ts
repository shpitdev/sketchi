import { describe, expect, it } from "vitest";

import { CARD_HEIGHT, CARD_WIDTH, card, renderCard, text, tile, wordmark } from "./index.js";

describe("renderCard", () => {
	it("draws a 1200 by 630 PNG from the brand pieces", async () => {
		const svg = card(
			[
				tile({ x: 72, y: 72, size: 64 }),
				wordmark({ x: 150, y: 70, height: 72 }),
				text({ x: 72, y: 300, lines: ["A & B"], size: 48 }),
			].join(""),
			{ title: "A card" },
		);
		expect(svg).toContain("A &#38; B");

		const png = Buffer.from(await renderCard(svg));
		expect(png.subarray(1, 4).toString()).toBe("PNG");
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([CARD_WIDTH, CARD_HEIGHT]);
	});
});
