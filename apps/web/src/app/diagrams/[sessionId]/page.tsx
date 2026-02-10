"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api } from "@sketchi/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ChatMessage } from "@/components/diagram-studio/chat-sidebar";
import { ChatSidebar } from "@/components/diagram-studio/chat-sidebar";
import { ImportExportToolbar } from "@/components/diagram-studio/import-export-toolbar";
import { sanitizeAppState } from "@/components/diagram-studio/sanitize-app-state";
import { Button } from "@/components/ui/button";

const AUTOSAVE_DELAY_MS = 2000;
const RECENTS_KEY = "sketchi.diagramRecents.v1";
const RECENTS_MAX = 10;

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

type ProcessingMode = "generating" | "updating" | null;

function writeDiagramRecent(sessionId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    let recents: Array<{ sessionId: string; visitedAt: number }> = [];
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          recents = parsed.filter(
            (item): item is { sessionId: string; visitedAt: number } =>
              typeof item === "object" &&
              item !== null &&
              typeof item.sessionId === "string" &&
              typeof item.visitedAt === "number"
          );
        }
      }
    } catch {
      recents = [];
    }

    const filtered = recents.filter((r) => r.sessionId !== sessionId);
    filtered.unshift({ sessionId, visitedAt: Date.now() });
    const capped = filtered.slice(0, RECENTS_MAX);

    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(capped));
    } catch {
      /* quota exceeded */
    }
  } catch {
    /* localStorage unavailable */
  }
}

export default function DiagramStudioPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const session = useQuery(
    api.diagramSessions.get,
    sessionId ? { sessionId } : "skip"
  );

  const createSession = useMutation(api.diagramSessions.create);
  const setLatestScene = useMutation(api.diagramSessions.setLatestScene);
  const restructureFromScene = useAction(api.diagrams.restructureFromScene);
  const generateFromPrompt = useAction(
    api.diagrams.generateFromPromptForStudio
  );
  const [isCreating, setIsCreating] = useState(false);

  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [autosaveDisabled, setAutosaveDisabled] = useState(false);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [liveNonDeletedCount, setLiveNonDeletedCount] = useState(0);
  const [showCompletionPulse, setShowCompletionPulse] = useState(false);

  const suppressOnChangeRef = useRef(true);
  const initialLoadApplied = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownVersionRef = useRef(0);
  const lastElementsHashRef = useRef("");
  const pendingSceneRef = useRef<{
    elements: readonly Record<string, unknown>[];
    appState: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (sessionId) {
      writeDiagramRecent(sessionId);
    }
  }, [sessionId]);

  const isProcessing = processingMode !== null;

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
          appState: sanitizeAppState(appState),
        });

        if (result.status === "success") {
          knownVersionRef.current = result.latestSceneVersion;
          setAutosaveDisabled(false);
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
      const nonDeleted = elements.filter((el) => el.isDeleted !== true).length;
      setLiveNonDeletedCount(nonDeleted);

      if (autosaveDisabled || suppressOnChangeRef.current || isProcessing) {
        return;
      }

      const hash = elements
        .map(
          (e) =>
            `${e.id}:${e.version}:${e.versionNonce}:${e.isDeleted ?? false}`
        )
        .join("|");
      if (hash === lastElementsHashRef.current) {
        return;
      }
      lastElementsHashRef.current = hash;

      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }

      autosaveTimeoutRef.current = setTimeout(() => {
        saveScene(elements, appState);
      }, AUTOSAVE_DELAY_MS);
    },
    [autosaveDisabled, isProcessing, saveScene]
  );

  const handleReady = useCallback(
    (readyApi: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(readyApi);

      if (session?.latestScene && !initialLoadApplied.current) {
        initialLoadApplied.current = true;
        const els = session.latestScene.elements as readonly Record<
          string,
          unknown
        >[];
        lastElementsHashRef.current = els
          .map(
            (e) =>
              `${e.id}:${e.version}:${e.versionNonce}:${e.isDeleted ?? false}`
          )
          .join("|");

        const nonDeleted = els.filter((el) => el.isDeleted !== true).length;
        setLiveNonDeletedCount(nonDeleted);
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
      appState: session.latestScene.appState as Parameters<
        typeof excalidrawApi.updateScene
      >[0]["appState"],
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

  const triggerCompletionPulse = useCallback(() => {
    setShowCompletionPulse(true);
    setTimeout(() => setShowCompletionPulse(false), 1500);
  }, []);

  const pauseAutosave = useCallback(() => {
    suppressOnChangeRef.current = true;
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
  }, []);

  const applyResultScene = useCallback(
    async (
      api: ExcalidrawImperativeAPI,
      result: {
        elements: unknown[] | undefined;
        appState?: Record<string, unknown> | null;
      },
      fallbackAppState: Record<string, unknown>
    ) => {
      const elements = result.elements as unknown as Parameters<
        typeof api.updateScene
      >[0]["elements"];
      const appState = (result.appState ?? fallbackAppState) as Parameters<
        typeof api.updateScene
      >[0]["appState"];
      api.updateScene({ elements, appState });

      await saveScene(
        result.elements as Record<string, unknown>[],
        (result.appState ?? fallbackAppState) as Record<string, unknown>
      );
      triggerCompletionPulse();
    },
    [saveScene, triggerCompletionPulse]
  );

  const reportFailure = useCallback(
    (
      label: string,
      result: { issues?: Array<{ message: string }>; reason?: string }
    ) => {
      const reason =
        result.issues?.map((i) => i.message).join("; ") ??
        result.reason ??
        "Unknown error";
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `${label}: ${reason}` },
      ]);
      toast.error(`${label}: ${reason}`);
    },
    []
  );

  const executeGenerate = useCallback(
    async (
      api: ExcalidrawImperativeAPI,
      prompt: string,
      sid: string,
      appState: Record<string, unknown>
    ) => {
      const result = await generateFromPrompt({ prompt, sessionId: sid });
      pauseAutosave();
      if (result.status === "success" && result.elements) {
        await applyResultScene(api, result, appState);
      } else {
        reportFailure("Generation failed", result);
      }
    },
    [generateFromPrompt, pauseAutosave, applyResultScene, reportFailure]
  );

  const executeRestructure = useCallback(
    async (
      api: ExcalidrawImperativeAPI,
      prompt: string,
      sid: string,
      currentElements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>
    ) => {
      await saveScene(currentElements, appState);
      pauseAutosave();
      const result = await restructureFromScene({
        elements: [...currentElements] as unknown[],
        appState,
        prompt,
        sessionId: sid,
      });
      if (result.status === "success" && result.elements) {
        await applyResultScene(api, result, appState);
      } else {
        reportFailure("Restructure failed", result);
      }
    },
    [
      saveScene,
      restructureFromScene,
      pauseAutosave,
      applyResultScene,
      reportFailure,
    ]
  );

  const handlePrompt = useCallback(
    async (prompt: string) => {
      if (!(excalidrawApi && sessionId) || isProcessing) {
        return;
      }

      setChatMessages((prev) => [...prev, { role: "user", content: prompt }]);

      const currentElements =
        excalidrawApi.getSceneElements() as unknown as readonly Record<
          string,
          unknown
        >[];
      const nonDeletedCount = currentElements.filter(
        (el) => el.isDeleted !== true
      ).length;
      const isBlankCanvas = nonDeletedCount === 0;

      setProcessingMode(isBlankCanvas ? "generating" : "updating");

      try {
        const rawAppState = excalidrawApi.getAppState() as unknown as Record<
          string,
          unknown
        >;
        const appState = sanitizeAppState(rawAppState);

        if (isBlankCanvas) {
          await executeGenerate(excalidrawApi, prompt, sessionId, appState);
        } else {
          await executeRestructure(
            excalidrawApi,
            prompt,
            sessionId,
            currentElements,
            appState
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Operation failed";
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: message },
        ]);
        toast.error(message);
      } finally {
        setProcessingMode(null);
        suppressOnChangeRef.current = false;
      }
    },
    [
      excalidrawApi,
      sessionId,
      isProcessing,
      executeGenerate,
      executeRestructure,
    ]
  );

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
      <div
        className="flex h-full flex-col overflow-hidden"
        data-testid="diagram-studio-skeleton"
      >
        <div className="flex items-center gap-4 border-b px-4 py-2">
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-px bg-border" />
          <div className="h-4 w-8 animate-pulse rounded bg-muted" />
          <div className="h-3 w-px bg-border" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-7 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="relative flex-1 bg-muted/20">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </div>
          <div className="flex h-full w-80 flex-col border-l bg-background">
            <div className="border-b px-4 py-3">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </div>
            <div className="flex-1 px-4 py-3">
              <div className="mx-auto h-3 w-40 animate-pulse rounded bg-muted" />
            </div>
            <div className="border-t px-4 py-3">
              <div className="flex gap-2">
                <div className="h-8 flex-1 animate-pulse rounded-md bg-muted" />
                <div className="h-8 w-10 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          </div>
        </div>
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

  const allElements = (session.latestScene?.elements ?? []) as readonly Record<
    string,
    unknown
  >[];
  const elementCount = allElements.length;

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
        <div className="ml-auto">
          <ImportExportToolbar
            excalidrawApi={excalidrawApi}
            knownVersionRef={knownVersionRef}
            saveScene={saveScene}
            sessionId={sessionId}
            suppressOnChangeRef={suppressOnChangeRef}
          />
        </div>
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

      <div className="flex flex-1 overflow-hidden">
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
        <ChatSidebar
          messages={chatMessages}
          nonDeletedElementCount={liveNonDeletedCount}
          onSendPrompt={handlePrompt}
          processingMode={processingMode}
          showCompletionPulse={showCompletionPulse}
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
