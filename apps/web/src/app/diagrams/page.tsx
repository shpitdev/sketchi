"use client";

import { api } from "@sketchi/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import {
  ArrowRight,
  Clock,
  ExternalLink,
  PenTool,
  Save,
  Share2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const RECENTS_KEY = "sketchi.diagramRecents.v1";
const MAX_RECENTS = 10;

interface RecentDiagram {
  sessionId: string;
  visitedAt: number;
}

function readRecents(): RecentDiagram[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is RecentDiagram =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as RecentDiagram).sessionId === "string" &&
          typeof (item as RecentDiagram).visitedAt === "number"
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(recents: RecentDiagram[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // Quota error — ignore
  }
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const FEATURES = [
  {
    icon: <Sparkles className="size-3.5" />,
    label: "AI-powered restructuring via chat sidebar",
  },
  {
    icon: <Save className="size-3.5" />,
    label: "Auto-save with version history and conflict resolution",
  },
  {
    icon: <Share2 className="size-3.5" />,
    label: "Shareable URLs — no sign-in required",
  },
  {
    icon: <Wand2 className="size-3.5" />,
    label: "Import/export Excalidraw, PNG, and JSON",
  },
];

export default function DiagramsPage() {
  const router = useRouter();
  const createSession = useMutation(api.diagramSessions.create);
  const [isCreating, setIsCreating] = useState(false);
  const [recents, setRecents] = useState<RecentDiagram[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  const handleCreate = async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);

    try {
      const { sessionId } = await createSession();
      router.push(`/diagrams/${sessionId}` as never);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create diagram session.";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemoveRecent = useCallback(
    (sessionId: string) => {
      const next = recents.filter((r) => r.sessionId !== sessionId);
      setRecents(next);
      writeRecents(next);
    },
    [recents]
  );

  const handleClearAll = useCallback(() => {
    setRecents([]);
    writeRecents([]);
  }, []);

  const hasRecents = recents.length > 0;

  return (
    <div className="container mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          AI Diagram Studio
        </h1>
        <p className="max-w-lg text-muted-foreground text-sm leading-relaxed">
          Create, restructure, and share diagrams on a collaborative Excalidraw
          canvas. Each session auto-saves and produces a unique URL you can
          share with anyone.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <li className="flex items-start gap-2.5 text-sm" key={f.label}>
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground/60">
              {f.icon}
            </span>
            <span className="text-muted-foreground">{f.label}</span>
          </li>
        ))}
      </ul>

      <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70">
            <PenTool className="size-4" />
          </div>
          <div>
            <h2 className="font-medium text-sm">Start a new diagram</h2>
            <p className="text-muted-foreground text-xs">
              Opens an Excalidraw canvas with AI restructure, autosave, and
              import/export.
            </p>
          </div>
        </div>
        <Button
          data-testid="diagram-new-session"
          disabled={isCreating}
          onClick={handleCreate}
          size="sm"
          type="button"
        >
          {isCreating ? "Creating..." : "New diagram"}
          <ArrowRight className="ml-1 size-3.5" />
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-sm">Recent diagrams</h2>
          {hasRecents && (
            <Button
              className="text-muted-foreground"
              data-testid="diagram-recents-clear"
              onClick={handleClearAll}
              size="xs"
              type="button"
              variant="ghost"
            >
              <Trash2 className="mr-1 size-3" />
              Clear all
            </Button>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Session URLs are capability tokens and grant edit access to anyone
            who has them. Share links carefully.
          </p>
        </div>

        {hasRecents ? (
          <ul
            className="flex flex-col divide-y divide-border rounded-xl border bg-card"
            data-testid="diagram-recents-list"
          >
            {recents.map((r) => (
              <RecentItem
                key={r.sessionId}
                onRemove={handleRemoveRecent}
                recent={r}
              />
            ))}
          </ul>
        ) : (
          <div
            className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-8 text-center"
            data-testid="diagram-recents-list"
          >
            <Clock className="size-5 text-muted-foreground/50" />
            <p className="text-muted-foreground text-xs">
              No recent diagrams. Create one to get started.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function RecentItem({
  recent,
  onRemove,
}: {
  recent: RecentDiagram;
  onRemove: (sessionId: string) => void;
}) {
  const { sessionId, visitedAt } = recent;
  const truncatedId = useMemo(() => {
    return sessionId.length > 8 ? `${sessionId.slice(0, 8)}...` : sessionId;
  }, [sessionId]);

  const timeAgo = useMemo(() => relativeTime(visitedAt), [visitedAt]);

  return (
    <li
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
      data-testid="diagram-recents-item"
    >
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" />

      <Link
        className="flex min-w-0 flex-1 items-baseline gap-2 text-sm hover:underline"
        href={`/diagrams/${sessionId}` as never}
      >
        <code className="font-mono text-foreground text-xs">{truncatedId}</code>
        <span className="text-muted-foreground text-xs">{timeAgo}</span>
      </Link>

      <Button
        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        data-testid="diagram-recents-remove"
        onClick={(e) => {
          e.preventDefault();
          onRemove(sessionId);
        }}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X className="size-3" />
      </Button>
    </li>
  );
}
