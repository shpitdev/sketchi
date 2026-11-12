import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "sketchi-icons:drawn-names";
const listeners = new Set<() => void>();
/** The choice when the browser keeps no storage: it then lasts for the page. */
let unstored = false;

function readChoice(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "on";
	} catch {
		return unstored;
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener("storage", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

/**
 * Whether drawings are shown, copied and downloaded with their names. One
 * choice for every page, kept in the browser; the server renders without names.
 */
export function useDrawnNames(): readonly [boolean, (named: boolean) => void] {
	const named = useSyncExternalStore(subscribe, readChoice, () => false);
	const setNamed = useCallback((next: boolean) => {
		unstored = next;
		try {
			window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
		} catch {
			// Without storage the choice still holds until the page closes.
		}
		for (const listener of listeners) listener();
	}, []);
	return [named, setNamed];
}
