import { type IconRecipe } from "@sketchi/drawing";
import { describe, expect, it } from "vitest";

import { excalidrawLibrary } from "../src/features/export/excalidraw-export";
import { findPack, packIcons, packVersion } from "../src/lib/packs";

const square: IconRecipe = {
	parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#2496ed" }],
};
const icons = [
	{
		slug: "aip-document-intelligence-app",
		name: "AIP Document Intelligence",
		collection: "palantir",
	},
	{ slug: "aws", name: "AWS", collection: "cloud-vendors" },
	{ slug: "gotham", name: "Gotham", collection: "palantir" },
	{ slug: "quiver-app", name: "Quiver", collection: "palantir" },
];
const drawings = { "aip-document-intelligence-app": square, aws: square, "quiver-app": square };

describe("pack library file", () => {
	it("holds the pack's drawn marks named after their product, versioned by its own hash", async () => {
		const text = excalidrawLibrary(
			packIcons(findPack("palantir")!, icons, drawings),
			"https://icons.sketchi.app",
			"catalog",
		);
		const library = JSON.parse(text);
		expect(library).toMatchObject({ type: "excalidrawlib", version: 2 });
		// Excalidraw's library search finds items by these names.
		expect(
			library.libraryItems.map((item: { id: string; name: string }) => [item.id, item.name]),
		).toEqual([
			["catalog-aip-document-intelligence-app", "AIP Document Intelligence"],
			["catalog-quiver-app", "Quiver"],
		]);
		expect(await packVersion(text)).toBe(await packVersion(text));
		expect(await packVersion(text)).not.toBe(await packVersion(`${text} `));
	});
});
