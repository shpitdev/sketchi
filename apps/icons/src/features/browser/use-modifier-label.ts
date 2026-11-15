import { useAtomValue } from "@effect/atom-react";
import { detectPlatform } from "@tanstack/react-hotkeys";
import { Atom } from "effect/reactivity";
import { useState } from "react";

export function useModifierLabel(): string {
	const [label] = useState(() =>
		Atom.make(() => (detectPlatform() === "mac" ? "⌘" : "Ctrl")).pipe(
			Atom.withServerValue(() => "Ctrl"),
		),
	);
	return useAtomValue(label);
}
