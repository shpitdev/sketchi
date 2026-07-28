import { detectPlatform, useHotkeys } from "@tanstack/react-hotkeys";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  copyText,
  createIconZip,
  downloadBlob,
  downloadSvg,
  mapWithConcurrency,
  svgDataUri,
  svgToJsxComponent,
} from "../../lib/actions.js";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import {
  formatCollectionLabel,
  searchIcons,
  type IconManifest,
  type SketchiIcon,
} from "../../lib/data.js";
import {
  describeSelectionNotice,
  initialSelectionState,
  remainingCapacity,
  selectAllLabel,
  selectionReducer,
  SELECTION_LIMIT,
} from "../../lib/selection.js";
import { IconCard } from "../icon-card/index.js";
import { IconDetail, type IconDetailAction } from "../icon-detail/index.js";

export type { IconManifest, SketchiIcon } from "../../lib/data.js";

const PAGE_SIZE = 72;
/** Nothing is highlighted until the user actually navigates with the keyboard. */
const NO_ACTIVE_INDEX = -1;
/** Concurrent SVG fetches while a bulk selection action runs. */
const FETCH_CONCURRENCY = 8;

type LoadStatus = "error" | "loading" | "ready";
type PreviewMode = "dark" | "light";
type SelectionAction = "copy" | "zip";

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

function permanentSvgUrl(slug: string): string {
  const path = `/api/icons/${encodeURIComponent(slug)}.svg`;
  return typeof window === "undefined"
    ? `https://icons.sketchi.app${path}`
    : new URL(path, window.location.href).href;
}

function isActionTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("a, button") !== null;
}

/**
 * `Mod` renders as `⌘` on macOS and `Ctrl` elsewhere. Platform detection has to
 * wait for mount so the server and the first client render agree.
 */
function useModifierLabel(): string {
  const [platform, setPlatform] = useState<"linux" | "mac" | "windows">(
    "linux",
  );
  useEffect(() => setPlatform(detectPlatform()), []);
  return platform === "mac" ? "⌘" : "Ctrl";
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
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>(initialPreviewMode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(NO_ACTIVE_INDEX);
  const [detailSlug, setDetailSlug] = useState<string>();
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    initialSelectionState,
  );
  const selectedSlugs = selection.slugs;
  const [copyingSlug, setCopyingSlug] = useState<string>();
  const [copiedSlug, setCopiedSlug] = useState<string>();
  const [busyDetailAction, setBusyDetailAction] = useState<IconDetailAction>();
  const [busySelectionAction, setBusySelectionAction] =
    useState<SelectionAction>();
  // Both halves are snapshotted when a bulk action starts: it runs over the
  // selection as it was then, so editing the selection mid-flight must not
  // move the denominator.
  const [selectionProgress, setSelectionProgress] = useState({
    done: 0,
    total: 0,
  });
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const sourceCache = useRef(new Map<string, Promise<string>>());

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
  const visibleIcons = results.slice(0, visibleCount);
  const detailIcon = detailSlug
    ? data.icons.find((icon) => icon.slug === detailSlug)
    : undefined;
  const selectedIcons = data.icons.filter((icon) =>
    selectedSlugs.has(icon.slug),
  );
  const capacityLeft = remainingCapacity(selectedSlugs);
  const selectionIsFull = capacityLeft === 0;
  const pendingCount = results.filter(
    (icon) => !selectedSlugs.has(icon.slug),
  ).length;
  const modifierLabel = useModifierLabel();
  const closeDetail = useCallback(() => setDetailSlug(undefined), []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const getSvg = useCallback(async (icon: SketchiIcon): Promise<string> => {
    const cached = sourceCache.current.get(icon.slug);
    if (cached) return cached;
    const pending = fetch(icon.svgPath).then(async (response) => {
      if (!response.ok) {
        throw new Error(`SVG returned HTTP ${response.status}.`);
      }
      return response.text();
    });
    sourceCache.current.set(icon.slug, pending);
    try {
      return await pending;
    } catch (error) {
      sourceCache.current.delete(icon.slug);
      throw error;
    }
  }, []);

  const copySvg = useCallback(
    async (icon: SketchiIcon) => {
      if (copyingSlug) return;
      setCopyingSlug(icon.slug);
      try {
        await copyText(await getSvg(icon));
        setCopiedSlug(icon.slug);
        showNotice(`${icon.name} SVG copied.`);
        if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(
          () => setCopiedSlug(undefined),
          1800,
        );
      } catch {
        showNotice(`Could not copy ${icon.name}. Try again.`);
      } finally {
        setCopyingSlug(undefined);
      }
    },
    [copyingSlug, getSvg, showNotice],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setActiveIndex(NO_ACTIVE_INDEX);
  }, [collection, query]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(NO_ACTIVE_INDEX);
  }, [activeIndex, results.length]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
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
      setActiveIndex(next);
      setVisibleCount((count) => Math.max(count, next + 1));
      const slug = results[next]?.slug;
      if (!slug) return;
      window.setTimeout(() => {
        document
          .getElementById(`icon-result-${slug}`)
          ?.scrollIntoView({ block: "nearest" });
      }, 0);
    },
    [activeIndex, results],
  );

  const selectAllResults = useCallback(() => {
    dispatchSelection({
      slugs: results.map((icon) => icon.slug),
      type: "select-all",
    });
  }, [results]);

  const clearSelection = useCallback(
    () => dispatchSelection({ type: "clear" }),
    [],
  );

  // The reducer reports what happened as data; announcing it is this effect's
  // job so that no selection update fires a side effect mid-update.
  useEffect(() => {
    if (selection.notice) showNotice(describeSelectionNotice(selection.notice));
  }, [selection, showNotice]);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  const clearSearch = useCallback(() => {
    setActiveIndex(NO_ACTIVE_INDEX);
    if (!query) return;
    setQuery("");
    searchRef.current?.focus();
  }, [query]);

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
          callback: (event: KeyboardEvent) =>
            moveFromKey(event, direction, true),
          hotkey,
          options: {
            ignoreInputs: false,
            preventDefault: false,
            target: searchRef,
          },
        },
        {
          callback: (event: KeyboardEvent) =>
            moveFromKey(event, direction, false),
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
          enabled:
            !detailIcon && (query !== "" || activeIndex !== NO_ACTIVE_INDEX),
        },
      },
      {
        callback: selectAllResults,
        hotkey: "Mod+A",
        options: {
          // Mirrors the select-all button: enabled only when the click would
          // actually add something.
          enabled:
            !detailIcon &&
            status === "ready" &&
            pendingCount > 0 &&
            capacityLeft > 0,
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

  async function runDetailAction(action: IconDetailAction, icon: SketchiIcon) {
    setBusyDetailAction(action);
    try {
      const url = permanentSvgUrl(icon.slug);
      if (action === "copy-url") {
        await copyText(url);
      } else {
        const svg = await getSvg(icon);
        if (action === "copy-svg") await copyText(svg);
        if (action === "copy-jsx") await copyText(svgToJsxComponent(svg, icon));
        if (action === "copy-data-uri") await copyText(svgDataUri(svg));
        if (action === "download") downloadSvg(svg, icon.slug);
      }
      showNotice(
        action === "download"
          ? `${icon.name} downloaded.`
          : `${icon.name} ${
              action === "copy-url"
                ? "URL"
                : action === "copy-jsx"
                  ? "JSX"
                  : action === "copy-data-uri"
                    ? "data URI"
                    : "SVG"
            } copied.`,
      );
    } catch {
      showNotice(`Could not complete that action for ${icon.name}.`);
    } finally {
      setBusyDetailAction(undefined);
    }
  }

  async function runSelectionAction(action: SelectionAction) {
    const batch = selectedIcons;
    if (!batch.length) return;
    setBusySelectionAction(action);
    setSelectionProgress({ done: 0, total: batch.length });
    try {
      const sources = await mapWithConcurrency(
        batch,
        FETCH_CONCURRENCY,
        async (icon) => {
          const svg = await getSvg(icon);
          setSelectionProgress((progress) => ({
            ...progress,
            done: progress.done + 1,
          }));
          return { slug: icon.slug, svg };
        },
      );
      if (action === "copy") {
        await copyText(sources.map(({ svg }) => svg).join("\n\n"));
        showNotice(`${sources.length} SVGs copied.`);
      } else {
        downloadBlob(await createIconZip(sources), "sketchi-icons.zip");
        showNotice(`${sources.length} SVGs downloaded as a zip.`);
      }
    } catch {
      showNotice("Could not prepare the selected icons. Try again.");
    } finally {
      setBusySelectionAction(undefined);
      setSelectionProgress({ done: 0, total: 0 });
    }
  }

  return (
    <div className="icons-product">
      <header
        aria-hidden={detailIcon ? "true" : undefined}
        className="icons-header"
        inert={detailIcon ? true : undefined}
      >
        <div className="icons-shell icons-header__inner">
          <a aria-label="Sketchi home" className="icons-brand" href={homeHref}>
            <span className="icons-brand__tile">
              <img alt="" height="30" src="/icon.svg" width="30" />
            </span>
            <span className="sk-wordmark">Sketchi</span>
            <span className="icons-brand__surface">Icons</span>
          </a>
          <nav aria-label="Sketchi links" className="icons-header__nav">
            <a href={`${homeHref}/docs`}>Docs</a>
            <a href="/llms.txt">llms.txt</a>
            <a href="https://github.com/shpitdev/sketchi">GitHub</a>
          </nav>
        </div>
      </header>

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
                Search {data.summary.totalIcons.toLocaleString()} clean SVGs.
                Copy one instantly or gather a set to download.
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
            <div className="icons-toolbar">
              <label className="icons-search">
                <span id="icon-search-label">Search icons</span>
                <span className="icons-search__box">
                  <input
                    aria-labelledby="icon-search-label"
                    aria-activedescendant={
                      results[activeIndex]
                        ? `icon-result-${results[activeIndex].slug}`
                        : undefined
                    }
                    aria-controls="icon-results"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Try k8s, next, psql, or Vercel"
                    ref={searchRef}
                    type="search"
                    value={query}
                  />
                  {query ? (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                      type="button"
                    >
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
                  onChange={(event) => setCollection(event.currentTarget.value)}
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
                    onClick={() => setPreviewMode("light")}
                    type="button"
                  >
                    Light
                  </button>
                  <button
                    aria-pressed={previewMode === "dark"}
                    onClick={() => setPreviewMode("dark")}
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
                    ? `${results.length.toLocaleString()} ${
                        results.length === 1 ? "icon" : "icons"
                      }`
                    : ""}
                </p>
                {status === "ready" && results.length ? (
                  <button
                    className="icons-browser__select-all"
                    disabled={selectionIsFull || pendingCount === 0}
                    onClick={selectAllResults}
                    type="button"
                  >
                    {selectAllLabel(results.length, pendingCount, capacityLeft)}
                  </button>
                ) : null}
              </div>
              <p className="icons-browser__keys">
                <kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> copy SVG{" "}
                <kbd>{modifierLabel}</kbd> <kbd>A</kbd> select all{" "}
                <kbd>{modifierLabel}</kbd> <kbd>D</kbd> clear selection{" "}
                <kbd>Esc</kbd> clear search
              </p>
            </div>

            {status === "loading" ? (
              <section
                className="icons-loading"
                aria-label="Loading icons"
                role="status"
              >
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
                    setQuery("");
                    setCollection("all");
                  }}
                  type="button"
                >
                  Clear search
                </button>
              </section>
            ) : null}

            {status === "ready" && results.length ? (
              <>
                <section
                  aria-label="Icon results"
                  className="icons-grid"
                  id="icon-results"
                >
                  {visibleIcons.map((icon, index) => (
                    <IconCard
                      active={index === activeIndex}
                      copied={copiedSlug === icon.slug}
                      copying={copyingSlug === icon.slug}
                      icon={icon}
                      key={icon.slug}
                      onCopy={(picked) => void copySvg(picked)}
                      onDetails={(picked) => {
                        detailOpenerRef.current =
                          document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                        setDetailSlug(picked.slug);
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
                      onClick={() =>
                        setVisibleCount((count) => count + PAGE_SIZE)
                      }
                      type="button"
                    >
                      Show {Math.min(PAGE_SIZE, results.length - visibleCount)}{" "}
                      more
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      </main>

      <footer
        aria-hidden={detailIcon ? "true" : undefined}
        className="icons-footer"
        inert={detailIcon ? true : undefined}
      >
        <div className="icons-shell icons-footer__inner">
          <div>
            <a className="icons-footer__brand" href={homeHref}>
              <img alt="" height="30" src="/icon.svg" width="30" />
              <span>Sketchi</span>
            </a>
            <p>Prompts become clear, editable diagrams, logos included.</p>
          </div>
          <nav aria-label="Footer">
            <a href={homeHref}>Home</a>
            <a href={`${homeHref}/docs`}>Docs</a>
            <a href="/llms.txt">llms.txt</a>
            <a href="https://playground.sketchi.app">Playground</a>
          </nav>
        </div>
      </footer>

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
            returnFocusTo={detailOpenerRef.current}
          />
        </div>
      ) : null}

      {selectedIcons.length ? (
        <section
          aria-hidden={detailIcon ? "true" : undefined}
          aria-label="Selected icons"
          className="selection-bar"
          inert={detailIcon ? true : undefined}
        >
          <div className="selection-bar__count">
            <strong>{selectedIcons.length.toLocaleString()}</strong>
            <span>
              {selectedIcons.length === 1 ? "icon" : "icons"} selected
              {selectionIsFull
                ? ` — capped at ${SELECTION_LIMIT.toLocaleString()}`
                : ""}
            </span>
          </div>
          <div className="selection-bar__actions">
            <button
              disabled={busySelectionAction !== undefined}
              onClick={() => void runSelectionAction("copy")}
              type="button"
            >
              {busySelectionAction === "copy"
                ? `Copying ${selectionProgress.done}/${selectionProgress.total}`
                : "Copy all SVG"}
            </button>
            <button
              className="is-primary"
              disabled={busySelectionAction !== undefined}
              onClick={() => void runSelectionAction("zip")}
              type="button"
            >
              {busySelectionAction === "zip"
                ? `Building zip ${selectionProgress.done}/${selectionProgress.total}`
                : "Download zip"}
            </button>
            <button
              disabled={busySelectionAction !== undefined}
              onClick={clearSelection}
              type="button"
            >
              Clear selection
            </button>
          </div>
        </section>
      ) : null}

      <div
        aria-live="polite"
        aria-atomic="true"
        className="icons-toast"
        role="status"
      >
        {notice}
      </div>
    </div>
  );
}
