import { Search, X } from "lucide-react";
import type { RefObject } from "react";
import type { SketchiIcon } from "@sketchi/icon-catalog";

import { PreviewToggle, type PreviewMode } from "../preview-toggle/index.js";
import { CollectionFilter } from "./collection-filter.js";

/** The page heading, search field, collection filter, and preview background. */
export function IconToolbar({
	activeIcon,
	collections,
	collectionOptions,
	onClearCollections,
	onCollectionMenuChange,
	onPreviewModeChange,
	onQueryChange,
	onToggleCollection,
	previewMode,
	query,
	searchRef,
}: {
	activeIcon: SketchiIcon | undefined;
	collections: ReadonlySet<string>;
	collectionOptions: readonly (readonly [string, number])[];
	onClearCollections: () => void;
	onCollectionMenuChange: (open: boolean) => void;
	onPreviewModeChange: (value: PreviewMode) => void;
	onQueryChange: (value: string) => void;
	onToggleCollection: (collection: string) => void;
	previewMode: PreviewMode;
	query: string;
	searchRef: RefObject<HTMLInputElement | null>;
}) {
	return (
		<div className="icons-toolbar">
			<h1 className="icons-title">Icons</h1>
			<div className="icons-search">
				<Search aria-hidden="true" className="icons-search__icon" />
				<input
					aria-activedescendant={activeIcon ? `icon-result-${activeIcon.slug}` : undefined}
					aria-controls="icon-results"
					aria-label="Search icons"
					autoComplete="off"
					enterKeyHint="search"
					onChange={(event) => onQueryChange(event.currentTarget.value)}
					placeholder="Search icons"
					ref={searchRef}
					spellCheck={false}
					type="search"
					value={query}
				/>
				{query ? (
					<button
						aria-label="Clear search"
						className="icons-search__clear"
						onClick={() => {
							onQueryChange("");
							searchRef.current?.focus();
						}}
						title="Clear search"
						type="button"
					>
						<X aria-hidden="true" />
					</button>
				) : (
					<kbd aria-hidden="true" className="icons-search__key">
						/
					</kbd>
				)}
			</div>
			<CollectionFilter
				collections={collections}
				onClear={onClearCollections}
				onOpenChange={onCollectionMenuChange}
				onToggle={onToggleCollection}
				options={collectionOptions}
			/>
			<PreviewToggle onChange={onPreviewModeChange} value={previewMode} />
		</div>
	);
}
