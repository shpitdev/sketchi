"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { StyleSettings } from "@/lib/icon-library/svg-to-excalidraw";
import SketchyIconPreview from "./sketchy-icon-preview";

export interface IconGridItem {
  id: string;
  name: string;
  url: string | null;
}

interface IconGridProps {
  icons: IconGridItem[];
  onDeleteSelected: (ids: string[]) => void;
  onMove: (id: string, direction: "left" | "right") => void;
  isBusy?: boolean;
  styleSettings: StyleSettings;
}

export default function IconGrid({
  icons,
  onDeleteSelected,
  onMove,
  isBusy,
  styleSettings,
}: IconGridProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [iconSize, setIconSize] = useState(80);

  const handleZoomIn = () => setIconSize((prev) => Math.min(prev + 20, 200));
  const handleZoomOut = () => setIconSize((prev) => Math.max(prev - 20, 40));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeleteSelected = () => {
    onDeleteSelected(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsEditMode(false);
  };

  const exitEditMode = () => {
    setSelectedIds(new Set());
    setIsEditMode(false);
  };

  if (icons.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-center text-muted-foreground text-xs">
        No icons yet. Upload SVGs to populate this library.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <div className="mr-auto flex items-center gap-1">
          <Button
            aria-label="Zoom out"
            disabled={iconSize <= 40}
            onClick={handleZoomOut}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Minus />
          </Button>
          <Button
            aria-label="Zoom in"
            disabled={iconSize >= 200}
            onClick={handleZoomIn}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Plus />
          </Button>
        </div>
        {isEditMode ? (
          <>
            <Button
              onClick={exitEditMode}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={selectedIds.size === 0 || isBusy}
              onClick={handleDeleteSelected}
              size="sm"
              type="button"
              variant="destructive"
            >
              Delete Selected ({selectedIds.size})
            </Button>
          </>
        ) : (
          <Button
            disabled={isBusy}
            onClick={() => setIsEditMode(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit
          </Button>
        )}
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize}px, 1fr))`,
        }}
      >
        {icons.map((icon, index) => {
          const canMoveLeft = index > 0;
          const canMoveRight = index < icons.length - 1;
          const isSelected = selectedIds.has(icon.id);

          return (
            <div
              className="flex flex-col gap-2 rounded border bg-muted/10 p-2"
              key={icon.id}
            >
              <div className="relative">
                <SketchyIconPreview
                  name={icon.name}
                  styleSettings={styleSettings}
                  svgUrl={icon.url}
                />
                {isEditMode && (
                  <button
                    aria-label={isSelected ? "Deselect icon" : "Select icon"}
                    className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded border bg-background/80 transition-colors hover:bg-background"
                    onClick={() => toggleSelect(icon.id)}
                    type="button"
                  >
                    {isSelected && (
                      <svg
                        aria-hidden="true"
                        className="h-3 w-3 text-primary"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-muted-foreground">
                  {icon.name}
                </span>
              </div>

              {!isEditMode && (
                <div className="flex items-center gap-1">
                  <Button
                    disabled={isBusy || !canMoveLeft}
                    onClick={() => onMove(icon.id, "left")}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    ←
                  </Button>
                  <Button
                    disabled={isBusy || !canMoveRight}
                    onClick={() => onMove(icon.id, "right")}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    →
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
