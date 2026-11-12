import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "sketchi-icons:drawn-names";
const listeners = new Set<() => void>();
/** The latest choice, which holds for the page whatever storage does. */
let current = false;
/**
 * Set once a write fails (storage full or refused): from then on the stored
 * value is stale, so the page reads its own choice instead.
 */
let unstored = false;

function readChoice(): boolean {
	if (unstored) return current;
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "on";
	} catch {
		return current;
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
 * choice for every page, kept in the browser when it can be; the server
 * renders without names.
 */
export function useDrawnNames(): readonly [boolean, (named: boolean) => void] {
	const named = useSyncExternalStore(subscribe, readChoice, () => false);
	const setNamed = useCallback((next: boolean) => {
		current = next;
		try {
			window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
		} catch {
			unstored = true;
		}
		for (const listener of listeners) listener();
	}, []);
	return [named, setNamed];
}
