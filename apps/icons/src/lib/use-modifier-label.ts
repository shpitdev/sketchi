import { detectPlatform } from "@tanstack/react-hotkeys";
import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const getSnapshot = () => (detectPlatform() === "mac" ? "⌘" : "Ctrl");
const getServerSnapshot = () => "Ctrl";

/** Platform is immutable; the server snapshot keeps hydration consistent. */
export function useModifierLabel(): string {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
