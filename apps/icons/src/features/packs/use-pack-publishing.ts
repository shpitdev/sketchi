import { useCallback, useState } from "react";
import { useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import type { PackExcalidrawState, PublishResult } from "../../lib/excalidraw-publish.js";

/**
 * The packs' Excalidraw states as the server rendered them, updated when a
 * visitor publishes one here: it gets its install link and its open pull
 * request, and is not offered again.
 */
export function usePackPublishing(initial: Readonly<Record<string, PackExcalidrawState>> = {}) {
	const [state] = useState(() => Atom.make(initial));
	const [states, setStates] = useAtom(state);
	const [dialog] = useState(() => Atom.make<string | undefined>(undefined));
	const [publishing, setPublishing] = useAtom(dialog);
	const published = useCallback(
		(id: string, result: PublishResult) => {
			setStates((current) => {
				const installUrl = result.installUrl ?? current[id]?.installUrl;
				const state: PackExcalidrawState = {
					...(installUrl ? { installUrl } : {}),
					pullRequest: { url: result.pullRequestUrl, state: "open" },
					publishable: false,
				};
				return { ...current, [id]: state };
			});
		},
		[setStates],
	);
	return {
		states,
		publishing,
		open: setPublishing,
		close: useCallback(() => setPublishing(undefined), [setPublishing]),
		published,
	};
}
