import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { describe, expect, it } from "vitest";

import { excalidrawLibrary, excalidrawScene } from "./excalidraw-export";
import {
	ALL_ICONS_PACK_ID,
	decodePackIndex,
	findPack,
	ICON_PACKS,
	openInExcalidrawUrl,
	packIcons,
	packLibraryFileName,
	packLibraryPath,
	packPreview,
	packScenePath,
	packSummary,
	type IconPackDefinition,
} from "./packs";

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
	{ slug: "foundry-platform", name: "Foundry Platform", collection: "palantir" },
	{ slug: "gotham", name: "Gotham", collection: "palantir" },
	{ slug: "palantir", name: "Palantir", collection: "palantir" },
	{ slug: "quiver-app", name: "Quiver", collection: "palantir" },
];
const drawings = {
	"aip-document-intelligence-app": square,
	aws: square,
	"foundry-platform": square,
	palantir: square,
	"quiver-app": square,
};
const palantir = findPack("palantir")!;

describe("icon packs", () => {
	it("defines unique ids, with the whole catalog first", () => {
		const ids = ICON_PACKS.map((pack) => pack.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids[0]).toBe(ALL_ICONS_PACK_ID);
		expect(ICON_PACKS.filter((pack) => !pack.collections).map((pack) => pack.id)).toEqual([
			ALL_ICONS_PACK_ID,
		]);
	});

	it("holds its collections' drawn marks in catalog order, named after the product", () => {
		expect(packIcons(palantir, icons, drawings).map((icon) => [icon.slug, icon.name])).toEqual([
			["aip-document-intelligence-app", "AIP Document Intelligence"],
			["foundry-platform", "Foundry Platform"],
			["palantir", "Palantir"],
			["quiver-app", "Quiver"],
		]);
		expect(packIcons(findPack(ALL_ICONS_PACK_ID)!, icons, drawings)).toHaveLength(5);
	});

	it("previews its featured marks first and tops up from the rest when one is gone", () => {
		const pack: IconPackDefinition = {
			id: "palantir",
			name: "Palantir",
			collections: ["palantir"],
			featured: ["palantir", "gotham", "removed", "quiver-app"],
		};
		const members = packIcons(pack, icons, drawings);
		expect(packPreview(pack, members, 3).map((icon) => icon.slug)).toEqual([
			"palantir",
			"quiver-app",
			"aip-document-intelligence-app",
		]);
		expect(packSummary(pack, members)).toMatchObject({ id: "palantir", count: 4 });
	});

	it("keeps the catalog library's URL and gives every other pack its own", () => {
		expect(packLibraryPath(ALL_ICONS_PACK_ID)).toBe("/sketchi-icons.excalidrawlib");
		expect(packLibraryPath("palantir")).toBe("/packs/palantir.excalidrawlib");
		expect(packLibraryFileName("palantir")).toBe("sketchi-palantir.excalidrawlib");
		expect(packScenePath(ALL_ICONS_PACK_ID)).toBe("/packs/all.excalidraw");
	});

	it("opens a pack on excalidraw.com from the site's own scene URL", () => {
		const url = new URL(openInExcalidrawUrl("palantir", "https://icons.sketchi.app"));
		expect(url.origin).toBe("https://excalidraw.com");
		expect(new URLSearchParams(url.hash.slice(1)).get("url")).toBe(
			"https://icons.sketchi.app/packs/palantir.excalidraw",
		);
	});

	it("decodes the index, keeping only defined packs and recipe-shaped previews", () => {
		expect(
			decodePackIndex([
				{
					id: "palantir",
					name: "Palantir",
					count: 3,
					preview: [{ slug: "palantir", name: "Palantir", recipe: square }, { slug: "x" }],
				},
				{ id: "retired", name: "Retired", count: 1, preview: [] },
				{ id: "cloud", name: "Cloud" },
			]),
		).toEqual([
			{
				id: "palantir",
				name: "Palantir",
				count: 3,
				preview: [{ slug: "palantir", name: "Palantir", recipe: square }],
			},
		]);
		expect(() => decodePackIndex({})).toThrow(/not a list/u);
	});
});

describe("pack files", () => {
	const members = packIcons(palantir, icons, drawings);

	it("names each library item after its product, so Excalidraw's library search finds it", () => {
		const library = JSON.parse(excalidrawLibrary(members, "https://icons.sketchi.app", "catalog"));
		expect(library).toMatchObject({ type: "excalidrawlib", version: 2 });
		expect(
			library.libraryItems.map((item: { id: string; name: string }) => [item.id, item.name]),
		).toEqual([
			["catalog-aip-document-intelligence-app", "AIP Document Intelligence"],
			["catalog-foundry-platform", "Foundry Platform"],
			["catalog-palantir", "Palantir"],
			["catalog-quiver-app", "Quiver"],
		]);
	});

	it("lays the pack out as a scene: each drawing on its own cell with its name underneath", () => {
		const scene = JSON.parse(excalidrawScene(members, "https://icons.sketchi.app")) as {
			type: string;
			elements: {
				id: string;
				type: string;
				x: number;
				y: number;
				width: number;
				text?: string;
				groupIds: string[];
			}[];
		};
		expect(scene.type).toBe("excalidraw");
		const labels = scene.elements.filter((element) => element.type === "text");
		// A name wider than its cell wraps; the others stay on one line.
		expect(labels.map((label) => label.text)).toEqual([
			"AIP Document\nIntelligence",
			"Foundry Platform",
			"Palantir",
			"Quiver",
		]);
		const drawn = scene.elements.filter((element) => element.type !== "text");
		expect(new Set(drawn.map((element) => element.groupIds[0]))).toEqual(
			new Set([
				"catalog-aip-document-intelligence-app",
				"catalog-foundry-platform",
				"catalog-palantir",
				"catalog-quiver-app",
			]),
		);
		// Labels sit under their own drawing and never overlap the next cell.
		const ids = new Set(scene.elements.map((element) => element.id));
		expect(ids.size).toBe(scene.elements.length);
		for (const [index, label] of labels.entries()) {
			const left = 32 + index * 176;
			expect(label.x).toBeGreaterThanOrEqual(left);
			expect(label.x + label.width).toBeLessThanOrEqual(left + 176);
			// Under its 96px drawing, which starts below excalidraw.com's toolbar.
			expect(label.y).toBeGreaterThan(112 + 96);
		}
		expect(Math.min(...drawn.map((element) => element.y))).toBeGreaterThanOrEqual(112);
	});
});
