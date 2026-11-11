import { useCallback } from "react";

/** How far below the viewport the next page starts rendering, so scrolling rarely meets the end. */
const LOOKAHEAD = "0px 0px 1200px 0px";

/**
 * A ref for an element after the last result. `onNearEnd` runs whenever that
 * element comes within the lookahead of the viewport, while there is more to
 * load: `loaded` is how many results are on the page, or undefined when that
 * is all of them. Each new count attaches a fresh observer, which reports at
 * once whether the element is still near, so a page shorter than the screen
 * fills up without a scroll.
 */
export function useLoadOnScroll<Sentinel extends Element>(
	loaded: number | undefined,
	onNearEnd: () => void,
) {
	return useCallback(
		(element: Sentinel | null) => {
			if (loaded === undefined || !element || typeof IntersectionObserver === "undefined") return;
			const observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((entry) => entry.isIntersecting)) onNearEnd();
				},
				{ rootMargin: LOOKAHEAD },
			);
			observer.observe(element);
			return () => observer.disconnect();
		},
		[loaded, onNearEnd],
	);
}
