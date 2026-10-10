import type { RefObject } from "react";
import { formatCollectionLabel, type SketchiIcon } from "@sketchi/icon-catalog";
import { selectAllLabel } from "../../lib/selection.js";

export function IconToolbar({
	activeIcon,
	capacityLeft,
	collection,
	collections,
	modifierLabel,
	onCollectionChange,
	onPreviewModeChange,
	onQueryChange,
	onSelectAll,
	pendingCount,
	previewMode,
	query,
	resultCount,
	searchRef,
	selectionIsFull,
	status,
}: {
	activeIcon: SketchiIcon | undefined;
	capacityLeft: number;
	collection: string;
	collections: readonly [string, number][];
	modifierLabel: string;
	onCollectionChange: (value: string) => void;
	onPreviewModeChange: (value: "light" | "dark") => void;
	onQueryChange: (value: string) => void;
	onSelectAll: () => void;
	pendingCount: number;
	previewMode: "light" | "dark";
	query: string;
	resultCount: number;
	searchRef: RefObject<HTMLInputElement | null>;
	selectionIsFull: boolean;
	status: "loading" | "error" | "ready";
}) {
	return (
		<>
			<div className="icons-toolbar">
				<label className="icons-search">
					<span id="icon-search-label">Search icons</span>
					<span className="icons-search__box">
						<input
							aria-labelledby="icon-search-label"
							aria-activedescendant={activeIcon ? `icon-result-${activeIcon.slug}` : undefined}
							aria-controls="icon-results"
							onChange={(event) => onQueryChange(event.currentTarget.value)}
							placeholder="Try k8s, next, psql, or Vercel"
							ref={searchRef}
							type="search"
							value={query}
						/>
						{query ? (
							<button aria-label="Clear search" onClick={() => onQueryChange("")} type="button">
								Clear
							</button>
						) : (
							<kbd>/</kbd>
						)}
					</span>
				</label>
				<label className="icons-collection">
					<span id="icon-collection-label">Collection</span>
					<select
						aria-labelledby="icon-collection-label"
						onChange={(event) => onCollectionChange(event.currentTarget.value)}
						value={collection}
					>
						<option value="all">All collections</option>
						{collections.map(([name, count]) => (
							<option key={name} value={name}>
								{formatCollectionLabel(name)} ({count})
							</option>
						))}
					</select>
				</label>
				<div className="preview-toggle preview-toggle--toolbar">
					<span>Preview</span>
					<div className="preview-toggle__buttons">
						<button
							aria-pressed={previewMode === "light"}
							onClick={() => onPreviewModeChange("light")}
							type="button"
						>
							Light
						</button>
						<button
							aria-pressed={previewMode === "dark"}
							onClick={() => onPreviewModeChange("dark")}
							type="button"
						>
							Dark
						</button>
					</div>
				</div>
			</div>

			<div className="icons-browser__meta">
				<div className="icons-browser__count">
					<p aria-live="polite" role="status">
						{status === "ready"
							? `${resultCount.toLocaleString()} ${resultCount === 1 ? "icon" : "icons"}`
							: ""}
					</p>
					{status === "ready" && resultCount ? (
						<button
							className="icons-browser__select-all"
							disabled={selectionIsFull || pendingCount === 0}
							onClick={onSelectAll}
							type="button"
						>
							{selectAllLabel(resultCount, pendingCount, capacityLeft)}
						</button>
					) : null}
				</div>
				<p className="icons-browser__keys">
					<kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> copy SVG <kbd>{modifierLabel}</kbd>{" "}
					<kbd>A</kbd> select all <kbd>{modifierLabel}</kbd> <kbd>D</kbd> clear selection{" "}
					<kbd>Esc</kbd> clear search
				</p>
			</div>
		</>
	);
}
