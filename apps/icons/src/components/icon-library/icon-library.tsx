import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  copyText,
  createIconZip,
  downloadBlob,
  downloadSvg,
  svgDataUri,
  svgToJsxComponent,
} from "../../lib/icon-actions.js";
import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import {
  formatCollectionLabel,
  searchIcons,
  type IconManifest,
  type SketchiIcon,
} from "../../lib/icon-data.js";
import { IconCard } from "../icon-card/index.js";
import { IconDetail, type IconDetailAction } from "../icon-detail/index.js";

export type { IconManifest, SketchiIcon } from "../../lib/icon-data.js";

const PAGE_SIZE = 72;

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

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

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
  const [previewMode, setPreviewMode] =
    useState<PreviewMode>(initialPreviewMode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(0);
  const [detailSlug, setDetailSlug] = useState<string>();
  const [selectedSlugs, setSelectedSlugs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [copyingSlug, setCopyingSlug] = useState<string>();
  const [copiedSlug, setCopiedSlug] = useState<string>();
  const [busyDetailAction, setBusyDetailAction] = useState<IconDetailAction>();
  const [busySelectionAction, setBusySelectionAction] =
    useState<SelectionAction>();
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
    setActiveIndex(0);
  }, [collection, query]);

  useEffect(() => {
    if (activeIndex >= results.length) {
      setActiveIndex(Math.max(0, results.length - 1));
    }
  }, [activeIndex, results.length]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (detailSlug) return;
      if (event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (query) {
          setQuery("");
          searchRef.current?.focus();
        }
        return;
      }
      const targetIsSearch = event.target === searchRef.current;
      if (isActionTarget(event.target) && !targetIsSearch) {
        return;
      }
      if (isEditableTarget(event.target) && !targetIsSearch) return;

      const direction =
        event.key === "ArrowDown" || event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp" || event.key === "ArrowLeft"
            ? -1
            : 0;
      if (direction !== 0 && results.length) {
        event.preventDefault();
        setActiveIndex((current) => {
          const next = (current + direction + results.length) % results.length;
          setVisibleCount((count) => Math.max(count, next + 1));
          window.setTimeout(() => {
            document
              .getElementById(`icon-result-${results[next]?.slug ?? ""}`)
              ?.scrollIntoView({ block: "nearest" });
          }, 0);
          return next;
        });
        return;
      }
      if (event.key === "Enter" && results[activeIndex]) {
        event.preventDefault();
        void copySvg(results[activeIndex]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, copySvg, detailSlug, query, results]);

  function toggleSelected(icon: SketchiIcon) {
    setSelectedSlugs((current) => {
      const next = new Set(current);
      if (next.has(icon.slug)) next.delete(icon.slug);
      else next.add(icon.slug);
      return next;
    });
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
    if (!selectedIcons.length) return;
    setBusySelectionAction(action);
    try {
      const sources = await Promise.all(
        selectedIcons.map(async (icon) => ({
          slug: icon.slug,
          svg: await getSvg(icon),
        })),
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
            <a href="/llms.txt">Agent API</a>
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
              <p className="icons-hero__eyebrow">Open SVG library</p>
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
              <a href="/llms.txt">
                <strong>MCP</strong>
                Agent access
              </a>
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
              <p aria-live="polite" role="status">
                {status === "ready"
                  ? `${results.length.toLocaleString()} ${
                      results.length === 1 ? "icon" : "icons"
                    }`
                  : ""}
              </p>
              <p>
                <kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> copy SVG{" "}
                <kbd>Esc</kbd> clear
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
            <a href="/llms.txt">For agents</a>
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
            <strong>{selectedIcons.length}</strong>
            <span>
              {selectedIcons.length === 1 ? "icon" : "icons"} selected
            </span>
          </div>
          <div className="selection-bar__actions">
            <button
              disabled={busySelectionAction !== undefined}
              onClick={() => void runSelectionAction("copy")}
              type="button"
            >
              {busySelectionAction === "copy" ? "Copying" : "Copy all SVG"}
            </button>
            <button
              className="is-primary"
              disabled={busySelectionAction !== undefined}
              onClick={() => void runSelectionAction("zip")}
              type="button"
            >
              {busySelectionAction === "zip" ? "Building zip" : "Download zip"}
            </button>
            <button
              disabled={busySelectionAction !== undefined}
              onClick={() => setSelectedSlugs(new Set())}
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
