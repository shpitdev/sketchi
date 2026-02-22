import Image from "next/image";
import Link from "next/link";

import { Card } from "@/components/ui/card";

interface LibraryCardProps {
  iconCount: number;
  id: string;
  name: string;
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
      <Card className="flex h-full flex-col gap-4 rounded-2xl border-2 p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-foreground/30 hover:shadow-md">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base">{name}</h3>
          <span className="rounded-full bg-secondary/80 px-2 py-0.5 font-medium text-secondary-foreground text-xs">
            {iconCount} icons
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {previewUrls.length === 0
            ? placeholderKeys.map((key) => (
                <div
                  className="aspect-square rounded-xl border-2 border-muted-foreground/30 border-dashed bg-muted/5"
                  key={key}
                />
              ))
            : previewUrls.map((url, idx) => (
                <div
                  className="relative flex aspect-square items-center justify-center rounded-xl border-2 bg-muted/20"
                  key={url}
                >
                  <Image
                    alt={`${name} preview ${idx + 1}`}
                    className="object-contain p-2"
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
