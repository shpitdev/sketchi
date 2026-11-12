import type { IconRecipe } from "@sketchi/diagram-core/icon-recipe";
import { describe, expect, it } from "vitest";

import { catalogDrawings, decodeDrawings } from "./drawings";
import { excalidrawClipboard, excalidrawLibrary } from "./excalidraw-export";

const square: IconRecipe = {
	parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, fill: "#2496ed" }],
};

describe("catalog drawings", () => {
	it("keeps the recipes of catalog marks in manifest order and leaves concept recipes out", () => {
		const drawings = catalogDrawings(["docker", "github", "aws"], {
			aws: square,
			database: square,
			docker: square,
		});
		expect(Object.keys(drawings)).toEqual(["docker", "aws"]);
	});

	it("decodes the published file, dropping entries that are not recipes", () => {
		expect(decodeDrawings({ docker: square, broken: { parts: "no" }, other: null })).toEqual({
			docker: square,
		});
		expect(() => decodeDrawings([])).toThrow(/not an object/u);
	});

	it("exports a catalog drawing for Excalidraw under the mark's own id", () => {
		const library = JSON.parse(
			excalidrawLibrary(
				[{ slug: "docker", name: "Docker", recipe: square }],
				"https://icons.sketchi.app",
				"catalog",
			),
		) as {
			readonly type: string;
			readonly libraryItems: readonly {
				readonly id: string;
				readonly name: string;
				readonly created: number;
				readonly elements: readonly { readonly customData?: unknown }[];
			}[];
		};
		expect(library.type).toBe("excalidrawlib");
		expect(library.libraryItems).toHaveLength(1);
		expect(library.libraryItems[0]).toMatchObject({
			id: "catalog-docker",
			name: "Docker",
			created: 0,
		});
		expect(library.libraryItems[0]?.elements.length).toBeGreaterThan(0);
		expect(library.libraryItems[0]?.elements[0]?.customData).toMatchObject({
			sketchiIcon: "docker",
		});

		const clipboard = JSON.parse(
			excalidrawClipboard({ slug: "docker", name: "Docker", recipe: square }, "catalog"),
		) as {
			readonly type: string;
			readonly elements: readonly unknown[];
		};
		expect(clipboard.type).toBe("excalidraw/clipboard");
		expect(clipboard.elements.length).toBeGreaterThan(0);
	});
});
