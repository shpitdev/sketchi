import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  type StyleSettings,
  svgToExcalidrawElements,
} from "@/lib/icon-library/svg-to-excalidraw";

export interface ExportIconItem {
  name: string;
  url: string | null;
}

interface ExportButtonProps {
  libraryName: string;
  icons: ExportIconItem[];
  styleSettings: StyleSettings;
}

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

export default function ExportButton({
  libraryName,
  icons,
  styleSettings,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  let exportLabel = "Export .excalidrawlib";

  if (icons.length === 0) {
    exportLabel = "Export disabled (no icons)";
  } else if (isExporting) {
    exportLabel = "Exporting…";
  }

  const handleExport = async () => {
    if (icons.length === 0) {
      toast.error("Add at least one icon before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const libraryItems = [] as Array<{
        id: string;
        status: "published";
        created: number;
        name?: string;
        elements: ReturnType<typeof svgToExcalidrawElements>;
      }>;

      for (const icon of icons) {
        if (!icon.url) {
          throw new Error(`Missing icon URL for ${icon.name}.`);
        }
        const response = await fetch(icon.url);
        if (!response.ok) {
          throw new Error(`Failed to load ${icon.name}.`);
        }
        const svgText = await response.text();
        const elements = svgToExcalidrawElements(svgText, styleSettings);

        libraryItems.push({
          id: randomId(),
          status: "published",
          created: Date.now(),
          name: icon.name,
          elements,
        });
      }

      const payload = {
        type: "excalidrawlib",
        version: 2,
        source: "https://excalidraw.com",
        libraryItems,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/vnd.excalidrawlib+json",
      });

      const fileName = `${
        libraryName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "library"
      }.excalidrawlib`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed unexpectedly.";
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      disabled={isExporting || icons.length === 0}
      onClick={handleExport}
      size="sm"
      type="button"
    >
      {exportLabel}
    </Button>
  );
}
