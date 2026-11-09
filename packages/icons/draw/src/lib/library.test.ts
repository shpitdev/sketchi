// @vitest-environment jsdom
import { loadLibraryFromBlob, restoreElements } from "@excalidraw/excalidraw";
import { type IconRecipe, iconRecipeIssues } from "@sketchi/diagram-core";
import nativeIcons from "@sketchi/icon-catalog/native-icons";
import { describe, expect, it } from "vitest";

import { iconLibrary, LIBRARY_ICON_SIZE, previewScene, roundSheet } from "./scenes.js";

const github = nativeIcons["github"] as IconRecipe;

describe("icon scenes", () => {
	it("returns a library Excalidraw loads as one grouped icon", async () => {
		expect(iconRecipeIssues(github)).toEqual([]);
		const library = iconLibrary("GitHub", github);
		const loaded = await loadLibraryFromBlob(
			new Blob([JSON.stringify(library)], { type: "application/vnd.excalidrawlib+json" }),
		);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({ name: "GitHub", status: "published" });
		const restored = restoreElements(loaded[0]?.elements ?? [], null);
		expect(restored).toHaveLength(github.parts.length);
		expect(new Set(restored.map((element) => element.groupIds.join()))).toHaveProperty("size", 1);
		const right = Math.max(...restored.map((element) => element.x + element.width));
		// Parts may overhang the grid, as a hand-drawn stroke does, and curves bulge past their points.
		expect(right).toBeLessThanOrEqual(LIBRARY_ICON_SIZE * 1.125);
	});

	it("lays the source beside the drawing at two sizes, and keeps previews square", () => {
		const sheet = roundSheet(github, "iVBORw0KGgo=");
		expect(sheet.elements[0]).toMatchObject({ type: "image", width: 112, height: 112 });
		expect(Object.values(sheet.files)).toHaveLength(1);
		expect(sheet.elements.filter((element) => element["customData"] !== undefined)).toHaveLength(
			2 * github.parts.length,
		);
		const preview = previewScene(github, 28);
		expect(preview.elements[0]).toMatchObject({
			width: 28,
			height: 28,
			strokeColor: "transparent",
		});
	});
});
