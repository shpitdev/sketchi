import { Record as Rec, String as Str, Array as Arr, Option as Opt } from "effect";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { useCallback, useContext, useMemo, useRef, useState } from "react";

import { formatCollectionLabel, type IconManifest, type SketchiIcon } from "@sketchi/icon-catalog";
import { DRAWINGS_LIBRARY_PATH, type IconDrawings } from "../../lib/drawings";
import { filterIcons, toggleCollection } from "./filter";
import { PLAYGROUND_URL, REPO_URL, SKETCHI_WEB_HOME_URL } from "../../lib/home-url";
import type { PackShelfData } from "../../lib/packs-rpc";
import { permanentSvgUrl } from "../../lib/permanent-svg-url";
import { RegistryContext, useAtom } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { drawnNames } from "../browser/drawn-names";
import { useLoadOnScroll } from "../browser/use-load-on-scroll";
import { useModifierLabel } from "../browser/use-modifier-label";
import {
	applySelectionEvent,
	describeSelectionNotice,
	remainingCapacity,
	SELECTION_LIMIT,
	selectResultsLabel,
	type SelectionEvent,
} from "./selection";
import { IconCard } from "./icon-card/icon-card";
import { IconDetail } from "./icon-detail/icon-detail";
import { NamesToggle } from "../../components/names-toggle/names-toggle";
import { PackShelf } from "../packs/pack-shelf";
import type { PreviewMode } from "../../components/preview-toggle/preview-toggle";
import { CommandPalette, type IconCommand, type PaletteLink } from "./command-palette";
import { IconsChrome } from "../../components/icons-chrome";
import { IconToolbar } from "./icon-toolbar";
import { SelectionBar } from "./selection-bar";
import { type SelectionAction, useIconSources } from "./use-icon-sources";
import { type IconView, ViewSwitch } from "./view-switch";

export type { IconManifest, SketchiIcon } from "@sketchi/icon-catalog";

/** Results render a page at a time as the grid nears the viewport; 96 fills whole rows at 2–8 columns. */
const PAGE_SIZE = 96;
/** Nothing is highlighted until the user actually navigates with the keyboard. */
const NO_ACTIVE_INDEX = -1;

type LoadStatus = "error" | "loading" | "ready";

export interface IconLibraryProps {
	readonly data?: IconManifest;
	/** Hand-drawn versions of catalog marks, keyed by slug; the view switch appears once any load. */
	readonly drawings?: IconDrawings;
	readonly errorMessage?: string;
	readonly homeHref?: string;
	/** Collections to filter by on first render. Empty means all. */
	readonly initialCollections?: readonly string[];
	readonly initialPreviewMode?: PreviewMode;
	readonly initialQuery?: string;
	readonly initialView?: IconView;
	readonly onRetry?: () => void;
	/** The Excalidraw library packs shown above the search. */
	readonly packs?: PackShelfData;
	readonly status?: LoadStatus;
}

const emptyData: IconManifest = {
	icons: [],
	summary: { collectionCounts: {}, totalIcons: 0 },
	version: 1,
};

const noDrawings: IconDrawings = {};

const noCollections: readonly string[] = [];

/**
 * Links, buttons and form controls, which keep their own arrow and Enter keys.
 * Hotkeys only leaves a checkbox its Space key, so the grid checks this itself.
 */
function isActionTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		target.closest("a, button, input, select, textarea, [contenteditable]") !== null
	);
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
	drawings = noDrawings,
	errorMessage,
	homeHref = SKETCHI_WEB_HOME_URL,
	initialCollections = noCollections,
	initialPreviewMode = "light",
	initialQuery = "",
	initialView = "svg",
	onRetry,
	packs,
	status = "ready",
}: IconLibraryProps) {
	const registry = useContext(RegistryContext);
	const [criteria] = useState(() =>
		Atom.make<{ query: string; collections: ReadonlySet<string>; view: IconView }>({
			query: initialQuery,
			collections: new Set(initialCollections),
			view: initialView,
		}),
	);
	const [{ query, collections, view: chosenView }, setCriteria] = useAtom(criteria);
	const [preview] = useState(() => Atom.make<PreviewMode>(initialPreviewMode));
	const [previewMode, setPreviewMode] = useAtom(preview);
	const hasDrawings = Rec.keys(drawings).length > 0;
	const [named, setNamed] = useAtom(drawnNames);
	const view: IconView = hasDrawings ? chosenView : "svg";
	const drawingFor = (icon: SketchiIcon) => (view === "drawn" ? drawings[icon.slug] : undefined);
	const [position] = useState(() => {
		type Position = { readonly visibleCount: number; readonly highlightedIndex: number };
		const atom: Atom.Writable<Position, Position> = Atom.writable(
			(get) => {
				get(criteria);
				return { visibleCount: PAGE_SIZE, highlightedIndex: NO_ACTIVE_INDEX };
			},
			(context, value) => context.setSelf(value),
		);
		return atom;
	});
	const [{ visibleCount, highlightedIndex }, setPosition] = useAtom(position);
	const [palette] = useState(() => Atom.make(false));
	const [paletteOpen, setPaletteOpen] = useAtom(palette);
	const [details] = useState(() =>
		Atom.make<{ readonly opener: HTMLElement | null; readonly slug: string } | undefined>(
			undefined,
		),
	);
	const [detail, setDetail] = useAtom(details);
	const [selected] = useState(() => Atom.make(new Set<string>() as ReadonlySet<string>));
	const [selectedSlugs] = useAtom(selected);
	const searchRef = useRef<HTMLInputElement>(null);
	const collectionOptions = useMemo(
		() =>
			Rec.toEntries(data.summary.collectionCounts).sort(([left], [right]) =>
				Str.localeCompare(formatCollectionLabel(right))(formatCollectionLabel(left)),
			),
		[data.summary.collectionCounts],
	);
	const results = useMemo(() => {
		const matches = filterIcons(data.icons, { collections, query });
		return view === "drawn" ? Arr.filter(matches, (icon) => Boolean(drawings[icon.slug])) : matches;
	}, [collections, data.icons, drawings, query, view]);
	const filtered = Str.trim(query) !== "" || collections.size > 0;
	// A highlight past the end of the current results (for example after the
	// manifest changes) reads as no highlight.
	const activeIndex = highlightedIndex < results.length ? highlightedIndex : NO_ACTIVE_INDEX;
	const visibleIcons = results.slice(0, visibleCount);
	const showMoreResults = useCallback(
		() =>
			setPosition((current) => ({ ...current, visibleCount: current.visibleCount + PAGE_SIZE })),
		[setPosition],
	);
	const sentinel = useLoadOnScroll<HTMLDivElement>(
		status === "ready" && visibleCount < results.length ? visibleCount : undefined,
		showMoreResults,
	);
	const detailIcon = detail
		? Opt.getOrElse(
				Arr.findFirst(data.icons, (icon) => icon.slug === detail.slug),
				() => undefined,
			)
		: undefined;
	const selectedIcons = Arr.filter(data.icons, (icon) => selectedSlugs.has(icon.slug));
	const capacityLeft = remainingCapacity(selectedSlugs);
	const selectionIsFull = capacityLeft === 0;
	const selectedInResults = Arr.filter(results, (icon) => selectedSlugs.has(icon.slug)).length;
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
	const [menu] = useState(() => Atom.make(false));
	const [menuOpen, setMenuOpen] = useAtom(menu);
	const gridKeysActive = !overlayOpen && !menuOpen;
	const closeDetail = useCallback(() => setDetail(undefined), [setDetail]);
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
	} = useIconSources(
		() => Arr.filter(data.icons, (icon) => registry.get(selected).has(icon.slug)),
		{ named },
	);

	const changeQuery = useCallback(
		(query: string) => setCriteria((current) => ({ ...current, query })),
		[setCriteria],
	);
	const changeCollection = useCallback(
		(collection: string) =>
			setCriteria((current) => ({
				...current,
				collections: toggleCollection(current.collections, collection),
			})),
		[setCriteria],
	);
	const clearCollections = useCallback(
		() => setCriteria((current) => ({ ...current, collections: new Set() })),
		[setCriteria],
	);
	const clearFilters = useCallback(
		() => setCriteria((current) => ({ ...current, query: "", collections: new Set() })),
		[setCriteria],
	);
	const moveActive = useCallback(
		(direction: -1 | 1) => {
			if (!results.length) return;
			const next =
				registry.get(position).highlightedIndex === NO_ACTIVE_INDEX
					? direction === 1
						? 0
						: results.length - 1
					: (registry.get(position).highlightedIndex + direction + results.length) % results.length;
			setPosition((current) => ({
				visibleCount: Math.max(current.visibleCount, next + 1),
				highlightedIndex: next,
			}));
			const slug = results[next]?.slug;
			if (!slug) return;
			requestAnimationFrame(() => {
				document.getElementById(`icon-result-${slug}`)?.scrollIntoView?.({ block: "nearest" });
			});
		},
		[position, registry, results, setPosition],
	);

	// The store reports what an event did as data; the handler that caused it
	// announces it, so no selection update fires a side effect mid-update.
	const dispatchSelection = useCallback(
		(event: SelectionEvent) => {
			const next = applySelectionEvent(registry.get(selected), event);
			registry.set(selected, next.slugs);
			const selectionNotice = next.notice;
			if (selectionNotice) showNotice(describeSelectionNotice(selectionNotice));
		},
		[registry, selected, showNotice],
	);

	// Stable per-card handlers keep the memoized cards from re-rendering on every page.
	const toggleSelected = useCallback(
		(icon: SketchiIcon) => dispatchSelection({ slug: icon.slug, type: "toggle" }),
		[dispatchSelection],
	);

	const copyResult = useCallback(
		(icon: SketchiIcon) => copySvg(icon, view === "drawn" ? drawings[icon.slug] : undefined),
		[copySvg, drawings, view],
	);

	const openDetails = useCallback(
		(icon: SketchiIcon) => {
			setDetail({
				opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
				slug: icon.slug,
			});
		},
		[setDetail],
	);

	const selectAllResults = useCallback(() => {
		dispatchSelection({
			slugs: Arr.map(results, (icon) => icon.slug),
			type: "select-all",
		});
	}, [dispatchSelection, results]);

	const deselectResults = useCallback(() => {
		dispatchSelection({
			slugs: Arr.map(results, (icon) => icon.slug),
			type: "deselect",
		});
	}, [dispatchSelection, results]);

	const clearSelection = useCallback(
		() => dispatchSelection({ type: "clear" }),
		[dispatchSelection],
	);

	const focusSearch = useCallback(() => searchRef.current?.focus(), []);

	const clearSearch = useCallback(() => {
		setPosition((current) => ({ ...current, highlightedIndex: NO_ACTIVE_INDEX }));
		if (!query) return;
		changeQuery("");
		searchRef.current?.focus();
	}, [changeQuery, query, setPosition]);

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
			copySvg(icon, view === "drawn" ? drawings[icon.slug] : undefined);
		},
		[activeIndex, copySvg, drawings, results, view],
	);

	const changeView = useCallback(
		(view: IconView) => setCriteria((current) => ({ ...current, view })),
		[setCriteria],
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
		(action: SelectionAction) => runSelectionAction(action),
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
		...commandsWhen(hasDrawings, {
			id: "view",
			name: view === "svg" ? "Show hand-drawn icons" : "Show SVG icons",
			run: () => changeView(view === "svg" ? "drawn" : "svg"),
		}),
		...commandsWhen(hasDrawings, {
			id: "download-drawings",
			name: "Download the hand-drawn Excalidraw library",
			run: () => window.location.assign(DRAWINGS_LIBRARY_PATH),
		}),
		{
			id: "preview",
			name: previewMode === "light" ? "Use dark preview" : "Use light preview",
			run: () => setPreviewMode(previewMode === "light" ? "dark" : "light"),
		},
	];

	const links: readonly PaletteLink[] = [
		{ href: "/community", name: "Community icons" },
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
	const gridHotkeys: UseHotkeyDefinition[] = Arr.flatMap(
		[
			["ArrowDown", 1],
			["ArrowUp", -1],
			["ArrowRight", 1],
			["ArrowLeft", -1],
		] as const,
		([hotkey, direction]) => [
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
		],
	);

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
							<h1 className="sr-only">Sketchi Icons</h1>
							{packs ? (
								<PackShelf
									excalidraw={packs.excalidraw}
									packs={packs.packs}
									previewMode={previewMode}
								/>
							) : null}
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
								{/* "No icons found" below says what a zero count would. */}
								<p
									aria-live="polite"
									className={
										status === "ready" && !results.length ? "sr-only" : "icons-results-bar__count"
									}
									role="status"
								>
									{status !== "ready"
										? ""
										: results.length
											? plural(results.length, "icon", "icons")
											: "No icons found"}
								</p>
								{hasDrawings ? (
									<div className="icons-results-bar__view">
										<ViewSwitch onChange={changeView} value={view} />
										{view === "drawn" ? <NamesToggle onChange={setNamed} value={named} /> : null}
									</div>
								) : null}
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
										{collections.size && Str.trim(query)
											? "Nothing in the chosen collections matches. Try all collections or another name."
											: "Try a brand name or a common alias, such as k8s or psql."}
									</p>
									<div className="icons-state__actions">
										{collections.size && Str.trim(query) ? (
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
								<section aria-label="Icon results" className="icons-grid" id="icon-results">
									{Arr.map(visibleIcons, (icon, index) => {
										const drawing = drawingFor(icon);
										return (
											<IconCard
												active={index === activeIndex}
												copied={copiedSlug === icon.slug}
												copying={copyingSlug === icon.slug}
												{...(drawing ? { drawing } : {})}
												icon={icon}
												key={icon.slug}
												named={named}
												onCopy={copyResult}
												onDetails={openDetails}
												onToggleSelected={toggleSelected}
												previewMode={previewMode}
												selected={selectedSlugs.has(icon.slug)}
											/>
										);
									})}
								</section>
							) : null}
							<div aria-hidden="true" className="icons-scroll-sentinel" ref={sentinel} />
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
							{...(drawings[detailIcon.slug] ? { drawing: drawings[detailIcon.slug] } : {})}
							icon={detailIcon}
							named={named}
							onAction={(action, icon) => runDetailAction(action, icon, drawings[icon.slug])}
							onClose={closeDetail}
							onNamedChange={setNamed}
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
