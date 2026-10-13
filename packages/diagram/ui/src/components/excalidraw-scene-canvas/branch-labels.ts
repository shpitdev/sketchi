import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type Position = { x: number; y: number };

/** Owns detached branch-label synchronization at the native editor boundary.
 * Copy coordinates: Excalidraw mutates its elements during pointer gestures.
 */
export function createBranchLabelSynchronizer() {
	let previous = new Map<string, Position>();
	return (elements: readonly OrderedExcalidrawElement[]): readonly OrderedExcalidrawElement[] => {
		const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
		const translations = new Map<string, Position>();
		for (const arrow of elements) {
			if (arrow.type !== "arrow" || arrow.isDeleted || !arrow.startBinding) continue;
			const source = byId.get(arrow.startBinding.elementId);
			const label = byId.get(`${arrow.id}:label`);
			if (!source || label?.type !== "text" || label.containerId) continue;
			const oldSource = previous.get(source.id),
				oldLabel = previous.get(label.id);
			// Native group moves and undo may already move the label. Never apply twice.
			if (!oldSource || !oldLabel || label.x !== oldLabel.x || label.y !== oldLabel.y) continue;
			const dx = source.x - oldSource.x,
				dy = source.y - oldSource.y;
			if (dx || dy) translations.set(label.id, { x: label.x + dx, y: label.y + dy });
		}
		const next = translations.size
			? elements.map((e) => {
					const position = translations.get(e.id);
					return position ? { ...e, ...position, version: e.version + 1 } : e;
				})
			: elements;
		previous = new Map(next.map((e) => [e.id, { x: e.x, y: e.y }]));
		return next;
	};
}
