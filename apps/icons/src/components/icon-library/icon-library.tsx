import { permanentSvgUrl } from "../../lib/permanent-svg-url.js";
import { useModifierLabel } from "../../lib/use-modifier-label.js";
import { IconsChrome } from "./icons-chrome.js";
import { IconToolbar } from "./icon-toolbar.js";
import { SelectionBar } from "./selection-bar.js";
import { useIconSources } from "./use-icon-sources.js";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import {
	formatCollectionLabel,
	searchIcons,
	type IconManifest,
	type SketchiIcon,
} from "@sketchi/icon-catalog";
import {
	createSelectionStore,
	describeSelectionNotice,
	remainingCapacity,
	type SelectionEvent,
} from "../../lib/selection.js";
import { IconCard } from "../icon-card/index.js";
import { IconDetail } from "../icon-detail/index.js";

export type { IconManifest, SketchiIcon } from "@sketchi/icon-catalog";

const PAGE_SIZE = 72;
/** Nothing is highlighted until the user actually navigates with the keyboard. */
const NO_ACTIVE_INDEX = -1;

type LoadStatus = "error" | "loading" | "ready";
type PreviewMode = "dark" | "light";

export interface IconLibraryProps {
	readonly data?: IconManifest;
	readonly errorMessage?: string;
	readonly homeHref?: string;
	readonly initialCollection?: string;
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

function isActionTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && target.closest("a, button") !== null;
}

export function IconLibrary({
	data = emptyData,
	errorMessage,
	homeHref = SKETCHI_WEB_HOME_URL,
	initialCollection = "all",
	initialPreviewMode = "light",
	initialQuery = "",
	onRetry,
	status = "ready",
}: IconLibraryProps) {
	const [query, setQuery] = useState(initialQuery);
	const [collection, setCollection] = useState(initialCollection);
	const [previewMode, setPreviewMode] = useState<PreviewMode>(initialPreviewMode);
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const [highlightedIndex, setHighlightedIndex] = useState(NO_ACTIVE_INDEX);
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
	const collections = useMemo(
		() =>
			Object.entries(data.summary.collectionCounts).sort(([left], [right]) =>
				formatCollectionLabel(left).localeCompare(formatCollectionLabel(right)),
			),
		[data.summary.collectionCounts],
	);
	const results = useMemo(
		() =>
			searchIcons(data.icons, {
				...(collection === "all" ? {} : { collection }),
				...(query.trim() ? { query } : {}),
			}).map(({ icon }) => icon),
		[collection, data.icons, query],
	);
	// A highlight past the end of the current results (for example after the
	// manifest changes) reads as no highlight.
	const activeIndex = highlightedIndex < results.length ? highlightedIndex : NO_ACTIVE_INDEX;
	const visibleIcons = results.slice(0, visibleCount);
	const detailIcon = detail ? data.icons.find((icon) => icon.slug === detail.slug) : undefined;
	const selectedIcons = data.icons.filter((icon) => selectedSlugs.has(icon.slug));
	const capacityLeft = remainingCapacity(selectedSlugs);
	const selectionIsFull = capacityLeft === 0;
	const pendingCount = results.filter((icon) => !selectedSlugs.has(icon.slug)).length;
	const modifierLabel = useModifierLabel();
	const closeDetail = useCallback(() => setDetail(undefined), []);

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
	const changeQuery = useCallback((nextQuery: string) => {
		setQuery(nextQuery);
		setVisibleCount(PAGE_SIZE);
		setHighlightedIndex(NO_ACTIVE_INDEX);
	}, []);

	const changeCollection = useCallback((nextCollection: string) => {
		setCollection(nextCollection);
		setVisibleCount(PAGE_SIZE);
		setHighlightedIndex(NO_ACTIVE_INDEX);
	}, []);

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
				document.getElementById(`icon-result-${slug}`)?.scrollIntoView({ block: "nearest" });
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
			if (!fromSearch && isActionTarget(event.target)) return;
			if (!results.length) return;
			event.preventDefault();
			moveActive(direction);
		},
		[moveActive, results.length],
	);

	// Arrow and Enter shortcuts have to work both from the search field and from
	// the page at large, but must leave every other input alone — notably the
	// collection <select>, whose own arrow behaviour we do not want to hijack.
	// One registration targets the search field (`ignoreInputs: false`), the
	// other the document, where the default input handling skips form controls.
	const gridHotkeys = useMemo(
		() =>
			(
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
						ignoreInputs: false,
						preventDefault: false,
						target: searchRef,
					},
				},
				{
					callback: (event: KeyboardEvent) => moveFromKey(event, direction, false),
					hotkey,
					options: { preventDefault: false },
				},
			]),
		[moveFromKey],
	);

	useHotkeys(
		[
			...gridHotkeys,
			{ callback: focusSearch, hotkey: "/" },
			// On layouts where slash is a shifted key — Shift+7 on German QWERTZ —
			// the event still reads `key: "/"` but carries Shift, which the plain
			// "/" registration rejects. This also picks up "?" on US layouts.
			{ callback: focusSearch, hotkey: { key: "/", shift: true } },
			{
				callback: (event) => copyKeyboardTarget(event, true),
				hotkey: "Enter",
				// Enter must still activate whatever button has focus, so the default
				// action is only suppressed when we actually copy something.
				options: {
					ignoreInputs: false,
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
				options: { preventDefault: false },
			},
			// These three stay unregistered when they would do nothing: a registered
			// hotkey suppresses the browser's own Escape, Select All and Bookmark
			// Page even when our callback bails out.
			{
				callback: clearSearch,
				hotkey: "Escape",
				options: {
					enabled: !detailIcon && (query !== "" || activeIndex !== NO_ACTIVE_INDEX),
				},
			},
			{
				callback: selectAllResults,
				hotkey: "Mod+A",
				options: {
					// Mirrors the select-all button: enabled only when the click would
					// actually add something.
					enabled: !detailIcon && status === "ready" && pendingCount > 0 && capacityLeft > 0,
					// Leave Cmd/Ctrl+A alone while someone is editing the search text.
					ignoreInputs: true,
				},
			},
			// Clearing the selection has to work from the search field too: filtering
			// then clearing is the normal flow, and unlike Mod+A there is no native
			// in-field behaviour worth keeping. Mod+D is claimed on the field itself
			// and, separately, everywhere outside an input.
			{
				callback: clearSelection,
				hotkey: "Mod+D",
				options: {
					enabled: !detailIcon && selectedSlugs.size > 0,
					ignoreInputs: false,
					target: searchRef,
				},
			},
			{
				callback: clearSelection,
				hotkey: "Mod+D",
				options: {
					enabled: !detailIcon && selectedSlugs.size > 0,
					ignoreInputs: true,
				},
			},
		],
		{ enabled: !detailIcon },
	);

	function toggleSelected(icon: SketchiIcon) {
		dispatchSelection({ slug: icon.slug, type: "toggle" });
	}

	return (
		<div className="icons-product">
			<IconsChrome homeHref={homeHref} detailOpen={Boolean(detailIcon)}>
				<main
					aria-hidden={detailIcon ? "true" : undefined}
					className="icons-main"
					inert={detailIcon ? true : undefined}
				>
					<section className="icons-hero">
						<div className="icons-shell icons-hero__inner">
							<div className="icons-hero__copy">
								<h1>Icons, ready when you are.</h1>
								<p>
									Search {data.summary.totalIcons.toLocaleString()} clean SVGs. Copy one instantly
									or gather a set to download.
								</p>
							</div>
							<div className="icons-hero__facts" aria-label="Library summary">
								<span>
									<strong>{data.summary.totalIcons.toLocaleString()}</strong>
									Icons
								</span>
								<span>
									<strong>{collections.length.toLocaleString()}</strong>
									Collections
								</span>
							</div>
						</div>
					</section>

					<section className="icons-browser" aria-label="Browse icons">
						<div className="icons-shell">
							<IconToolbar
								activeIcon={results[activeIndex]}
								capacityLeft={capacityLeft}
								collection={collection}
								collections={collections}
								modifierLabel={modifierLabel}
								onCollectionChange={changeCollection}
								onPreviewModeChange={setPreviewMode}
								onQueryChange={changeQuery}
								onSelectAll={selectAllResults}
								pendingCount={pendingCount}
								previewMode={previewMode}
								query={query}
								resultCount={results.length}
								searchRef={searchRef}
								selectionIsFull={selectionIsFull}
								status={status}
							/>

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
									<h2>We could not load the icon library.</h2>
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
									<h2>No icons found.</h2>
									<p>Try a brand name, common alias, or another collection.</p>
									<button
										onClick={() => {
											changeQuery("");
											changeCollection("all");
										}}
										type="button"
									>
										Clear search
									</button>
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
					</section>
				</main>
			</IconsChrome>

			{detailIcon ? (
				<div className="icon-detail-layer">
					<button
						aria-label="Close icon details"
						className="icon-detail-layer__scrim"
						onClick={closeDetail}
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

			<SelectionBar
				busySelectionAction={busySelectionAction}
				detailOpen={Boolean(detailIcon)}
				onAction={runSelectionAction}
				onClear={clearSelection}
				selectedCount={selectedIcons.length}
				selectionIsFull={selectionIsFull}
				selectionProgress={selectionProgress}
			/>

			<div aria-live="polite" aria-atomic="true" className="icons-toast" role="status">
				{notice}
			</div>
		</div>
	);
}
