import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { formatCollectionLabel, type IconManifest, type SketchiIcon } from "@sketchi/icon-catalog";
import { filterIcons, toggleCollection } from "../../lib/filter.js";
import { PLAYGROUND_URL, REPO_URL, SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import { permanentSvgUrl } from "../../lib/permanent-svg-url.js";
import { useModifierLabel } from "../../lib/use-modifier-label.js";
import {
	createSelectionStore,
	describeSelectionNotice,
	remainingCapacity,
	SELECTION_LIMIT,
	selectResultsLabel,
	type SelectionEvent,
} from "../../lib/selection.js";
import { IconCard } from "../icon-card/index.js";
import { IconDetail } from "../icon-detail/index.js";
import type { PreviewMode } from "../preview-toggle/index.js";
import { CommandPalette, type IconCommand, type PaletteLink } from "./command-palette.js";
import { IconsChrome } from "./icons-chrome.js";
import { IconToolbar } from "./icon-toolbar.js";
import { SelectionBar } from "./selection-bar.js";
import { type SelectionAction, useIconSources } from "./use-icon-sources.js";

export type { IconManifest, SketchiIcon } from "@sketchi/icon-catalog";

const PAGE_SIZE = 72;
/** Nothing is highlighted until the user actually navigates with the keyboard. */
const NO_ACTIVE_INDEX = -1;

type LoadStatus = "error" | "loading" | "ready";

export interface IconLibraryProps {
	readonly data?: IconManifest;
	readonly errorMessage?: string;
	readonly homeHref?: string;
	/** Collections to filter by on first render. Empty means all. */
	readonly initialCollections?: readonly string[];
	readonly initialPreviewMode?: PreviewMode;
	readonly initialQuery?: string;
	readonly onRetry?: () => void;
	readonly status?: LoadStatus;
}

const emptyData: IconManifest = {
	icons: [],
	summary: { collectionCounts: {}, totalIcons: 0 },
	version: 1,
};

const noCollections: readonly string[] = [];

function isActionTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.closest("a, button") !== null;
}

const nonTextInputTypes = new Set(["button", "checkbox", "radio", "reset", "submit"]);

/**
 * Fields where Mod+A means "select this text". The selection checkboxes are
 * inputs too, but have no text, so selection shortcuts still apply there.
 */
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target instanceof HTMLInputElement) return !nonTextInputTypes.has(target.type);
	return (
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

/** The commands, if they currently apply. */
function commandsWhen(applies: boolean, ...commands: IconCommand[]): readonly IconCommand[] {
	return applies ? commands : [];
}

function plural(count: number, one: string, many: string): string {
	return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function IconLibrary({
	data = emptyData,
	errorMessage,
	homeHref = SKETCHI_WEB_HOME_URL,
	initialCollections = noCollections,
	initialPreviewMode = "light",
	initialQuery = "",
	onRetry,
	status = "ready",
}: IconLibraryProps) {
	const [query, setQuery] = useState(initialQuery);
	const [collections, setCollections] = useState<ReadonlySet<string>>(
		() => new Set(initialCollections),
	);
	const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [highlightedIndex, setHighlightedIndex] = useState(NO_ACTIVE_INDEX);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [detail, setDetail] = useState<{
		readonly opener: HTMLElement | null;
		readonly slug: string;
	}>();
	const [selectionStore] = useState(() => createSelectionStore());
	const selection = useSyncExternalStore(
		selectionStore.subscribe,
		selectionStore.getSnapshot,
		selectionStore.getSnapshot,
	);
	const selectedSlugs = selection.slugs;
	const searchRef = useRef<HTMLInputElement>(null);
	const collectionOptions = useMemo(
		() =>
			Object.entries(data.summary.collectionCounts).sort(([left], [right]) =>
				formatCollectionLabel(left).localeCompare(formatCollectionLabel(right)),
			),
		[data.summary.collectionCounts],
	);
	const results = useMemo(
		() => filterIcons(data.icons, { collections, query }),
		[collections, data.icons, query],
	);
	const filtered = query.trim() !== "" || collections.size > 0;
	// A highlight past the end of the current results (for example after the
	// manifest changes) reads as no highlight.
	const activeIndex = highlightedIndex < results.length ? highlightedIndex : NO_ACTIVE_INDEX;
	const visibleIcons = results.slice(0, visibleCount);
	const detailIcon = detail ? data.icons.find((icon) => icon.slug === detail.slug) : undefined;
	const selectedIcons = data.icons.filter((icon) => selectedSlugs.has(icon.slug));
	const capacityLeft = remainingCapacity(selectedSlugs);
	const selectionIsFull = capacityLeft === 0;
	const selectedInResults = results.filter((icon) => selectedSlugs.has(icon.slug)).length;
	const pendingCount = results.length - selectedInResults;
	const hiddenSelectedCount = selectedIcons.length - selectedInResults;
	const allResultsSelected = results.length > 0 && pendingCount === 0;
	// Selecting the whole unfiltered library is never the point, so the
	// checkbox, its shortcut, and its command only appear once a search or
	// filter has narrowed things down, or when everything fits under the cap.
	const showSelectResults =
		status === "ready" && results.length > 0 && (filtered || results.length <= SELECTION_LIMIT);
	const canSelectResults = showSelectResults && pendingCount > 0 && capacityLeft > 0;
	// The grid's keys stand down whenever a dialog or menu owns the keyboard.
	const overlayOpen = Boolean(detailIcon) || paletteOpen;
	const [menuOpen, setMenuOpen] = useState(false);
	const gridKeysActive = !overlayOpen && !menuOpen;
	const closeDetail = useCallback(() => setDetail(undefined), []);
	// Hydration-safe: the server renders "Ctrl", and Mac clients switch after.
	const modifierLabel = useModifierLabel();

	const {
		busyDetailAction,
		busySelectionAction,
		copiedSlug,
		copyingSlug,
		copySvg,
		notice,
		runDetailAction,
		runSelectionAction,
		selectionProgress,
		showNotice,
	} = useIconSources(selectedIcons);

	// Changing the filter starts browsing from the top of the new results.
	// The selection is deliberately left alone.
	const resetBrowsing = useCallback(() => {
		setVisibleCount(PAGE_SIZE);
		setHighlightedIndex(NO_ACTIVE_INDEX);
	}, []);

	const changeQuery = useCallback(
		(nextQuery: string) => {
			setQuery(nextQuery);
			resetBrowsing();
		},
		[resetBrowsing],
	);

	const changeCollection = useCallback(
		(collection: string) => {
			setCollections((current) => toggleCollection(current, collection));
			resetBrowsing();
		},
		[resetBrowsing],
	);

	const clearCollections = useCallback(() => {
		setCollections(new Set());
		resetBrowsing();
	}, [resetBrowsing]);

	const clearFilters = useCallback(() => {
		setQuery("");
		setCollections(new Set());
		resetBrowsing();
	}, [resetBrowsing]);

	const moveActive = useCallback(
		(direction: -1 | 1) => {
			if (!results.length) return;
			const next =
				activeIndex === NO_ACTIVE_INDEX
					? direction === 1
						? 0
						: results.length - 1
					: (activeIndex + direction + results.length) % results.length;
			setHighlightedIndex(next);
			setVisibleCount((count) => Math.max(count, next + 1));
			const slug = results[next]?.slug;
			if (!slug) return;
			window.setTimeout(() => {
				document.getElementById(`icon-result-${slug}`)?.scrollIntoView?.({ block: "nearest" });
			}, 0);
		},
		[activeIndex, results],
	);

	// The store reports what an event did as data; the handler that caused it
	// announces it, so no selection update fires a side effect mid-update.
	const dispatchSelection = useCallback(
		(event: SelectionEvent) => {
			const selectionNotice = selectionStore.dispatch(event);
			if (selectionNotice) showNotice(describeSelectionNotice(selectionNotice));
		},
		[selectionStore, showNotice],
	);

	const selectAllResults = useCallback(() => {
		dispatchSelection({
			slugs: results.map((icon) => icon.slug),
			type: "select-all",
		});
	}, [dispatchSelection, results]);

	const deselectResults = useCallback(() => {
		dispatchSelection({
			slugs: results.map((icon) => icon.slug),
			type: "deselect",
		});
	}, [dispatchSelection, results]);

	const clearSelection = useCallback(
		() => dispatchSelection({ type: "clear" }),
		[dispatchSelection],
	);

	const focusSearch = useCallback(() => searchRef.current?.focus(), []);

	const clearSearch = useCallback(() => {
		setHighlightedIndex(NO_ACTIVE_INDEX);
		if (!query) return;
		changeQuery("");
		searchRef.current?.focus();
	}, [changeQuery, query]);

	/**
	 * Copies the keyboard-highlighted icon. With nothing highlighted, Enter from
	 * the search field falls back to the top result so "type, Enter" still works.
	 */
	const copyKeyboardTarget = useCallback(
		(event: KeyboardEvent, allowTopResult: boolean) => {
			if (event.defaultPrevented) return;
			const icon =
				activeIndex === NO_ACTIVE_INDEX
					? allowTopResult
						? results[0]
						: undefined
					: results[activeIndex];
			if (!icon) return;
			event.preventDefault();
			void copySvg(icon);
		},
		[activeIndex, copySvg, results],
	);

	/**
	 * Buttons and links are not "inputs", so the hotkey manager would happily
	 * steal their arrow keys. Leave them alone, and only swallow the default
	 * scroll when the highlight actually moves.
	 */
	const moveFromKey = useCallback(
		(event: KeyboardEvent, direction: -1 | 1, fromSearch: boolean) => {
			if (event.defaultPrevented) return;
			if (!fromSearch && isActionTarget(event.target)) return;
			if (!results.length) return;
			event.preventDefault();
			moveActive(direction);
		},
		[moveActive, results.length],
	);

	// The selection bar and the palette start the same bulk export.
	const startSelectionAction = useCallback(
		(action: SelectionAction) => void runSelectionAction(action),
		[runSelectionAction],
	);

	const selectedCount = selectedIcons.length;
	const selectionBusy = busySelectionAction !== undefined;
	const selectedLabel = plural(selectedCount, "selected SVG", "selected SVGs");

	// One list of commands feeds both the palette and the keyboard shortcuts
	// registered below, so every name and key is defined once.
	const commands: readonly IconCommand[] = [
		{ hotkey: "/", id: "search", name: "Search icons", run: focusSearch, takesFocus: true },
		...commandsWhen(canSelectResults, {
			hotkey: "Mod+A",
			id: "select-results",
			name:
				pendingCount > capacityLeft
					? `Select ${capacityLeft.toLocaleString()} of these results`
					: `Select all ${plural(results.length, "result", "results")}`,
			run: selectAllResults,
		}),
		...commandsWhen(
			selectedCount > 0 && !selectionBusy,
			{
				id: "copy-selected",
				name: `Copy ${selectedLabel}`,
				run: () => startSelectionAction("copy"),
			},
			{
				id: "download-selected",
				name: `Download ${selectedLabel} as zip`,
				run: () => startSelectionAction("zip"),
			},
		),
		...commandsWhen(selectedCount > 0, {
			hotkey: "Mod+D",
			id: "clear-selection",
			name: "Clear selection",
			run: clearSelection,
		}),
		...commandsWhen(filtered, {
			id: "clear-filters",
			name: "Clear search and filters",
			run: clearFilters,
		}),
		{
			id: "preview",
			name: previewMode === "light" ? "Use dark preview" : "Use light preview",
			run: () => setPreviewMode(previewMode === "light" ? "dark" : "light"),
		},
	];

	const links: readonly PaletteLink[] = [
		{ href: `${homeHref}/docs`, name: "Docs" },
		{ external: true, href: REPO_URL, name: "GitHub" },
		{ href: "/llms.txt", name: "llms.txt" },
		{ href: PLAYGROUND_URL, name: "Playground" },
		{ href: homeHref, name: "Sketchi home" },
	];

	// Arrow and Enter shortcuts have to work both from the search field and from
	// the page at large, but must leave every other input alone — notably the
	// selection checkboxes, whose own keys we do not want to hijack. One
	// registration targets the search field (`ignoreInputs: false`), the other
	// the document, where the default input handling skips form controls.
	const gridHotkeys: UseHotkeyDefinition[] = (
		[
			["ArrowDown", 1],
			["ArrowUp", -1],
			["ArrowRight", 1],
			["ArrowLeft", -1],
		] as const
	).flatMap(([hotkey, direction]) => [
		{
			callback: (event: KeyboardEvent) => moveFromKey(event, direction, true),
			hotkey,
			options: {
				enabled: gridKeysActive,
				ignoreInputs: false,
				meta: { group: "Icon grid", name: "Move highlight" },
				preventDefault: false,
				target: searchRef,
			},
		},
		{
			callback: (event: KeyboardEvent) => moveFromKey(event, direction, false),
			hotkey,
			options: {
				enabled: gridKeysActive,
				meta: { group: "Icon grid", name: "Move highlight" },
				preventDefault: false,
			},
		},
	]);

	useHotkeys([
		// The palette shortcut works from anywhere, the search field included,
		// and closes the palette again from inside it.
		{
			callback: () => setPaletteOpen((open) => !open),
			hotkey: "Mod+K",
			options: {
				enabled: !detailIcon,
				ignoreInputs: false,
				meta: { name: "Commands" },
			},
		},
		...gridHotkeys,
		{
			callback: focusSearch,
			hotkey: "/",
			options: { enabled: gridKeysActive, meta: { name: "Search icons" } },
		},
		// On layouts where slash is a shifted key — Shift+7 on German QWERTZ —
		// the event still reads `key: "/"` but carries Shift, which the plain
		// "/" registration rejects. This also picks up "?" on US layouts.
		{
			callback: focusSearch,
			hotkey: { key: "/", shift: true },
			options: { enabled: gridKeysActive, meta: { name: "Search icons" } },
		},
		{
			callback: (event) => copyKeyboardTarget(event, true),
			hotkey: "Enter",
			// Enter must still activate whatever button has focus, so the default
			// action is only suppressed when we actually copy something.
			options: {
				enabled: gridKeysActive,
				ignoreInputs: false,
				meta: { group: "Icon grid", name: "Copy SVG" },
				preventDefault: false,
				target: searchRef,
			},
		},
		{
			callback: (event) => {
				if (isActionTarget(event.target)) return;
				copyKeyboardTarget(event, false);
			},
			hotkey: "Enter",
			options: {
				enabled: gridKeysActive,
				meta: { group: "Icon grid", name: "Copy SVG" },
				preventDefault: false,
			},
		},
		// These stay disabled when they would do nothing: an enabled hotkey
		// suppresses the browser's own Escape, Select All and Bookmark Page even
		// when our callback bails out.
		// Radix handles Escape first and dismisses the palette, menu, or tooltip;
		// React re-renders before this listener sees the same event, so the
		// registration is already re-enabled. An Escape that was already used
		// (`defaultPrevented`) is not ours to clear the search with.
		{
			callback: (event) => {
				if (event.defaultPrevented) return;
				event.preventDefault();
				clearSearch();
			},
			hotkey: "Escape",
			options: {
				enabled: gridKeysActive && (query !== "" || activeIndex !== NO_ACTIVE_INDEX),
				meta: { group: "Icon grid", name: "Clear search" },
				preventDefault: false,
			},
		},
		// Mod+A and Mod+D have to work from the selection checkboxes, where focus
		// lands after ticking an icon, so neither skips inputs wholesale. Mod+A
		// still yields to text fields, where it selects the text; Mod+D has no
		// in-field meaning, so it clears from the search field too.
		{
			callback: (event) => {
				if (isTextEntry(event.target)) return;
				event.preventDefault();
				selectAllResults();
			},
			hotkey: "Mod+A",
			options: {
				// Mirrors the select-results checkbox: enabled only when it would
				// actually add something, so the browser keeps Select All otherwise.
				enabled: gridKeysActive && canSelectResults,
				ignoreInputs: false,
				meta: { name: "Select results" },
				preventDefault: false,
			},
		},
		{
			callback: clearSelection,
			hotkey: "Mod+D",
			options: {
				enabled: gridKeysActive && selectedCount > 0,
				ignoreInputs: false,
				meta: { name: "Clear selection" },
			},
		},
	]);

	function toggleSelected(icon: SketchiIcon) {
		dispatchSelection({ slug: icon.slug, type: "toggle" });
	}

	function navigate(link: PaletteLink) {
		if (link.external) window.open(link.href, "_blank", "noopener,noreferrer");
		else window.location.assign(link.href);
	}

	return (
		<TooltipProvider>
			<div className="icons-product">
				<IconsChrome
					commandShortcut={modifierLabel === "⌘" ? "⌘K" : "Ctrl K"}
					detailOpen={Boolean(detailIcon)}
					homeHref={homeHref}
					onOpenCommands={() => setPaletteOpen(true)}
				>
					<main
						aria-hidden={detailIcon ? "true" : undefined}
						className="icons-main"
						inert={detailIcon ? true : undefined}
					>
						<div className="icons-shell">
							<IconToolbar
								activeIcon={results[activeIndex]}
								collectionOptions={collectionOptions}
								collections={collections}
								onClearCollections={clearCollections}
								onCollectionMenuChange={setMenuOpen}
								onPreviewModeChange={setPreviewMode}
								onQueryChange={changeQuery}
								onToggleCollection={changeCollection}
								previewMode={previewMode}
								query={query}
								searchRef={searchRef}
							/>

							<div className="icons-results-bar">
								<p aria-live="polite" className="icons-results-bar__count" role="status">
									{status === "ready" ? plural(results.length, "icon", "icons") : ""}
								</p>
								{showSelectResults ? (
									<label className="icons-select-results">
										<input
											aria-label={
												pendingCount > capacityLeft && capacityLeft > 0
													? `Select ${capacityLeft.toLocaleString()} of ${plural(results.length, "result", "results")}`
													: "Select all results"
											}
											checked={allResultsSelected}
											disabled={!allResultsSelected && capacityLeft === 0}
											onChange={allResultsSelected ? deselectResults : selectAllResults}
											ref={(element) => {
												if (element) {
													element.indeterminate = selectedInResults > 0 && !allResultsSelected;
												}
											}}
											type="checkbox"
										/>
										<span aria-hidden="true">{selectResultsLabel(pendingCount, capacityLeft)}</span>
									</label>
								) : null}
							</div>

							{status === "loading" ? (
								<section className="icons-loading" aria-label="Loading icons" role="status">
									{Array.from({ length: 12 }, (_, index) => (
										<span className="icons-loading__tile" key={index} />
									))}
									<span className="sr-only">Loading icons</span>
								</section>
							) : null}

							{status === "error" ? (
								<section className="icons-state" role="alert">
									<h2>Could not load the icon library</h2>
									<p>{errorMessage ?? "Check your connection and try again."}</p>
									{onRetry ? (
										<button onClick={onRetry} type="button">
											Try again
										</button>
									) : null}
								</section>
							) : null}

							{status === "ready" && !results.length ? (
								<section className="icons-state">
									<h2>No icons found</h2>
									<p>
										{collections.size && query.trim()
											? "Nothing in the chosen collections matches. Try all collections or another name."
											: "Try a brand name or a common alias, such as k8s or psql."}
									</p>
									<div className="icons-state__actions">
										{collections.size && query.trim() ? (
											<button onClick={clearCollections} type="button">
												Search all collections
											</button>
										) : null}
										<button onClick={clearFilters} type="button">
											Clear search and filters
										</button>
									</div>
								</section>
							) : null}

							{status === "ready" && results.length ? (
								<>
									<section aria-label="Icon results" className="icons-grid" id="icon-results">
										{visibleIcons.map((icon, index) => (
											<IconCard
												active={index === activeIndex}
												copied={copiedSlug === icon.slug}
												copying={copyingSlug === icon.slug}
												icon={icon}
												key={icon.slug}
												onCopy={(picked) => void copySvg(picked)}
												onDetails={(picked) => {
													setDetail({
														opener:
															document.activeElement instanceof HTMLElement
																? document.activeElement
																: null,
														slug: picked.slug,
													});
												}}
												onToggleSelected={toggleSelected}
												previewMode={previewMode}
												selected={selectedSlugs.has(icon.slug)}
											/>
										))}
									</section>
									{visibleIcons.length < results.length ? (
										<div className="icons-more">
											<button
												onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
												type="button"
											>
												Show {Math.min(PAGE_SIZE, results.length - visibleCount)} more
											</button>
										</div>
									) : null}
								</>
							) : null}
						</div>
					</main>
				</IconsChrome>

				{detailIcon ? (
					<div className="icon-detail-layer">
						<button
							aria-label="Close icon details"
							className="icon-detail-layer__scrim"
							onClick={closeDetail}
							tabIndex={-1}
							type="button"
						/>
						<IconDetail
							{...(busyDetailAction ? { busyAction: busyDetailAction } : {})}
							icon={detailIcon}
							onAction={(action, icon) => void runDetailAction(action, icon)}
							onClose={closeDetail}
							onPreviewModeChange={setPreviewMode}
							permanentUrl={permanentSvgUrl(detailIcon.slug)}
							previewMode={previewMode}
							returnFocusTo={detail?.opener ?? null}
						/>
					</div>
				) : null}

				<CommandPalette
					collections={collections}
					commands={commands}
					links={links}
					onClearCollections={clearCollections}
					onNavigate={navigate}
					onOpenChange={setPaletteOpen}
					onToggleCollection={changeCollection}
					open={paletteOpen}
					options={collectionOptions}
				/>

				<SelectionBar
					busySelectionAction={busySelectionAction}
					detailOpen={Boolean(detailIcon)}
					hiddenCount={hiddenSelectedCount}
					onAction={startSelectionAction}
					onClear={clearSelection}
					selectedCount={selectedCount}
					selectionIsFull={selectionIsFull}
					selectionProgress={selectionProgress}
				/>

				<div aria-live="polite" aria-atomic="true" className="icons-toast" role="status">
					{notice}
				</div>
			</div>
		</TooltipProvider>
	);
}
