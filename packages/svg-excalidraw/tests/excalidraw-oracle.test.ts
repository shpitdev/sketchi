import {
	loadLibraryFromBlob,
	restoreElements,
	serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import {
	convertSvgToExcalidraw,
	parseSvg,
	serializeExcalidrawLibrary,
} from "../src";
import { corpusFixtures } from "./corpus-fixtures";

function mustParse(source: string, sourceName = "inline.svg") {
	const result = parseSvg(source, { sourceName });
	if (!result.ok) {
		throw new Error(JSON.stringify(result.diagnostics));
	}
	return result.document;
}

// Hang guard for real Excalidraw loading, not a speed budget.
describe("real Excalidraw renderer oracle", { timeout: 60_000 }, () => {
	const counterDocument = mustParse(
		corpusFixtures.counter.source,
		corpusFixtures.counter.sourceName,
	);

	it("loads deterministic library output and restores native editable elements", async () => {
		const converted = convertSvgToExcalidraw(counterDocument, {
			fillStyle: "solid",
			roughness: 1,
		});
		expect(converted.ok).toBe(true);
		if (!converted.ok) {
			return;
		}
		const serialized = serializeExcalidrawLibrary([
			{
				elements: converted.elements,
				id: `svg:${converted.sourceHash}`,
				name: "AI21",
			},
		]);
		const loaded = await loadLibraryFromBlob(
			new Blob([serialized], { type: "application/vnd.excalidrawlib+json" }),
		);
		const restored = restoreElements(loaded[0]?.elements ?? [], null, {
			refreshDimensions: false,
			repairBindings: false,
		});

		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({
			id: `svg:${converted.sourceHash}`,
			name: "AI21",
			created: 1,
			status: "published",
		});
		expect(restored).toHaveLength(converted.elements.length);
		expect(restored.every((element) => element.type === "line")).toBe(true);
		expect(restored.some((element) => element.type === "image")).toBe(false);
		expect(JSON.parse(serializeLibraryAsJSON(loaded))).toMatchObject({
			type: "excalidrawlib",
			version: 2,
			libraryItems: [{ id: `svg:${converted.sourceHash}` }],
		});
	});

	it("preserves representative edits across save, reload, and re-export", async () => {
		const converted = convertSvgToExcalidraw(counterDocument, {
			fillStyle: "solid",
			roughness: 1,
		});
		expect(converted.ok).toBe(true);
		if (!converted.ok) {
			return;
		}
		const original = converted.elements[0];
		expect(original).toBeDefined();
		if (!original) {
			return;
		}
		const loadAndRestore = async (serialized: string) => {
			const items = await loadLibraryFromBlob(
				new Blob([serialized], {
					type: "application/vnd.excalidrawlib+json",
				}),
			);
			return restoreElements(items[0]?.elements ?? [], null, {
				refreshDimensions: false,
				repairBindings: false,
			});
		};
		const serialize = (
			elements: Parameters<typeof serializeExcalidrawLibrary>[0][number]["elements"],
		) =>
			serializeExcalidrawLibrary([
				{
					elements,
					id: `svg:${converted.sourceHash}`,
					name: "Edited AI21",
				},
			]);
		const baseline = await loadAndRestore(serialize(converted.elements));
		const baselineElement = baseline.find((element) => element.id === original.id);
		expect(baselineElement).toBeDefined();
		if (!baselineElement) {
			return;
		}

		const editedElements = converted.elements.map((element, index) =>
			index === 0
				? {
						...element,
						backgroundColor: "#ff006e",
						groupIds: ["edited:group"],
						strokeColor: "#ff006e",
						version: element.version + 1,
						x: element.x + 37,
						y: element.y + 19,
					}
				: element,
		);
		const restored = await loadAndRestore(serialize(editedElements));
		const edited = restored.find((element) => element.id === original.id);
		expect(edited).toMatchObject({
			backgroundColor: "#ff006e",
			groupIds: ["edited:group"],
			strokeColor: "#ff006e",
			x: baselineElement.x + 37,
			y: baselineElement.y + 19,
		});
		if (!edited) {
			return;
		}

		const reloaded = await loadAndRestore(serialize(restored));
		expect(reloaded.find((element) => element.id === original.id)).toMatchObject({
			backgroundColor: edited.backgroundColor,
			groupIds: edited.groupIds,
			strokeColor: edited.strokeColor,
			x: edited.x,
			y: edited.y,
		});
	});

});
