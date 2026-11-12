import type { ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { StudioDrawing } from "@sketchi/studio-projects/client";
import { Result, Schema } from "effect";
import { createStore, del, get, set, type UseStore } from "idb-keyval";

import { drawingFromScene, sceneFromDrawing } from "./diagram-drawing";

/**
 * Unsaved Studio edits live in IndexedDB, one entry per diagram, until a Save
 * persists them. Browser storage can be missing (private windows, blocked site
 * data), so every operation degrades to doing nothing rather than failing the editor.
 */
let draftStore: UseStore | undefined;

function drafts(): UseStore {
	draftStore ??= createStore("sketchi-studio", "drawing-drafts");
	return draftStore;
}

function draftKey(diagramId: string): string {
	return `diagram:${diagramId}`;
}

export async function readDrawingDraft(diagramId: string): Promise<ExcalidrawScene | undefined> {
	try {
		const stored: unknown = await get(draftKey(diagramId), drafts());
		if (stored === undefined) return undefined;
		const drawing = Schema.decodeUnknownResult(StudioDrawing)(stored);
		return Result.isSuccess(drawing) ? sceneFromDrawing(drawing.success) : undefined;
	} catch {
		return undefined;
	}
}

export interface DrawingDraftCapture {
	/** Drops the draft once the drawing it holds is saved, after any write in flight. */
	readonly clear: () => Promise<void>;
	/** Records the newest scene; scenes that arrive while a write runs collapse into one. */
	readonly write: (scene: ExcalidrawScene) => void;
}

export function createDrawingDraftCapture(diagramId: string): DrawingDraftCapture {
	const key = draftKey(diagramId);
	let pending: ExcalidrawScene | undefined;
	let scheduled = false;
	// A clear cancels writes scheduled before it; later writes queue behind it.
	let generation = 0;
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (operation: () => Promise<void>) => {
		queue = queue.then(operation).catch(() => undefined);
		return queue;
	};
	return {
		clear: () => {
			generation += 1;
			pending = undefined;
			scheduled = false;
			return enqueue(() => del(key, drafts()));
		},
		write: (scene) => {
			pending = scene;
			if (scheduled) return;
			scheduled = true;
			const scheduledIn = generation;
			void enqueue(async () => {
				if (scheduledIn !== generation) return;
				scheduled = false;
				const next = pending;
				pending = undefined;
				if (next) await set(key, drawingFromScene(next), drafts());
			});
		},
	};
}
