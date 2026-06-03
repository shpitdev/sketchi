import type { DiagramCatalogEntry } from "@sketchi/diagram-core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

export type DiagramCatalogItem = DiagramCatalogEntry;

export interface DiagramCatalogProps {
  items: DiagramCatalogItem[];
  onSelect: (id: string) => void;
  selectedId: string;
}

interface VisibleCatalogRow {
  index: number;
  key: bigint | number | string;
  size: number;
  start: number;
}

export function DiagramCatalog({
  items,
  onSelect,
  selectedId,
}: DiagramCatalogProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 72,
    getScrollElement: () => scrollParentRef.current,
    initialRect: { height: 240, width: 320 },
    overscan: 4,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const visibleRows: VisibleCatalogRow[] = virtualRows.length
    ? virtualRows
    : items.map((item, index) => ({
        index,
        key: item.id,
        size: 72,
        start: index * 72,
      }));

  return (
    <section aria-label="Diagram catalog" className="sketchi-catalog">
      <div className="sketchi-catalog__viewport" ref={scrollParentRef}>
        <div
          className="sketchi-catalog__spacer"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {visibleRows.map((virtualRow) => {
            const item = items[virtualRow.index];

            if (!item) {
              return null;
            }

            const isSelected = item.id === selectedId;

            return (
              <button
                aria-pressed={isSelected}
                className="sketchi-catalog__item"
                data-selected={isSelected}
                key={String(virtualRow.key)}
                onClick={() => onSelect(item.id)}
                style={{
                  height: `${virtualRow.size - 8}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                type="button"
              >
                <span className="sketchi-catalog__item-label">
                  {item.label}
                </span>
                <span className="sketchi-catalog__item-description">
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
