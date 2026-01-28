import JSZip from "jszip";
import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OutputType, Svg2Roughjs } from "svg2roughjs";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type StyleSettings,
  svgToExcalidrawElements,
} from "@/lib/icon-library/svg-to-excalidraw";
import { validateSvgText } from "@/lib/icon-library/svg-validate";

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

const sanitizeFileName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "library";

const FIXED_SEED = 12_345;

function makeSvgScalable(container: HTMLElement): void {
  const svg = container.querySelector("svg");
  if (!svg) {
    return;
  }

  const width = svg.getAttribute("width");
  const height = svg.getAttribute("height");

  if (!svg.getAttribute("viewBox") && width && height) {
    const w = Number.parseFloat(width);
    const h = Number.parseFloat(height);
    if (!(Number.isNaN(w) || Number.isNaN(h))) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
}

function validateAndLogSvg(svgText: string, iconName: string): boolean {
  try {
    validateSvgText(svgText);
    return true;
  } catch (error) {
    console.warn(
      `Skipping invalid SVG ${iconName}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

function renderSketchySvg(
  svgText: string,
  iconName: string,
  styleSettings: StyleSettings
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Failed to parse SVG for ${iconName}`);
  }

  const svg = doc.querySelector("svg");
  if (!svg) {
    throw new Error(`No SVG element found in ${iconName}`);
  }

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  try {
    const converter = new Svg2Roughjs(container, OutputType.SVG);
    converter.seed = FIXED_SEED;

    converter.svg = svg;
    converter.roughConfig = {
      fill: undefined,
      fillStyle: styleSettings.fillStyle,
      roughness: styleSettings.roughness,
      bowing: styleSettings.bowing,
      stroke: "#000000",
      strokeWidth: 2,
    };
    converter.randomize = styleSettings.randomize;
    converter.pencilFilter = styleSettings.pencilFilter;

    converter.sketch();
    makeSvgScalable(container);

    return container.innerHTML;
  } finally {
    document.body.removeChild(container);
  }
}

export default function ExportButton({
  libraryName,
  icons,
  styleSettings,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcalidraw = async () => {
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
        if (!validateAndLogSvg(svgText, icon.name)) {
          continue;
        }
        const elements = svgToExcalidrawElements(
          svgText,
          styleSettings,
          icon.name
        );

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

      const fileName = `${sanitizeFileName(libraryName)}.excalidrawlib`;

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

  const handleExportZip = async () => {
    if (icons.length === 0) {
      toast.error("Add at least one icon before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const zip = new JSZip();

      for (const icon of icons) {
        if (!icon.url) {
          throw new Error(`Missing icon URL for ${icon.name}.`);
        }
        const response = await fetch(icon.url);
        if (!response.ok) {
          throw new Error(`Failed to load ${icon.name}.`);
        }
        const svgText = await response.text();
        if (!validateAndLogSvg(svgText, icon.name)) {
          continue;
        }
        const safeName = sanitizeFileName(icon.name);
        zip.file(`${safeName}.svg`, svgText);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${sanitizeFileName(libraryName)}.zip`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Downloaded ${icons.length} icons as ZIP.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed unexpectedly.";
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSketchyZip = async () => {
    if (icons.length === 0) {
      toast.error("Add at least one icon before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const zip = new JSZip();

      for (const icon of icons) {
        if (!icon.url) {
          throw new Error(`Missing icon URL for ${icon.name}.`);
        }
        const response = await fetch(icon.url);
        if (!response.ok) {
          throw new Error(`Failed to load ${icon.name}.`);
        }
        const svgText = await response.text();

        const renderedSvg = renderSketchySvg(svgText, icon.name, styleSettings);
        const safeName = sanitizeFileName(icon.name);
        zip.file(`${safeName}.svg`, renderedSvg);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${sanitizeFileName(libraryName)}-sketchy.zip`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Downloaded ${icons.length} sketchy icons as ZIP.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed unexpectedly.";
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  const disabled = isExporting || icons.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm shadow-xs transition-all hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
      >
        <Download className="size-4" />
        {isExporting ? "Exporting..." : "Export"}
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onClick={handleExportExcalidraw}>
          Export as .excalidrawlib
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={handleExportZip}>
          Export as ZIP (SVGs)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={handleExportSketchyZip}>
          Export as Sketchy SVGs (ZIP)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
