"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api } from "@sketchi/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Loader2, PenTool } from "lucide-react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const ExcalidrawEditor = dynamic(
  () => import("@/components/diagram-studio/excalidraw-wrapper"),
  { ssr: false }
);

export default function DiagramStudioPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const session = useQuery(
    api.diagramSessions.get,
    sessionId ? { sessionId } : "skip"
  );

  const createSession = useMutation(api.diagramSessions.create);
  const [isCreating, setIsCreating] = useState(false);

  const [_excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);

  const suppressOnChangeRef = useRef(true);
  const initialLoadApplied = useRef(false);

  const handleReady = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(api);

      if (session?.latestScene && !initialLoadApplied.current) {
        initialLoadApplied.current = true;
      }

      requestAnimationFrame(() => {
        suppressOnChangeRef.current = false;
      });
    },
    [session?.latestScene]
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
        <span
          className="text-muted-foreground text-xs"
          data-testid="diagram-save-status"
        >
          {session.latestSceneVersion > 0 ? "Saved" : "Unsaved"}
        </span>
      </div>

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
          onReady={handleReady}
          suppressOnChangeRef={suppressOnChangeRef}
        />
      </div>
    </div>
  );
}
