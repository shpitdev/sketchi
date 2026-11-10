import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = vi.hoisted(() => {
	const values = new Map<string, unknown>();
	const log: string[] = [];
	// Each operation settles on a later task, as IndexedDB does.
	const later = <T>(run: () => T) =>
		new Promise<T>((resolve, reject) =>
			setTimeout(() => {
				try {
					resolve(run());
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			}, 0),
		);
	return {
		fail: false,
		log,
		values,
		createStore: () => "store",
		del: (key: string) =>
			later(() => {
				log.push(`del ${key}`);
				values.delete(key);
			}),
		get: (key: string) =>
			later(() => {
				if (idb.fail) throw new Error("IndexedDB unavailable");
				return structuredClone(values.get(key));
			}),
		set: (key: string, value: unknown) =>
			later(() => {
				if (idb.fail) throw new Error("IndexedDB unavailable");
				log.push(`set ${key} ${(value as { elements: unknown[] }).elements.length}`);
				values.set(key, structuredClone(value));
			}),
	};
});
vi.mock("idb-keyval", () => idb);

import { createDrawingDraftCapture, readDrawingDraft } from "./drawing-drafts";

function scene(count: number): ExcalidrawScene {
	return {
		appState: { scrollX: 40, viewBackgroundColor: "#fffdf8" },
		elements: Array.from({ length: count }, (_, index) => ({
			id: `shape-${index}`,
			type: "rectangle",
			version: 1,
		})),
	};
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
	idb.values.clear();
	idb.log.length = 0;
	idb.fail = false;
});

describe("drawing drafts", () => {
	it("restores the newest captured scene for its diagram only", async () => {
		const capture = createDrawingDraftCapture("dia_one");
		capture.write(scene(1));
		capture.write(scene(2));
		capture.write(scene(3));
		await settled();

		// Scenes that arrive while a write is queued collapse into the newest one.
		expect(idb.log).toEqual(["set diagram:dia_one 3"]);
		const restored = await readDrawingDraft("dia_one");
		expect(restored?.elements).toHaveLength(3);
		expect(restored?.appState).toEqual({ viewBackgroundColor: "#fffdf8" });
		expect(await readDrawingDraft("dia_two")).toBeUndefined();
	});

	it("keeps an edit made after a clear, and drops the one the clear covered", async () => {
		const capture = createDrawingDraftCapture("dia_one");
		capture.write(scene(1));
		void capture.clear();
		capture.write(scene(4));
		await settled();

		expect(idb.log).toEqual(["del diagram:dia_one", "set diagram:dia_one 4"]);
		expect((await readDrawingDraft("dia_one"))?.elements).toHaveLength(4);
	});

	it("ignores a stored draft that is not a drawing", async () => {
		idb.values.set("diagram:dia_one", { elements: [{ type: "rectangle" }] });
		expect(await readDrawingDraft("dia_one")).toBeUndefined();
	});

	it("keeps the editor working when browser storage fails", async () => {
		idb.fail = true;
		const capture = createDrawingDraftCapture("dia_one");
		capture.write(scene(1));
		await settled();
		expect(await readDrawingDraft("dia_one")).toBeUndefined();

		idb.fail = false;
		capture.write(scene(2));
		await settled();
		expect((await readDrawingDraft("dia_one"))?.elements).toHaveLength(2);
	});
});
