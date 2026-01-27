"use client";

import { api } from "@sketchi/backend/convex/_generated/api";
import type { Id } from "@sketchi/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import ExportButton from "@/components/icon-library/export-button";
import IconGrid from "@/components/icon-library/icon-grid";
import StyleControls from "@/components/icon-library/style-controls";
import SvgUploader from "@/components/icon-library/svg-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StyleSettings } from "@/lib/icon-library/svg-to-excalidraw";
import {
  MAX_SVG_BYTES,
  validateSvgText,
} from "@/lib/icon-library/svg-validate";

const defaultStyleSettings: StyleSettings = {
  strokeColor: "#1f2937",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  fillStyle: "solid",
  roughness: 0,
  opacity: 100,
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function LibraryEditorPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const libraryId = resolvedParams.id as Id<"iconLibraries">;
  const data = useQuery(
    api.iconLibraries.get,
    resolvedParams.id ? { id: libraryId } : "skip"
  );
  const updateLibrary = useMutation(api.iconLibraries.update);
  const generateUploadUrl = useMutation(api.iconLibraries.generateUploadUrl);
  const addIcon = useAction(api.iconLibrariesActions.addIcon);
  const deleteIcon = useMutation(api.iconLibraries.deleteIcon);
  const reorderIcons = useMutation(api.iconLibraries.reorderIcons);
  const [libraryName, setLibraryName] = useState("");
  const [styleSettings, setStyleSettings] =
    useState<StyleSettings>(defaultStyleSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (data?.library) {
      setLibraryName(data.library.name);
      setStyleSettings(data.library.styleSettings as StyleSettings);
    }
  }, [data?.library]);

  const icons = useMemo(
    () =>
      (data?.icons ?? []).map((icon) => ({
        id: icon._id,
        name: icon.originalName,
        url: icon.url,
      })),
    [data?.icons]
  );

  const handleSave = async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await updateLibrary({
        id: libraryId,
        name: libraryName.trim() || "Untitled Library",
        styleSettings,
      });
      toast.success("Library updated.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save library.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const uploadSvgFile = async (file: File) => {
    if (file.size > MAX_SVG_BYTES) {
      toast.error(`${file.name} exceeds 256KB.`);
      return;
    }

    const text = await file.text();
    try {
      validateSvgText(text);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Invalid SVG: ${file.name}`;
      toast.error(message);
      return;
    }

    const uploadUrl = await generateUploadUrl({});
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "image/svg+xml" },
      body: file,
    });

    if (!response.ok) {
      toast.error(`Upload failed for ${file.name}.`);
      return;
    }

    const payload = (await response.json()) as { storageId: string };
    await addIcon({
      libraryId,
      storageId: payload.storageId as Id<"_storage">,
      originalName: file.name,
    });
  };

  const handleUpload = async (files: FileList) => {
    if (isUploading) {
      return;
    }
    setIsUploading(true);

    try {
      for (const file of Array.from(files)) {
        await uploadSvgFile(file);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteSelected = async (ids: string[]) => {
    try {
      for (const id of ids) {
        await deleteIcon({ iconId: id as Id<"iconItems"> });
      }
      toast.success(
        ids.length === 1 ? "Icon deleted." : `${ids.length} icons deleted.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete icons.";
      toast.error(message);
    }
  };

  const handleMove = async (id: string, direction: "left" | "right") => {
    const currentIndex = icons.findIndex((icon) => icon.id === id);
    if (currentIndex === -1) {
      return;
    }
    const nextIndex =
      direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= icons.length) {
      return;
    }

    const nextOrder = icons.map((icon) => icon.id);
    const [moved] = nextOrder.splice(currentIndex, 1);
    nextOrder.splice(nextIndex, 0, moved);

    try {
      await reorderIcons({
        libraryId,
        orderedIds: nextOrder as Id<"iconItems">[],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to reorder icons.";
      toast.error(message);
    }
  };

  if (!data) {
    return (
      <div className="container mx-auto w-full max-w-5xl px-4 py-6">
        <div className="rounded border border-dashed p-6 text-muted-foreground text-xs">
          Loading library…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-semibold text-lg">Library editor</h1>
          <Input
            onChange={(event) => setLibraryName(event.target.value)}
            value={libraryName}
          />
          <Button
            disabled={isSaving}
            onClick={handleSave}
            size="sm"
            type="button"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Style settings</h2>
          <StyleControls onChange={setStyleSettings} value={styleSettings} />
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">Upload</h2>
          <SvgUploader isUploading={isUploading} onUpload={handleUpload} />
        </div>

        <div className="mt-auto">
          <ExportButton
            icons={icons.map((icon) => ({ name: icon.name, url: icon.url }))}
            libraryName={libraryName}
            styleSettings={styleSettings}
          />
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-sm">Icons</h2>
            <span className="text-muted-foreground text-xs">
              {icons.length} icons
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <IconGrid
            icons={icons}
            isBusy={isUploading}
            onDeleteSelected={handleDeleteSelected}
            onMove={handleMove}
            styleSettings={styleSettings}
          />
        </div>
      </main>
    </div>
  );
}
