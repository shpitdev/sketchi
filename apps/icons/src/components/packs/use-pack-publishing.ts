import { useCallback, useState } from "react";

import type { PackExcalidrawState, PublishResult } from "../../lib/excalidraw-publish.js";

/**
 * The packs' Excalidraw states as the server rendered them, updated when a
 * visitor publishes one here: it gets its install link and is not offered
 * again.
 */
export function usePackPublishing(initial: Readonly<Record<string, PackExcalidrawState>> = {}) {
	const [states, setStates] = useState(initial);
	const [publishing, setPublishing] = useState<string>();
	const published = useCallback((id: string, result: PublishResult) => {
		setStates((current) => {
			const installUrl = result.installUrl ?? current[id]?.installUrl;
			return { ...current, [id]: { ...(installUrl ? { installUrl } : {}), publishable: false } };
		});
	}, []);
	return {
		states,
		publishing,
		open: setPublishing,
		close: useCallback(() => setPublishing(undefined), []),
		published,
	};
}
