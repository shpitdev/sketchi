import type {
	ExcalidrawArrowElement,
	OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { createRouteRelease, routeReleased } from "@sketchi/diagram-excalidraw";

/** Excalidraw's mutateElement, from the module the editor runs. */
export type MutateElement = typeof import("@excalidraw/excalidraw").mutateElement;

const isArrow = (
	element: OrderedExcalidrawElement,
): element is ExcalidrawArrowElement & OrderedExcalidrawElement =>
	element.type === "arrow" && !element.isDeleted;

/**
 * Releases folded routes from an Excalidraw editor's onChange, live during a
 * drag: the step runs on every change and costs well under a millisecond, and
 * Excalidraw routes a released arrow afresh on each later pointer move. Make
 * one per mounted editor, with the mutateElement of the module it runs. Returns
 * the elements as they now stand in the scene.
 */
export function createFoldedRouteRelease(mutateElement: MutateElement) {
	const release = createRouteRelease();
	return (
		api: Pick<ExcalidrawImperativeAPI, "getSceneElementsIncludingDeleted" | "updateScene">,
		elements: readonly OrderedExcalidrawElement[],
		selectedElementIds?: Readonly<Record<string, true>>,
	): readonly OrderedExcalidrawElement[] => {
		const { elements: next, released } = release(elements, selectedElementIds);
		if (released.length === 0) return elements;
		api.updateScene({ elements: next });
		const live = new Map(
			api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]),
		);
		for (const { id } of released) {
			const arrow = live.get(id);
			if (arrow && isArrow(arrow)) routeReleased(mutateElement, arrow);
		}
		return next;
	};
}
