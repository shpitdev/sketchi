import Image from "next/image";
import Link from "next/link";

import { Card } from "@/components/ui/card";

interface LibraryCardProps {
  id: string;
  name: string;
  iconCount: number;
  previewUrls: string[];
}

export default function LibraryCard({
  id,
  name,
  iconCount,
  previewUrls,
}: LibraryCardProps) {
  const placeholderKeys = ["slot-1", "slot-2", "slot-3"];

  return (
    <Link href={`/library-generator/${id}`}>
      <Card className="flex h-full flex-col gap-3 border p-4 transition hover:border-foreground/40">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{name}</h3>
          <span className="text-muted-foreground text-xs">
            {iconCount} icons
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {previewUrls.length === 0
            ? placeholderKeys.map((key) => (
                <div
                  className="aspect-square rounded border border-muted-foreground/40 border-dashed"
                  key={key}
                />
              ))
            : previewUrls.map((url, idx) => (
                <div
                  className="relative flex aspect-square items-center justify-center rounded border bg-muted/30"
                  key={url}
                >
                  <Image
                    alt={`${name} preview ${idx + 1}`}
                    className="object-contain"
                    fill
                    sizes="96px"
                    src={url}
                    unoptimized
                  />
                </div>
              ))}
        </div>
      </Card>
    </Link>
  );
}
