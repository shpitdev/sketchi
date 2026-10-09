import { SELECTION_LIMIT } from "../../lib/selection.js";
import type { SelectionAction } from "./use-icon-sources.js";

export function SelectionBar({
  busySelectionAction,
  detailOpen,
  onAction,
  onClear,
  selectedCount,
  selectionIsFull,
  selectionProgress,
}: {
  busySelectionAction: SelectionAction | undefined;
  detailOpen: boolean;
  onAction: (action: SelectionAction) => Promise<void>;
  onClear: () => void;
  selectedCount: number;
  selectionIsFull: boolean;
  selectionProgress: { done: number; total: number };
}) {
  return selectedCount ? (
    <section
      aria-hidden={detailOpen ? "true" : undefined}
      aria-label="Selected icons"
      className="selection-bar"
      inert={detailOpen ? true : undefined}
    >
      <div className="selection-bar__count">
        <strong>{selectedCount.toLocaleString()}</strong>
        <span>
          {selectedCount === 1 ? "icon" : "icons"} selected
          {selectionIsFull
            ? ` — capped at ${SELECTION_LIMIT.toLocaleString()}`
            : ""}
        </span>
      </div>
      <div className="selection-bar__actions">
        <button
          disabled={busySelectionAction !== undefined}
          onClick={() => void onAction("copy")}
          type="button"
        >
          {busySelectionAction === "copy"
            ? `Copying ${selectionProgress.done}/${selectionProgress.total}`
            : "Copy all SVG"}
        </button>
        <button
          className="is-primary"
          disabled={busySelectionAction !== undefined}
          onClick={() => void onAction("zip")}
          type="button"
        >
          {busySelectionAction === "zip"
            ? `Building zip ${selectionProgress.done}/${selectionProgress.total}`
            : "Download zip"}
        </button>
        <button
          disabled={busySelectionAction !== undefined}
          onClick={onClear}
          type="button"
        >
          Clear selection
        </button>
      </div>
    </section>
  ) : null;
}
