"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api } from "@sketchi/backend/convex/_generated/api";
import { useAction } from "convex/react";
import {
  Check,
  ClipboardCopy,
  Download,
  FileDown,
  Image,
  Link,
  Loader2,
  Upload,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { sanitizeAppState } from "@/components/diagram-studio/sanitize-app-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

interface ImportExportToolbarProps {
  excalidrawApi: ExcalidrawImperativeAPI | null;
  sessionId: string;
  saveScene: (
    elements: readonly Record<string, unknown>[],
    appState: Record<string, unknown>
  ) => Promise<void>;
  suppressOnChangeRef: React.RefObject<boolean>;
  knownVersionRef: React.RefObject<number>;
}

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" };

type ExportState =
  | { status: "idle" }
  | { status: "loading"; format: "share" | "excalidraw" | "png" }
  | { status: "copied" };

export function ImportExportToolbar({
  excalidrawApi,
  saveScene,
  suppressOnChangeRef,
}: ImportExportToolbarProps) {
  const parseDiagram = useAction(api.diagrams.parseDiagram);
  const shareDiagram = useAction(api.diagrams.shareDiagram);

  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
  });
  const [exportState, setExportState] = useState<ExportState>({
    status: "idle",
  });
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleImport = useCallback(async () => {
    const url = importUrl.trim();
    if (!(url && excalidrawApi)) {
      return;
    }

    setImportState({ status: "loading" });

    try {
      const result = await parseDiagram({ shareUrl: url });

      suppressOnChangeRef.current = true;

      excalidrawApi.updateScene({
        elements: result.elements as unknown as Parameters<
          typeof excalidrawApi.updateScene
        >[0]["elements"],
      });

      const elements = result.elements as readonly Record<string, unknown>[];
      const appState = (result.appState ?? {}) as Record<string, unknown>;
      await saveScene(elements, appState);

      setImportState({ status: "success" });
      setImportUrl("");
      toast.success(
        `Imported ${result.elements.length} elements from ${result.source}`
      );

      setTimeout(() => {
        setImportState({ status: "idle" });
        setShowImport(false);
      }, 1500);
    } catch (err) {
      setImportState({ status: "idle" });
      const message =
        err instanceof Error ? err.message : "Failed to parse share link";
      toast.error(message);
    } finally {
      requestAnimationFrame(() => {
        suppressOnChangeRef.current = false;
      });
    }
  }, [importUrl, excalidrawApi, parseDiagram, saveScene, suppressOnChangeRef]);

  const handleExportShare = useCallback(async () => {
    if (!excalidrawApi) {
      return;
    }

    setExportState({ status: "loading", format: "share" });

    try {
      const elements = [
        ...excalidrawApi.getSceneElements(),
      ] as unknown as unknown[];
      const rawAppState = excalidrawApi.getAppState() as unknown as Record<
        string,
        unknown
      >;

      const result = await shareDiagram({
        elements,
        appState: sanitizeAppState(rawAppState),
      });

      setShareUrl(result.url);
      await navigator.clipboard.writeText(result.url);

      setExportState({ status: "copied" });
      toast.success("Share link copied to clipboard");

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => {
        setExportState({ status: "idle" });
      }, 3000);
    } catch (err) {
      setExportState({ status: "idle" });
      const message =
        err instanceof Error ? err.message : "Failed to create share link";
      toast.error(message);
    }
  }, [excalidrawApi, shareDiagram]);

  const handleExportExcalidraw = useCallback(() => {
    if (!excalidrawApi) {
      return;
    }

    setExportState({ status: "loading", format: "excalidraw" });

    try {
      const elements = excalidrawApi.getSceneElements();
      const appState = excalidrawApi.getAppState();

      const data = {
        type: "excalidraw",
        version: 2,
        source: "sketchi",
        elements,
        appState: {
          viewBackgroundColor:
            (appState as Record<string, unknown>).viewBackgroundColor ??
            "#ffffff",
          gridSize: (appState as Record<string, unknown>).gridSize ?? null,
        },
      };

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = "diagram.excalidraw";
      link.click();
      URL.revokeObjectURL(url);

      setExportState({ status: "idle" });
      toast.success("Downloaded .excalidraw file");
    } catch (err) {
      setExportState({ status: "idle" });
      const message = err instanceof Error ? err.message : "Failed to export";
      toast.error(message);
    }
  }, [excalidrawApi]);

  const handleExportPng = useCallback(async () => {
    if (!excalidrawApi) {
      return;
    }

    setExportState({ status: "loading", format: "png" });

    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");

      const elements = excalidrawApi.getSceneElements();
      const appState = excalidrawApi.getAppState();
      const files = excalidrawApi.getFiles();

      const blob = await exportToBlob({
        elements,
        appState,
        files,
        mimeType: "image/png",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "diagram.png";
      link.click();
      URL.revokeObjectURL(url);

      setExportState({ status: "idle" });
      toast.success("Downloaded PNG");
    } catch (err) {
      setExportState({ status: "idle" });
      const message =
        err instanceof Error ? err.message : "Failed to export PNG";
      toast.error(message);
    }
  }, [excalidrawApi]);

  const isExporting = exportState.status === "loading";

  return (
    <div className="flex items-center gap-2">
      {showImport ? (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-7 w-64 text-xs"
            data-testid="diagram-import-input"
            disabled={importState.status === "loading"}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleImport();
              }
              if (e.key === "Escape") {
                setShowImport(false);
                setImportUrl("");
              }
            }}
            placeholder="Paste Excalidraw share link..."
            type="text"
            value={importUrl}
          />
          <Button
            data-testid="diagram-import-submit"
            disabled={importState.status === "loading" || !importUrl.trim()}
            onClick={handleImport}
            size="sm"
            type="button"
            variant="outline"
          >
            <ImportSubmitIcon status={importState.status} />
          </Button>
          <Button
            onClick={() => {
              setShowImport(false);
              setImportUrl("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="text-xs">Cancel</span>
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => setShowImport(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Upload className="mr-1 size-3.5" />
          <span className="text-xs">Import</span>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-8 items-center gap-1.5 rounded-none border border-input bg-background px-3 font-medium text-xs shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Export
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
          <DropdownMenuItem
            data-testid="diagram-export-share"
            disabled={isExporting}
            onClick={handleExportShare}
          >
            <Link className="size-3.5" />
            <span>Share link</span>
            {exportState.status === "copied" && (
              <Check className="ml-auto size-3 text-emerald-500" />
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="diagram-export-excalidraw"
            disabled={isExporting}
            onClick={handleExportExcalidraw}
          >
            <FileDown className="size-3.5" />
            <span>.excalidraw</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="diagram-export-png"
            disabled={isExporting}
            onClick={handleExportPng}
          >
            <Image className="size-3.5" />
            <span>PNG image</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {shareUrl && exportState.status === "copied" && (
        <button
          className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl);
            toast.success("Copied");
          }}
          type="button"
        >
          <ClipboardCopy className="size-3" />
          <span className="max-w-40 truncate">{shareUrl}</span>
        </button>
      )}
    </div>
  );
}

function ImportSubmitIcon({ status }: { status: ImportState["status"] }) {
  switch (status) {
    case "loading":
      return <Loader2 className="size-3.5 animate-spin" />;
    case "success":
      return <Check className="size-3.5" />;
    case "idle":
      return <Upload className="size-3.5" />;
    default:
      return null;
  }
}
