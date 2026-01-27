import Image from "next/image";

import { Button } from "@/components/ui/button";

export interface IconGridItem {
  id: string;
  name: string;
  url: string | null;
}

interface IconGridProps {
  icons: IconGridItem[];
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "left" | "right") => void;
  isBusy?: boolean;
}

const computeGrid = (count: number) => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count || 1)));
  const rows = Math.ceil(count / columns);
  const lastRowCount = count - (rows - 1) * columns;
  const offset =
    lastRowCount > 0 ? Math.floor((columns - lastRowCount) / 2) : 0;
  const lastRowStart = (rows - 1) * columns;
  return { columns, offset, lastRowStart };
};

export default function IconGrid({
  icons,
  onDelete,
  onMove,
  isBusy,
}: IconGridProps) {
  if (icons.length === 0) {
    return (
      <div className="rounded border border-dashed p-6 text-center text-muted-foreground text-xs">
        No icons yet. Upload SVGs to populate this library.
      </div>
    );
  }

  const { columns, offset, lastRowStart } = computeGrid(icons.length);

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {icons.map((icon, index) => {
        const isLastRowStart = index === lastRowStart && offset > 0;
        const canMoveLeft = index > 0;
        const canMoveRight = index < icons.length - 1;
        return (
          <div
            className="flex flex-col gap-2 rounded border bg-muted/10 p-2"
            key={icon.id}
            style={isLastRowStart ? { gridColumnStart: offset + 1 } : undefined}
          >
            <div className="relative flex aspect-square items-center justify-center rounded border bg-muted/30">
              {icon.url ? (
                <Image
                  alt={icon.name}
                  className="object-contain"
                  fill
                  sizes="96px"
                  src={icon.url}
                  unoptimized
                />
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  preview
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] text-muted-foreground">
                {icon.name}
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <div className="flex gap-1">
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
              <Button
                disabled={isBusy}
                onClick={() => onDelete(icon.id)}
                size="xs"
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
