import type { IconRecipe } from "@sketchi/diagram-core";
import { describe, expect, it } from "vitest";

import { excalidrawClipboard, excalidrawLibrary, recipePreview } from "./recipe-drawing";

const QUEUE: IconRecipe = {
	parts: [
		{ kind: "rect", x: 2, y: 6, width: 20, height: 12, rounded: true, fill: "#e8590c" },
		{
			kind: "stroke",
			points: [
				[6, 9],
				[6, 15],
			],
			stroke: "paper",
		},
		{
			kind: "arrow",
			points: [
				[2, 21],
				[22, 21],
			],
		},
		{ kind: "text", cx: 12, cy: 3, text: "MQ", size: 4, color: "ink" },
	],
};

describe("recipe drawing", () => {
	it("draws every part in the preview's ink and paper, the same way every time", () => {
		const palette = { ink: "#111111", paper: "#ffffff" };
		const preview = recipePreview(QUEUE, palette);
		expect(preview).toEqual(recipePreview(QUEUE, palette));
		expect(preview.parts.map((part) => part.kind)).toEqual(["shape", "shape", "shape", "text"]);
		expect(preview.parts[3]).toEqual({
			kind: "text",
			x: 48,
			y: 12,
			size: 16,
			text: "MQ",
			fill: "#111111",
		});
		const paths = preview.parts.flatMap((part) => (part.kind === "shape" ? part.paths : []));
		const strokes = new Set(paths.map((path) => path.stroke).filter((stroke) => stroke !== "none"));
		expect(strokes).toEqual(new Set(["#111111", "#ffffff"]));
		expect(paths.some((path) => path.fill === "#e8590c")).toBe(true);
		// The arrow draws its shaft and two head strokes.
		const arrow = preview.parts[2];
		expect(arrow?.kind === "shape" && arrow.paths.length).toBeGreaterThanOrEqual(3);
	});

	it("paints a paper mask after the letter it covers, in recipe order", () => {
		const masked: IconRecipe = {
			parts: [
				{ kind: "text", cx: 12, cy: 12, text: "A", size: 12 },
				{ kind: "rect", x: 4, y: 10, width: 16, height: 4, stroke: "none", fill: "paper" },
			],
		};
		const preview = recipePreview(masked, { ink: "#111111", paper: "#ffffff" });
		expect(preview.parts.map((part) => part.kind)).toEqual(["text", "shape"]);
	});

	it("copies Excalidraw clipboard shapes and builds a library item per icon", () => {
		const clipboard = JSON.parse(excalidrawClipboard({ slug: "queue", recipe: QUEUE }));
		expect(clipboard).toMatchObject({ type: "excalidraw/clipboard", files: {} });
		expect(clipboard.elements.map((element: { type: string }) => element.type)).toEqual([
			"rectangle",
			"line",
			"arrow",
			"text",
		]);
		expect(
			clipboard.elements.every((element: { groupIds: string[] }) =>
				element.groupIds.includes("community-queue"),
			),
		).toBe(true);

		const library = JSON.parse(
			excalidrawLibrary(
				[{ slug: "queue", name: "Queue", recipe: QUEUE, createdAt: "2026-11-08T12:00:00.000Z" }],
				"https://icons.sketchi.app",
			),
		);
		expect(library).toMatchObject({
			type: "excalidrawlib",
			version: 2,
			source: "https://icons.sketchi.app",
			libraryItems: [
				{ id: "community-queue", name: "Queue", status: "published", created: 1_794_139_200_000 },
			],
		});
		expect(library.libraryItems[0].elements).toHaveLength(4);
	});
});
