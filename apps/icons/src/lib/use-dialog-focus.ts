import { useEffect, type RefObject } from "react";

/**
 * A modal panel's focus: focus `initial` on open, keep Tab inside `dialog`,
 * close on Escape, and return focus to the opener on close.
 */
export function useDialogFocus(input: {
	readonly dialog: RefObject<HTMLElement | null>;
	readonly initial: RefObject<HTMLElement | null>;
	readonly onClose: (() => void) | undefined;
	readonly returnFocusTo: HTMLElement | null | undefined;
}) {
	const { dialog, initial, onClose, returnFocusTo } = input;
	// oxlint-disable-next-line sketchi/no-react-effects -- modal focus trap: subscribes to window keydown and restores focus to the opener on close
	useEffect(() => {
		initial.current?.focus();

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose?.();
				return;
			}
			if (event.key !== "Tab") return;

			const focusable = Array.from(
				dialog.current?.querySelectorAll<HTMLElement>(
					'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
				) ?? [],
			).filter((element) => !element.hasAttribute("disabled"));
			const first = focusable[0];
			const last = focusable.at(-1);
			if (!first || !last) {
				event.preventDefault();
				return;
			}
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			} else if (!dialog.current?.contains(document.activeElement)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			}
		}

		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			if (returnFocusTo?.isConnected) returnFocusTo.focus();
		};
	}, [dialog, initial, onClose, returnFocusTo]);
}
