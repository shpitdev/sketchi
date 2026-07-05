import { useEffect, useMemo, useState } from "react";

import { SKETCHI_WEB_HOME_URL } from "../../lib/home-url.js";
import {
  formatCollectionLabel,
  type IconLibraryData,
  iconMatchesQuery,
} from "../../lib/icon-data.js";
import { IconCard } from "../icon-card/index.js";
import { IconDetail } from "../icon-detail/index.js";

export type { IconLibraryData, SketchiIcon } from "../../lib/icon-data.js";

const PAGE_SIZE = 60;

type IconDensity = "comfortable" | "compact";
type IconKind = "all" | "mark" | "text";
type IconSortMode = "collection" | "largest" | "name";

function iconKindFromValue(value: string): IconKind {
  if (value === "mark" || value === "text") {
    return value;
  }

  return "all";
}

function iconSortModeFromValue(value: string): IconSortMode {
  if (value === "collection" || value === "largest") {
    return value;
  }

  return "name";
}

export interface IconLibraryProps {
  data?: IconLibraryData | undefined;
  errorMessage?: string | undefined;
  /** Where the brand mark links — the Sketchi web home by default. */
  homeHref?: string;
  initialCollection?: string;
  initialDensity?: IconDensity;
  initialFlaggedOnly?: boolean;
  initialKind?: IconKind;
  initialQuery?: string;
  initialSortMode?: IconSortMode;
  status?: "error" | "loading" | "ready";
}

const emptyData: IconLibraryData = {
  icons: [],
  summary: {
    collectionCounts: {},
    totalIcons: 0,
  },
};

export function IconLibrary({
  data = emptyData,
  errorMessage,
  homeHref = SKETCHI_WEB_HOME_URL,
  initialCollection = "all",
  initialDensity = "comfortable",
  initialFlaggedOnly = false,
  initialKind = "all",
  initialQuery = "",
  initialSortMode = "name",
  status = "ready",
}: IconLibraryProps) {
  const [query, setQuery] = useState(initialQuery);
  const [collection, setCollection] = useState(initialCollection);
  const [flaggedOnly, setFlaggedOnly] = useState(initialFlaggedOnly);
  const [kind, setKind] = useState<IconKind>(initialKind);
  const [density, setDensity] = useState<IconDensity>(initialDensity);
  const [sortMode, setSortMode] = useState<IconSortMode>(initialSortMode);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const collections = useMemo(
    () =>
      Object.entries(data.summary.collectionCounts).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    [data],
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredIcons = useMemo(() => {
    const matchingIcons = data.icons.filter((icon) => {
      const matchesCollection =
        collection === "all" || icon.collection === collection;
      const matchesFlag = !flaggedOnly || icon.flags.length > 0;
      const matchesKind =
        kind === "all" ||
        (kind === "text" && icon.variant === "text") ||
        (kind === "mark" && icon.variant !== "text");

      return (
        matchesCollection &&
        matchesFlag &&
        matchesKind &&
        iconMatchesQuery(icon, normalizedQuery)
      );
    });

    return [...matchingIcons].sort((a, b) => {
      if (sortMode === "collection") {
        return (
          a.collection.localeCompare(b.collection) ||
          a.slug.localeCompare(b.slug)
        );
      }

      if (sortMode === "largest") {
        return b.bytes - a.bytes || a.slug.localeCompare(b.slug);
      }

      return a.slug.localeCompare(b.slug);
    });
  }, [collection, data, flaggedOnly, kind, normalizedQuery, sortMode]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [collection, flaggedOnly, kind, normalizedQuery, sortMode]);

  const visibleIcons = filteredIcons.slice(0, visibleCount);
  const hasMore = filteredIcons.length > visibleIcons.length;
  const selected = selectedId
    ? (filteredIcons.find((icon) => icon.id === selectedId) ?? null)
    : null;
  const flaggedCount = Object.values(data.summary.flagCounts ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  const textAssetCount = data.icons.filter(
    (icon) => icon.variant === "text",
  ).length;

  useEffect(() => {
    if (selectedId && !filteredIcons.some((icon) => icon.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredIcons, selectedId]);

  function resetFilters() {
    setQuery("");
    setCollection("all");
    setFlaggedOnly(false);
    setKind("all");
    setSortMode("name");
  }

  return (
    <main className="sketchi-icons" data-density={density}>
      <header className="sketchi-icons__header">
        <div className="sketchi-icons__brand">
          <a
            aria-label="Sketchi home"
            className="sketchi-icons__home"
            href={homeHref}
          >
            <img
              alt=""
              className="sk-icon"
              height="38"
              src="/icon.svg"
              width="38"
            />
          </a>
          <div className="sketchi-icons__title">
            <p className="sketchi-icons__eyebrow">Sketchi icons</p>
            <h1>Curated icon output</h1>
          </div>
        </div>
        <div className="sketchi-icons__summary" aria-label="Icon summary">
          <span>
            <strong>{data.summary.totalIcons.toLocaleString()}</strong> icons
          </span>
          <span>
            <strong>{collections.length.toLocaleString()}</strong> collections
          </span>
          <span>
            <strong>{flaggedCount.toLocaleString()}</strong> review flags
          </span>
          <span>
            <strong>{textAssetCount.toLocaleString()}</strong> text assets
          </span>
        </div>
      </header>

      <section className="sketchi-icons__toolbar" aria-label="Icon filters">
        <label className="sketchi-icons__field">
          Search icons
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="workos, gcp, react"
            type="search"
            value={query}
          />
        </label>
        <label className="sketchi-icons__field">
          Collection
          <select
            onChange={(event) => setCollection(event.currentTarget.value)}
            value={collection}
          >
            <option value="all">All collections</option>
            {collections.map(([collectionName, count]) => (
              <option key={collectionName} value={collectionName}>
                {formatCollectionLabel(collectionName)} ({count})
              </option>
            ))}
          </select>
        </label>
        <label className="sketchi-icons__field">
          Asset kind
          <select
            onChange={(event) =>
              setKind(iconKindFromValue(event.currentTarget.value))
            }
            value={kind}
          >
            <option value="all">All assets</option>
            <option value="mark">Marks only</option>
            <option value="text">Text assets</option>
          </select>
        </label>
        <label className="sketchi-icons__field">
          Sort
          <select
            aria-label="Sort icons"
            onChange={(event) =>
              setSortMode(iconSortModeFromValue(event.currentTarget.value))
            }
            value={sortMode}
          >
            <option value="name">Name</option>
            <option value="collection">Collection</option>
            <option value="largest">Largest file</option>
          </select>
        </label>
        <label className="sketchi-icons__toggle">
          <input
            checked={flaggedOnly}
            onChange={(event) => setFlaggedOnly(event.currentTarget.checked)}
            type="checkbox"
          />
          Review flags
        </label>
        <div className="sketchi-icons__density" aria-label="Icon density">
          <button
            aria-pressed={density === "comfortable"}
            onClick={() => setDensity("comfortable")}
            type="button"
          >
            Comfortable
          </button>
          <button
            aria-pressed={density === "compact"}
            onClick={() => setDensity("compact")}
            type="button"
          >
            Compact
          </button>
        </div>
        {status === "ready" ? (
          <p aria-live="polite" className="sketchi-icons__count" role="status">
            Showing {visibleIcons.length.toLocaleString()} of{" "}
            {filteredIcons.length.toLocaleString()}
          </p>
        ) : null}
      </section>

      {status === "loading" ? (
        <section className="sketchi-icons__status" role="status">
          <span className="sketchi-icons__spin" aria-hidden="true" />
          Loading icon output…
        </section>
      ) : null}

      {status === "error" ? (
        <section className="sketchi-icons__status" role="alert">
          {errorMessage ?? "Icon output could not be loaded."}
        </section>
      ) : null}

      {status === "ready" ? (
        <div
          className="sketchi-icons__body"
          data-detail={selected ? "open" : "closed"}
        >
          <div className="sketchi-icons__results">
            {filteredIcons.length > 0 ? (
              <section
                className="sketchi-icons__grid"
                aria-label="Icon results"
              >
                {visibleIcons.map((icon) => (
                  <IconCard
                    active={selected?.id === icon.id}
                    icon={icon}
                    key={icon.id}
                    onSelect={(picked) => setSelectedId(picked.id)}
                  />
                ))}
              </section>
            ) : (
              <div className="sketchi-icons__empty">
                <p className="sketchi-icons__empty-title">
                  No icons match those filters.
                </p>
                <button
                  className="sketchi-icons__reset"
                  onClick={resetFilters}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            )}

            {hasMore ? (
              <div className="sketchi-icons__more">
                <button
                  className="sketchi-icons__more-btn"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  type="button"
                >
                  Load{" "}
                  {Math.min(
                    PAGE_SIZE,
                    filteredIcons.length - visibleIcons.length,
                  )}{" "}
                  more
                </button>
              </div>
            ) : null}
          </div>

          {selected ? (
            <aside className="sketchi-icons__detail">
              <IconDetail
                icon={selected}
                key={selected.id}
                onClose={() => setSelectedId(null)}
              />
            </aside>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
