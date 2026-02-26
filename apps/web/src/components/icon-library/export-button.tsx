import { generateNKeysBetween } from "fractional-indexing";
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
  inlineSvgPaintStyles,
  makeRenderedSvgScalable,
} from "@/lib/icon-library/rough-svg";
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
  icons: ExportIconItem[];
  libraryName: string;
  styleSettings: StyleSettings;
}

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const randomInt = () => Math.floor(Math.random() * 2 ** 31);

const sanitizeFileName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "library";

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function fetchIconSvg(icon: ExportIconItem): Promise<string | null> {
  if (!icon.url) {
    throw new Error(`Missing icon URL for ${icon.name}.`);
  }
  const response = await fetch(icon.url);
  if (!response.ok) {
    throw new Error(`Failed to load ${icon.name}.`);
  }
  const svgText = await response.text();
  if (!validateAndLogSvg(svgText, icon.name)) {
    return null;
  }
  return svgText;
}

function getUniqueFileName(baseName: string, usedNames: Set<string>): string {
  let finalName = baseName;
  let counter = 1;
  while (usedNames.has(finalName)) {
    finalName = `${baseName}-${counter}`;
    counter++;
  }
  usedNames.add(finalName);
  return finalName;
}

const FIXED_SEED = 12_345;
const DEFAULT_ICON_SIZE = 120;
const GRID_GAP = 32;
const LABEL_PADDING = 8;

const SVG_EXTENSION_REGEX = /\.svg$/i;
const SEPARATOR_REGEX = /[-_]/g;
const VIEWBOX_SPLIT_REGEX = /[,\s]+/;

const formatLabelText = (filename: string) =>
  filename
    .replace(SVG_EXTENSION_REGEX, "")
    .replace(SEPARATOR_REGEX, " ")
    .trim();

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
  styleSettings: StyleSettings,
  strokeWidth = 2
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

  inlineSvgPaintStyles(svg);

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
      strokeWidth,
    };
    converter.randomize = styleSettings.randomize;
    converter.pencilFilter = styleSettings.pencilFilter;

    converter.sketch();
    makeRenderedSvgScalable(container);

    return container.innerHTML;
  } finally {
    document.body.removeChild(container);
  }
}

function svgToDataUrl(svgText: string): string {
  const bytes = new TextEncoder().encode(svgText);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = btoa(binary);
  return `data:image/svg+xml;base64,${encoded}`;
}

function getSvgDimensions(svgText: string): { width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");

  if (!svg) {
    return { width: DEFAULT_ICON_SIZE, height: DEFAULT_ICON_SIZE };
  }

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .split(VIEWBOX_SPLIT_REGEX)
      .map((value) => Number.parseFloat(value));
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { width: Math.abs(parts[2]), height: Math.abs(parts[3]) };
    }
  }

  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height)) {
    return { width, height };
  }

  return { width: DEFAULT_ICON_SIZE, height: DEFAULT_ICON_SIZE };
}

interface SceneIconPayload {
  name: string;
  svgText: string;
}

interface SkippedIcon {
  name: string;
  reason: string;
}

interface SceneImageFile {
  created: number;
  dataURL: string;
  id: string;
  lastRetrieved: number;
  mimeType: "image/svg+xml";
  status: "saved";
}

interface SceneBuildResult {
  elements: Record<string, unknown>[];
  exportedIconCount: number;
  files: Record<string, SceneImageFile>;
  skipped: SkippedIcon[];
}

interface SceneExportOutcome {
  exportedIconCount: number;
  message?: string;
  payload?: {
    type: "excalidraw";
    version: 2;
    source: "https://excalidraw.com";
    elements: Record<string, unknown>[];
    appState: {
      viewBackgroundColor: "#ffffff";
      gridSize: null;
    };
    files: Record<string, SceneImageFile>;
  };
  skipped: SkippedIcon[];
  status: "empty" | "ready";
}

async function collectScenePayloads(
  icons: ExportIconItem[]
): Promise<{ payloads: SceneIconPayload[]; skipped: SkippedIcon[] }> {
  const payloads: SceneIconPayload[] = [];
  const skipped: SkippedIcon[] = [];

  for (const icon of icons) {
    try {
      const svgText = await fetchIconSvg(icon);
      if (!svgText) {
        skipped.push({ name: icon.name, reason: "Invalid SVG" });
        continue;
      }
      payloads.push({ name: icon.name, svgText });
    } catch (error) {
      skipped.push({
        name: icon.name,
        reason: error instanceof Error ? error.message : "Failed to fetch SVG",
      });
    }
  }

  return { payloads, skipped };
}

function buildSceneFromPayloads(
  payloads: SceneIconPayload[],
  styleSettings: StyleSettings
): SceneBuildResult {
  const columns = Math.ceil(Math.sqrt(payloads.length));
  const showLabel = styleSettings.showLabel;
  const fontSize = styleSettings.labelSize;
  const lineHeight = 1.25;
  const textHeight = fontSize * lineHeight;
  const labelBlockHeight = showLabel ? textHeight + LABEL_PADDING : 0;

  const elements: Record<string, unknown>[] = [];
  const files: Record<string, SceneImageFile> = {};
  const skipped: SkippedIcon[] = [];
  let exportedIconCount = 0;

  for (const [index, icon] of payloads.entries()) {
    let renderedSvg: string;
    let rawWidth: number;
    let rawHeight: number;

    try {
      renderedSvg = renderSketchySvg(icon.svgText, icon.name, styleSettings, 1);
      ({ width: rawWidth, height: rawHeight } = getSvgDimensions(icon.svgText));
    } catch (error) {
      skipped.push({
        name: icon.name,
        reason:
          error instanceof Error ? error.message : "Failed to render sketch",
      });
      continue;
    }

    const scale = DEFAULT_ICON_SIZE / Math.max(rawWidth, rawHeight, 1);
    const imageWidth = rawWidth * scale;
    const imageHeight = rawHeight * scale;

    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = column * (DEFAULT_ICON_SIZE + GRID_GAP);
    const cellY = row * (DEFAULT_ICON_SIZE + GRID_GAP + labelBlockHeight);
    const imageX = cellX + (DEFAULT_ICON_SIZE - imageWidth) / 2;
    const imageY = cellY + (DEFAULT_ICON_SIZE - imageHeight) / 2;

    const groupId = randomId();
    const imageId = randomId();
    const fileId = randomId();
    const updated = Date.now();

    elements.push({
      type: "image",
      version: 1,
      versionNonce: randomInt(),
      isDeleted: false,
      id: imageId,
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      angle: 0,
      x: imageX,
      y: imageY,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      width: imageWidth,
      height: imageHeight,
      seed: randomInt(),
      groupIds: [groupId],
      roundness: null,
      frameId: null,
      boundElements: null,
      updated,
      link: null,
      locked: false,
      index: "",
      fileId,
      scale: [1, 1],
      status: "saved",
    });

    files[fileId] = {
      id: fileId,
      dataURL: svgToDataUrl(renderedSvg),
      mimeType: "image/svg+xml",
      created: updated,
      lastRetrieved: updated,
      status: "saved",
    };

    if (showLabel) {
      const labelText = formatLabelText(icon.name);
      const labelWidth = labelText.length * fontSize * 0.5;
      elements.push({
        type: "text",
        version: 1,
        versionNonce: randomInt(),
        isDeleted: false,
        id: randomId(),
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        angle: 0,
        x: cellX + DEFAULT_ICON_SIZE / 2 - labelWidth / 2,
        y: cellY + DEFAULT_ICON_SIZE + LABEL_PADDING,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        width: labelWidth,
        height: textHeight,
        seed: randomInt(),
        groupIds: [groupId],
        roundness: null,
        frameId: null,
        boundElements: null,
        updated,
        link: null,
        locked: false,
        index: "",
        text: labelText,
        fontSize,
        fontFamily: 1,
        textAlign: "center",
        verticalAlign: "top",
        containerId: null,
        originalText: labelText,
        autoResize: true,
        lineHeight: lineHeight as number & { _brand: "unitlessLineHeight" },
      });
    }

    exportedIconCount += 1;
  }

  if (elements.length > 0) {
    const indices = generateNKeysBetween(null, null, elements.length);
    for (let i = 0; i < elements.length; i += 1) {
      elements[i].index = indices[i];
    }
  }

  return { elements, files, exportedIconCount, skipped };
}

async function createSceneExportOutcome(
  icons: ExportIconItem[],
  styleSettings: StyleSettings
): Promise<SceneExportOutcome> {
  const { payloads, skipped: fetchSkipped } = await collectScenePayloads(icons);

  if (payloads.length === 0) {
    return {
      status: "empty",
      message: "No valid SVGs to export.",
      skipped: fetchSkipped,
      exportedIconCount: 0,
    };
  }

  const scene = buildSceneFromPayloads(payloads, styleSettings);
  const skipped = [...fetchSkipped, ...scene.skipped];

  if (scene.elements.length === 0) {
    return {
      status: "empty",
      message: "No icons could be rendered for export.",
      skipped,
      exportedIconCount: 0,
    };
  }

  return {
    status: "ready",
    payload: {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: scene.elements,
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: null,
      },
      files: scene.files,
    },
    skipped,
    exportedIconCount: scene.exportedIconCount,
  };
}

export default function ExportButton({
  libraryName,
  icons,
  styleSettings,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcalidrawScene = async () => {
    if (icons.length === 0) {
      toast.error("Add at least one icon before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      const outcome = await createSceneExportOutcome(icons, styleSettings);

      if (outcome.status === "empty") {
        if (outcome.skipped.length > 0) {
          console.warn("Excalidraw export skipped icons:", outcome.skipped);
        }
        toast.error(outcome.message ?? "No valid SVGs to export.");
        return;
      }

      const payload = outcome.payload;
      if (!payload) {
        toast.error("Export failed unexpectedly.");
        return;
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const fileName = `${sanitizeFileName(libraryName)}.excalidraw`;
      triggerBlobDownload(blob, fileName);

      if (outcome.skipped.length > 0) {
        console.warn("Excalidraw export skipped icons:", outcome.skipped);
      }
      const skippedCount = outcome.skipped.length;
      toast.success(
        skippedCount > 0
          ? `Downloaded ${outcome.exportedIconCount} icons. Skipped ${skippedCount}.`
          : `Downloaded ${outcome.exportedIconCount} icons as Excalidraw.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Export failed unexpectedly.";
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

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
      const usedNames = new Set<string>();

      for (const icon of icons) {
        const svgText = await fetchIconSvg(icon);
        if (!svgText) {
          continue;
        }
        const baseName = sanitizeFileName(icon.name);
        const finalName = getUniqueFileName(baseName, usedNames);
        zip.file(`${finalName}.svg`, svgText);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${sanitizeFileName(libraryName)}.zip`;
      triggerBlobDownload(blob, fileName);

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
      const usedNames = new Set<string>();

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
        const baseName = sanitizeFileName(icon.name);
        let finalName = baseName;
        let counter = 1;

        while (usedNames.has(finalName)) {
          finalName = `${baseName}-${counter}`;
          counter++;
        }

        usedNames.add(finalName);
        zip.file(`${finalName}.svg`, renderedSvg);
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
        <DropdownMenuItem
          disabled={disabled}
          onClick={handleExportExcalidrawScene}
        >
          Export as .excalidraw (SVGs + text)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={handleExportExcalidraw}>
          Export as .excalidrawlib (trace)
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
