import { Copy, Download, X } from "lucide-react";

import { SELECTION_LIMIT } from "../../lib/selection.js";
import type { SelectionAction } from "./use-icon-sources.js";

/**
 * Appears once anything is selected. The count covers the whole selection,
 * and icons the current search or filter hides are called out so they are
 * never exported by surprise.
 */
export function SelectionBar({
	busySelectionAction,
	detailOpen,
	hiddenCount,
	onAction,
	onClear,
	selectedCount,
	selectionIsFull,
	selectionProgress,
}: {
	busySelectionAction: SelectionAction | undefined;
	detailOpen: boolean;
	hiddenCount: number;
	onAction: (action: SelectionAction) => Promise<void>;
	onClear: () => void;
	selectedCount: number;
	selectionIsFull: boolean;
	selectionProgress: { done: number; total: number };
}) {
	if (!selectedCount) return null;
	const busy = busySelectionAction !== undefined;
	return (
		<section
			aria-hidden={detailOpen ? "true" : undefined}
			aria-label="Selected icons"
			className="selection-bar"
			inert={detailOpen ? true : undefined}
		>
			<p className="selection-bar__count">
				<strong>{selectedCount.toLocaleString()} selected</strong>
				{hiddenCount ? <span>{hiddenCount.toLocaleString()} not shown</span> : null}
				{selectionIsFull ? <span>Limit {SELECTION_LIMIT.toLocaleString()}</span> : null}
			</p>
			<div className="selection-bar__actions">
				<button disabled={busy} onClick={() => void onAction("copy")} type="button">
					<Copy aria-hidden="true" />
					{busySelectionAction === "copy"
						? `Copying ${selectionProgress.done}/${selectionProgress.total}`
						: "Copy SVGs"}
				</button>
				<button
					className="is-primary"
					disabled={busy}
					onClick={() => void onAction("zip")}
					type="button"
				>
					<Download aria-hidden="true" />
					{busySelectionAction === "zip"
						? `Zipping ${selectionProgress.done}/${selectionProgress.total}`
						: "Download zip"}
				</button>
				<button
					aria-label="Clear selection"
					className="selection-bar__clear"
					disabled={busy}
					onClick={onClear}
					title="Clear selection"
					type="button"
				>
					<X aria-hidden="true" />
				</button>
			</div>
		</section>
	);
}
