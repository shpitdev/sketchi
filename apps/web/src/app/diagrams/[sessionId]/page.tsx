"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api } from "@sketchi/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  Loader2,
  PenTool,
  RefreshCw,
  Save,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const AUTOSAVE_DELAY_MS = 2000;

const ExcalidrawEditor = dynamic(
  () => import("@/components/diagram-studio/excalidraw-wrapper"),
  { ssr: false }
);

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; savedAt: number }
  | { status: "conflict"; serverVersion: number }
  | { status: "error"; message: string };

export default function DiagramStudioPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const session = useQuery(
    api.diagramSessions.get,
    sessionId ? { sessionId } : "skip"
  );

  const createSession = useMutation(api.diagramSessions.create);
  const setLatestScene = useMutation(api.diagramSessions.setLatestScene);
  const [isCreating, setIsCreating] = useState(false);

  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [autosaveDisabled, setAutosaveDisabled] = useState(false);

  const suppressOnChangeRef = useRef(true);
  const initialLoadApplied = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownVersionRef = useRef(0);
  const pendingSceneRef = useRef<{
    elements: readonly Record<string, unknown>[];
    appState: Record<string, unknown>;
  } | null>(null);

  const saveScene = useCallback(
    async (
      elements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>,
      overrideVersion?: number
    ) => {
      if (!sessionId) {
        return;
      }

      setSaveState({ status: "saving" });

      try {
        const result = await setLatestScene({
          sessionId,
          expectedVersion: overrideVersion ?? knownVersionRef.current,
          elements: elements as Record<string, unknown>[],
          appState,
        });

        if (result.status === "success") {
          knownVersionRef.current = result.latestSceneVersion;
          setSaveState({ status: "saved", savedAt: result.savedAt });
          pendingSceneRef.current = null;
        } else if (result.status === "conflict") {
          pendingSceneRef.current = { elements, appState };
          setSaveState({
            status: "conflict",
            serverVersion: result.latestSceneVersion,
          });
        } else if (
          result.status === "failed" &&
          "reason" in result &&
          result.reason === "scene-too-large"
        ) {
          setAutosaveDisabled(true);
          const maxKb = Math.round(
            (result as { maxBytes: number }).maxBytes / 1024
          );
          const actualKb = Math.round(
            (result as { actualBytes: number }).actualBytes / 1024
          );
          toast.error(
            `Scene too large (${actualKb} KB). Maximum is ${maxKb} KB. Autosave disabled until scene is reduced.`
          );
          setSaveState({
            status: "error",
            message: `Too large: ${actualKb}/${maxKb} KB`,
          });
        }
      } catch {
        setSaveState({ status: "error", message: "Save failed" });
      }
    },
    [sessionId, setLatestScene]
  );

  const handleChange = useCallback(
    (
      elements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>
    ) => {
      if (autosaveDisabled) {
        return;
      }

      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }

      autosaveTimeoutRef.current = setTimeout(() => {
        saveScene(elements, appState);
      }, AUTOSAVE_DELAY_MS);
    },
    [autosaveDisabled, saveScene]
  );

  const handleReady = useCallback(
    (readyApi: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(readyApi);

      if (session?.latestScene && !initialLoadApplied.current) {
        initialLoadApplied.current = true;
      }

      knownVersionRef.current = session?.latestSceneVersion ?? 0;

      requestAnimationFrame(() => {
        suppressOnChangeRef.current = false;
      });
    },
    [session?.latestScene, session?.latestSceneVersion]
  );

  const handleConflictReload = useCallback(async () => {
    if (!(excalidrawApi && session?.latestScene)) {
      return;
    }

    suppressOnChangeRef.current = true;

    excalidrawApi.updateScene({
      elements: session.latestScene.elements as unknown as Parameters<
        typeof excalidrawApi.updateScene
      >[0]["elements"],
    });

    knownVersionRef.current = session.latestSceneVersion;
    pendingSceneRef.current = null;
    setSaveState({
      status: "saved",
      savedAt: Date.now(),
    });

    requestAnimationFrame(() => {
      suppressOnChangeRef.current = false;
    });
  }, [excalidrawApi, session?.latestScene, session?.latestSceneVersion]);

  const handleConflictOverwrite = useCallback(async () => {
    if (!pendingSceneRef.current || saveState.status !== "conflict") {
      return;
    }

    await saveScene(
      pendingSceneRef.current.elements,
      pendingSceneRef.current.appState,
      saveState.serverVersion
    );
  }, [saveState, saveScene]);

  const handleCreateNew = async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const { sessionId: newId } = await createSession();
      router.push(`/diagrams/${newId}` as never);
    } catch {
      /* empty — user can retry via button */
    } finally {
      setIsCreating(false);
    }
  };

  if (session === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-semibold text-lg">Session not found</h1>
          <p className="max-w-sm text-muted-foreground text-sm">
            This diagram session doesn't exist or may have been removed.
          </p>
        </div>
        <Button
          disabled={isCreating}
          onClick={handleCreateNew}
          size="sm"
          type="button"
        >
          <PenTool className="mr-1.5 size-4" />
          {isCreating ? "Creating..." : "New diagram"}
        </Button>
      </div>
    );
  }

  const elementCount = session.latestScene?.elements?.length ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <span className="font-mono text-muted-foreground text-xs">
          {sessionId.slice(0, 8)}...
        </span>
        <div className="h-3 w-px bg-border" />
        <span
          className="text-muted-foreground text-xs"
          data-testid="diagram-session-version"
        >
          v{session.latestSceneVersion}
        </span>
        <div className="h-3 w-px bg-border" />
        <span
          className="text-muted-foreground text-xs"
          data-testid="diagram-element-count"
        >
          {elementCount} {elementCount === 1 ? "element" : "elements"}
        </span>
        <div className="h-3 w-px bg-border" />
        <SaveStatus saveState={saveState} />
      </div>

      {saveState.status === "conflict" && (
        <div
          className="flex items-center gap-3 border-destructive/30 border-b bg-destructive/10 px-4 py-2"
          data-testid="diagram-conflict-banner"
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="text-sm">
            Another tab saved a newer version. Your unsaved changes may
            conflict.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              data-testid="conflict-reload"
              onClick={handleConflictReload}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className="mr-1.5 size-3" />
              Reload server version
            </Button>
            <Button
              data-testid="conflict-overwrite"
              onClick={handleConflictOverwrite}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Save className="mr-1.5 size-3" />
              Overwrite with mine
            </Button>
          </div>
        </div>
      )}

      <div className="relative flex-1">
        <ExcalidrawEditor
          initialScene={
            session.latestScene
              ? {
                  elements: session.latestScene.elements as readonly Record<
                    string,
                    unknown
                  >[],
                  appState: session.latestScene.appState as Record<
                    string,
                    unknown
                  >,
                }
              : null
          }
          onChange={handleChange}
          onReady={handleReady}
          suppressOnChangeRef={suppressOnChangeRef}
        />
      </div>
    </div>
  );
}

function SaveStatus({ saveState }: { saveState: SaveState }) {
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  switch (saveState.status) {
    case "idle":
      return (
        <span
          className="text-muted-foreground text-xs"
          data-testid="diagram-save-status"
        >
          Unsaved
        </span>
      );
    case "saving":
      return (
        <span
          className="flex items-center gap-1 text-muted-foreground text-xs"
          data-testid="diagram-save-status"
        >
          <Loader2 className="size-3 animate-spin" />
          Saving...
        </span>
      );
    case "saved":
      return (
        <span
          className="flex items-center gap-1 text-emerald-600 text-xs dark:text-emerald-400"
          data-testid="diagram-save-status"
        >
          <Check className="size-3" />
          Saved {formatTime(saveState.savedAt)}
        </span>
      );
    case "conflict":
      return (
        <span
          className="flex items-center gap-1 text-destructive text-xs"
          data-testid="diagram-save-status"
        >
          <AlertTriangle className="size-3" />
          Conflict
        </span>
      );
    case "error":
      return (
        <span
          className="text-destructive text-xs"
          data-testid="diagram-save-status"
        >
          {saveState.message}
        </span>
      );
    default:
      return null;
  }
}
