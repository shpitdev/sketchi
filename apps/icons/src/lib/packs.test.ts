import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { describe, expect, it } from "vitest";

import { excalidrawLibrary } from "./excalidraw-export";
import {
	ALL_ICONS_PACK_ID,
	decodePackIndex,
	findPack,
	ICON_PACKS,
	isExcalidrawInstallUrl,
	packIcons,
	packLibraryFileName,
	packLibraryPath,
	packPreview,
	packSummary,
	packVersion,
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
		expect(packSummary(pack, members, "v1")).toMatchObject({
			id: "palantir",
			version: "v1",
			count: 4,
		});
	});

	it("keeps the catalog library's URL and gives every other pack its own", () => {
		expect(packLibraryPath(ALL_ICONS_PACK_ID)).toBe("/sketchi-icons.excalidrawlib");
		expect(packLibraryPath("palantir")).toBe("/packs/palantir.excalidrawlib");
		expect(packLibraryFileName("palantir")).toBe("sketchi-palantir.excalidrawlib");
	});

	it("links a pack to excalidraw.com only to add its library from Excalidraw's collection", () => {
		const library =
			"https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/sketchi-palantir-1/libraries/sketchi/palantir.excalidrawlib?raw=true";
		expect(
			isExcalidrawInstallUrl(`https://excalidraw.com/?addLibrary=${encodeURIComponent(library)}`),
		).toBe(true);
		for (const href of [
			// Opening a scene asks to replace whatever is on the canvas.
			"https://excalidraw.com/#url=https%3A%2F%2Ficons.sketchi.app%2Fpacks%2Fpalantir.excalidraw",
			`https://excalidraw.com/?addLibrary=${encodeURIComponent("https://icons.sketchi.app/packs/palantir.excalidrawlib")}`,
			`https://excalidraw.com/?addLibrary=${encodeURIComponent(library.replace(".excalidrawlib", ".png"))}`,
			`https://example.com/?addLibrary=${encodeURIComponent(library)}`,
			"not a url",
		]) {
			expect(isExcalidrawInstallUrl(href), href).toBe(false);
		}
	});

	it("lists every pack but the whole catalog for Excalidraw's collection, in one English sentence", () => {
		for (const pack of ICON_PACKS) {
			const listing = pack.excalidrawListing;
			if (pack.id === ALL_ICONS_PACK_ID) {
				expect(listing).toBeUndefined();
				continue;
			}
			expect(listing?.name, pack.id).toMatch(/^[A-Z][\x20-\x7e]+$/u);
			expect(listing?.description, pack.id).toMatch(/^[A-Z][\x20-\x7e]+\.$/u);
			expect(listing?.description, pack.id).not.toMatch(/\. /u);
		}
		const names = ICON_PACKS.flatMap((pack) => pack.excalidrawListing?.name ?? []);
		expect(new Set(names).size).toBe(names.length);
	});

	it("versions a pack by the hash of its library", async () => {
		const version = await packVersion("{}");
		expect(version).toMatch(/^[0-9a-f]{16}$/u);
		expect(await packVersion("{}")).toBe(version);
		expect(await packVersion("{ }")).not.toBe(version);
	});

	it("decodes the index, keeping only defined packs and recipe-shaped previews", () => {
		expect(
			decodePackIndex([
				{
					id: "palantir",
					name: "Palantir",
					version: "v1",
					count: 3,
					preview: [{ slug: "palantir", name: "Palantir", recipe: square }, { slug: "x" }],
				},
				{ id: "data", name: "Data", count: 3, preview: [] },
				{ id: "retired", name: "Retired", count: 1, preview: [] },
				{ id: "cloud", name: "Cloud" },
			]),
		).toEqual([
			{
				id: "palantir",
				name: "Palantir",
				version: "v1",
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
});
