"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api } from "@sketchi/backend/convex/_generated/api";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ChatSidebar,
  type ThreadMessage,
} from "@/components/diagram-studio/chat-sidebar";
import { ImportExportToolbar } from "@/components/diagram-studio/import-export-toolbar";
import { sanitizeAppState } from "@/components/diagram-studio/sanitize-app-state";
import { Button } from "@/components/ui/button";

const AUTOSAVE_DELAY_MS = 2000;
const RECENTS_KEY = "sketchi.diagramRecents.v1";
const RECENTS_MAX = 10;
const COMPLETION_PULSE_MS = 1500;
const STOP_RETRY_DELAYS_MS = [220, 380, 620];

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

type RunStatus =
  | "sending"
  | "running"
  | "applying"
  | "persisted"
  | "stopped"
  | "error";

interface RunState {
  promptMessageId: string;
  status: RunStatus;
  stopRequested: boolean;
}

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

    const filtered = recents.filter((recent) => recent.sessionId !== sessionId);
    filtered.unshift({ sessionId, visitedAt: Date.now() });
    const capped = filtered.slice(0, RECENTS_MAX);

    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(capped));
    } catch {
      // quota exceeded
    }
  } catch {
    // localStorage unavailable
  }
}

function createOptimisticUserMessage(input: {
  content: string;
  promptMessageId: string;
}): ThreadMessage {
  const now = Date.now();
  return {
    messageId: `optimistic_${input.promptMessageId}`,
    promptMessageId: input.promptMessageId,
    role: "user",
    messageType: "chat",
    content: input.content,
    reasoningSummary: null,
    status: "sending",
    toolName: null,
    toolCallId: null,
    toolInput: null,
    toolOutput: null,
    traceId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

function isRunActive(status: RunStatus | null): boolean {
  return status === "sending" || status === "running" || status === "applying";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function DiagramStudioPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const canQuerySession = Boolean(sessionId && user);

  const session = useQuery(
    api.diagramSessions.get,
    canQuerySession ? { sessionId } : "skip"
  );
  const thread = useQuery(
    api.diagramThreads.listBySession,
    canQuerySession ? { sessionId } : "skip"
  );

  const createSession = useMutation(api.diagramSessions.create);
  const enqueuePrompt = useMutation(api.diagramThreads.enqueuePrompt);
  const setLatestScene = useMutation(api.diagramSessions.setLatestScene);
  const stopPrompt = useMutation(api.diagramThreads.stopPrompt);
  const [isCreating, setIsCreating] = useState(false);

  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [autosaveDisabled, setAutosaveDisabled] = useState(false);
  const [liveNonDeletedCount, setLiveNonDeletedCount] = useState(0);
  const [showCompletionPulse, setShowCompletionPulse] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<ThreadMessage[]>(
    []
  );
  const [optimisticRunState, setOptimisticRunState] = useState<RunState | null>(
    null
  );

  const suppressOnChangeRef = useRef(true);
  const initialLoadAppliedRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownVersionRef = useRef(0);
  const appliedVersionRef = useRef<number | null>(null);
  const isLocallyDirtyRef = useRef(false);
  const lastElementsHashRef = useRef("");
  const pendingSceneRef = useRef<{
    elements: readonly Record<string, unknown>[];
    appState: Record<string, unknown>;
  } | null>(null);
  const previousRunStatusRef = useRef<RunStatus | null>(null);

  useEffect(() => {
    if (sessionId) {
      writeDiagramRecent(sessionId);
    }
  }, [sessionId]);

  const threadRunState: RunState | null = useMemo(() => {
    if (!thread?.latestRun) {
      return null;
    }

    return {
      promptMessageId: thread.latestRun.promptMessageId,
      status: thread.latestRun.status as RunStatus,
      stopRequested: thread.latestRun.stopRequested,
    };
  }, [thread]);

  useEffect(() => {
    if (!optimisticRunState) {
      return;
    }
    if (
      threadRunState &&
      threadRunState.promptMessageId === optimisticRunState.promptMessageId
    ) {
      setOptimisticRunState(null);
      return;
    }
    if (
      !(isRunActive(optimisticRunState.status) || threadRunState) &&
      optimisticRunState.stopRequested
    ) {
      setOptimisticRunState(null);
    }
  }, [optimisticRunState, threadRunState]);

  const runState = optimisticRunState ?? threadRunState;

  const activeRunStatus = runState?.status ?? null;
  const isProcessing = isRunActive(activeRunStatus);

  const triggerCompletionPulse = useCallback(() => {
    setShowCompletionPulse(true);
    setTimeout(() => {
      setShowCompletionPulse(false);
    }, COMPLETION_PULSE_MS);
  }, []);

  useEffect(() => {
    const previous = previousRunStatusRef.current;
    const current = runState?.status ?? null;

    if (previous && previous !== "persisted" && current === "persisted") {
      triggerCompletionPulse();
    }

    previousRunStatusRef.current = current;
  }, [runState?.status, triggerCompletionPulse]);

  useEffect(() => {
    if (!(thread && thread.messages.length > 0)) {
      return;
    }

    setOptimisticMessages((previous) =>
      previous.filter((optimistic) => {
        const hasPersisted = thread.messages.some(
          (message) =>
            message.role === "user" &&
            message.promptMessageId === optimistic.promptMessageId
        );
        return !hasPersisted;
      })
    );
  }, [thread]);

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
          appliedVersionRef.current = result.latestSceneVersion;
          isLocallyDirtyRef.current = false;
          setAutosaveDisabled(false);
          setSaveState({ status: "saved", savedAt: result.savedAt });
          pendingSceneRef.current = null;
        } else if (result.status === "conflict") {
          isLocallyDirtyRef.current = true;
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
      const nonDeleted = elements.filter(
        (element) => element.isDeleted !== true
      ).length;
      setLiveNonDeletedCount(nonDeleted);

      if (autosaveDisabled || suppressOnChangeRef.current || isProcessing) {
        return;
      }

      const hash = elements
        .map(
          (element) =>
            `${element.id}:${element.version}:${element.versionNonce}:${element.isDeleted ?? false}`
        )
        .join("|");
      if (hash === lastElementsHashRef.current) {
        return;
      }
      lastElementsHashRef.current = hash;
      isLocallyDirtyRef.current = true;

      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }

      autosaveTimeoutRef.current = setTimeout(() => {
        saveScene(elements, appState).catch(() => undefined);
      }, AUTOSAVE_DELAY_MS);
    },
    [autosaveDisabled, isProcessing, saveScene]
  );

  const applySceneToCanvas = useCallback(
    (input: {
      elements: readonly Record<string, unknown>[];
      appState: Record<string, unknown>;
      version: number;
    }) => {
      if (!excalidrawApi) {
        return;
      }

      suppressOnChangeRef.current = true;
      excalidrawApi.updateScene({
        elements: input.elements as unknown as Parameters<
          typeof excalidrawApi.updateScene
        >[0]["elements"],
        appState: input.appState as Parameters<
          typeof excalidrawApi.updateScene
        >[0]["appState"],
      });

      const hash = input.elements
        .map(
          (element) =>
            `${element.id}:${element.version}:${element.versionNonce}:${element.isDeleted ?? false}`
        )
        .join("|");
      lastElementsHashRef.current = hash;
      const nonDeleted = input.elements.filter(
        (element) => element.isDeleted !== true
      ).length;
      setLiveNonDeletedCount(nonDeleted);
      knownVersionRef.current = input.version;
      appliedVersionRef.current = input.version;
      isLocallyDirtyRef.current = false;

      requestAnimationFrame(() => {
        suppressOnChangeRef.current = false;
      });
    },
    [excalidrawApi]
  );

  const handleReady = useCallback(
    (readyApi: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(readyApi);

      if (session?.latestScene && !initialLoadAppliedRef.current) {
        initialLoadAppliedRef.current = true;
        applySceneToCanvas({
          elements: session.latestScene.elements as readonly Record<
            string,
            unknown
          >[],
          appState: session.latestScene.appState as Record<string, unknown>,
          version: session.latestSceneVersion,
        });
      } else {
        knownVersionRef.current = session?.latestSceneVersion ?? 0;
        appliedVersionRef.current = session?.latestSceneVersion ?? 0;
        requestAnimationFrame(() => {
          suppressOnChangeRef.current = false;
        });
      }
    },
    [applySceneToCanvas, session?.latestScene, session?.latestSceneVersion]
  );

  useEffect(() => {
    if (!(session?.latestScene && excalidrawApi)) {
      return;
    }

    const version = session.latestSceneVersion;
    if (appliedVersionRef.current === version) {
      return;
    }

    // If remote version advanced while local edits are unsaved, enter conflict
    // mode instead of silently replacing local work.
    if (isLocallyDirtyRef.current && version > knownVersionRef.current) {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }

      pendingSceneRef.current = {
        elements: excalidrawApi
          .getSceneElements()
          .map((element) => ({ ...element })) as readonly Record<
          string,
          unknown
        >[],
        appState: sanitizeAppState(
          excalidrawApi.getAppState() as Record<string, unknown>
        ),
      };
      knownVersionRef.current = version;
      setSaveState({
        status: "conflict",
        serverVersion: version,
      });
      return;
    }

    applySceneToCanvas({
      elements: session.latestScene.elements as readonly Record<
        string,
        unknown
      >[],
      appState: session.latestScene.appState as Record<string, unknown>,
      version,
    });
  }, [
    applySceneToCanvas,
    excalidrawApi,
    session?.latestScene,
    session?.latestSceneVersion,
  ]);

  const handleConflictReload = useCallback(async () => {
    if (!session?.latestScene) {
      return;
    }

    applySceneToCanvas({
      elements: session.latestScene.elements as readonly Record<
        string,
        unknown
      >[],
      appState: session.latestScene.appState as Record<string, unknown>,
      version: session.latestSceneVersion,
    });

    pendingSceneRef.current = null;
    isLocallyDirtyRef.current = false;
    setSaveState({ status: "saved", savedAt: Date.now() });
  }, [applySceneToCanvas, session?.latestScene, session?.latestSceneVersion]);

  const handleConflictOverwrite = useCallback(async () => {
    if (!pendingSceneRef.current || saveState.status !== "conflict") {
      return;
    }

    await saveScene(
      pendingSceneRef.current.elements,
      pendingSceneRef.current.appState,
      saveState.serverVersion
    );
  }, [saveScene, saveState]);

  const handlePrompt = useCallback(
    async (prompt: string, promptMessageId: string) => {
      if (!(sessionId && prompt.trim().length > 0) || isProcessing) {
        return;
      }

      setOptimisticMessages((previous) => [
        ...previous,
        createOptimisticUserMessage({ content: prompt, promptMessageId }),
      ]);
      setOptimisticRunState({
        promptMessageId,
        status: "sending",
        stopRequested: false,
      });

      try {
        await enqueuePrompt({
          sessionId,
          prompt,
          promptMessageId,
          traceId: crypto.randomUUID(),
        });
      } catch (error) {
        setOptimisticMessages((previous) =>
          previous.filter(
            (message) => message.promptMessageId !== promptMessageId
          )
        );
        setOptimisticRunState((previous) => {
          if (!previous) {
            return null;
          }
          if (previous.promptMessageId !== promptMessageId) {
            return previous;
          }
          return null;
        });
        const message =
          error instanceof Error ? error.message : "Failed to send prompt";
        toast.error(message);
      }
    },
    [enqueuePrompt, isProcessing, sessionId]
  );

  const handleStopPrompt = useCallback(
    async (promptMessageId: string) => {
      if (!sessionId) {
        return;
      }

      try {
        let attempts = 0;
        let requested: {
          status: "requested";
          runStatus:
            | "sending"
            | "running"
            | "applying"
            | "persisted"
            | "stopped"
            | "error";
          promptMessageId: string;
        } | null = null;

        while (attempts <= STOP_RETRY_DELAYS_MS.length) {
          const result = await stopPrompt({
            sessionId,
            promptMessageId,
          });

          if (result.status === "requested") {
            requested = result;
            break;
          }

          if (attempts === STOP_RETRY_DELAYS_MS.length) {
            break;
          }

          await delay(STOP_RETRY_DELAYS_MS[attempts] ?? 0);
          attempts += 1;
        }

        if (requested) {
          const resolvedPromptMessageId = requested.promptMessageId;
          setOptimisticRunState((previous) => {
            if (!previous) {
              return previous;
            }
            if (
              previous.promptMessageId !== promptMessageId &&
              previous.promptMessageId !== resolvedPromptMessageId
            ) {
              return previous;
            }
            return {
              ...previous,
              promptMessageId: resolvedPromptMessageId,
              status: requested.runStatus as RunStatus,
              stopRequested: true,
            };
          });
        } else {
          toast.error("Prompt is no longer running.");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to stop prompt";
        toast.error(message);
      }
    },
    [sessionId, stopPrompt]
  );

  const handleCreateNew = useCallback(async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    try {
      const { sessionId: newId } = await createSession();
      router.push(`/diagrams/${newId}` as never);
    } catch {
      // user can retry
    } finally {
      setIsCreating(false);
    }
  }, [createSession, isCreating, router]);

  const threadMessages = useMemo(() => {
    if (!thread) {
      return [] as ThreadMessage[];
    }
    return thread.messages as ThreadMessage[];
  }, [thread]);

  const combinedMessages = useMemo(() => {
    const merged = [...optimisticMessages, ...threadMessages];
    merged.sort((left, right) => left.createdAt - right.createdAt);
    return merged;
  }, [optimisticMessages, threadMessages]);

  if (authLoading || session === undefined) {
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
          <div className="flex h-full w-96 flex-col border-l bg-background">
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
            This diagram session doesn&apos;t exist or may have been removed.
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
          messages={combinedMessages}
          nonDeletedElementCount={liveNonDeletedCount}
          onSendPrompt={handlePrompt}
          onStopPrompt={handleStopPrompt}
          runState={runState}
          sessionId={sessionId}
          showCompletionPulse={showCompletionPulse}
        />
      </div>
    </div>
  );
}

function SaveStatus({ saveState }: { saveState: SaveState }) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
