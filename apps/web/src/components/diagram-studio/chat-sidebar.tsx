"use client";

import {
  AlertTriangle,
  ArrowDown,
  Loader2,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

const DRAFT_KEY_PREFIX = "sketchi.diagramDraft.v1";
const AUTO_SCROLL_BOTTOM_OFFSET_PX = 32;

type RunStatus =
  | "sending"
  | "running"
  | "applying"
  | "persisted"
  | "stopped"
  | "error";

interface ThreadMessage {
  content: string;
  createdAt: number;
  error: string | null;
  messageId: string;
  messageType: "chat" | "tool";
  promptMessageId: string | null;
  reasoningSummary: string | null;
  role: "user" | "assistant" | "tool";
  status: string | null;
  toolCallId: string | null;
  toolInput: unknown | null;
  toolName: string | null;
  toolOutput: unknown | null;
  traceId: string | null;
  updatedAt: number;
}

interface ChatSidebarProps {
  messages: ThreadMessage[];
  nonDeletedElementCount: number;
  onSendPrompt: (prompt: string, promptMessageId: string) => Promise<void>;
  onStopPrompt: (promptMessageId: string) => Promise<void>;
  runState: {
    promptMessageId: string;
    status: RunStatus;
    stopRequested: boolean;
  } | null;
  sessionId: string;
  showCompletionPulse: boolean;
}

function draftStorageKey(sessionId: string): string {
  return `${DRAFT_KEY_PREFIX}.${sessionId}`;
}

function createPromptMessageId(): string {
  return `prompt_${crypto.randomUUID().replace(/-/g, "")}`;
}

function statusLabel(status: RunStatus): string {
  switch (status) {
    case "sending":
      return "Sending";
    case "running":
      return "Running";
    case "applying":
      return "Applying";
    case "persisted":
      return "Persisted";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function isRunActive(status: RunStatus | null): boolean {
  return status === "sending" || status === "running" || status === "applying";
}

function isNearBottom(container: HTMLElement): boolean {
  const distanceFromBottom =
    container.scrollHeight - (container.scrollTop + container.clientHeight);
  return distanceFromBottom <= AUTO_SCROLL_BOTTOM_OFFSET_PX;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getStatusIcon(
  status: RunStatus | null,
  runActive: boolean
): ReactNode {
  if (runActive) {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  }
  if (status === "error") {
    return <AlertTriangle className="size-3.5 text-destructive" />;
  }
  if (status === "stopped") {
    return <Square className="size-3.5 text-muted-foreground" />;
  }
  return <Wrench className="size-3.5 text-muted-foreground" />;
}

function getToolBadgeClass(
  status: "pending" | "running" | "completed" | "error"
): string {
  if (status === "completed") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "error") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  if (status === "running") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

export function ChatSidebar({
  sessionId,
  messages,
  nonDeletedElementCount,
  onSendPrompt,
  onStopPrompt,
  runState,
  showCompletionPulse,
}: ChatSidebarProps) {
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const isCanvasEmpty = nonDeletedElementCount === 0;
  const activeStatus = runState?.status ?? null;
  const activePromptMessageId = runState?.promptMessageId ?? null;
  const runActive = isRunActive(activeStatus);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const latestMessageKey = useMemo(() => {
    const last = messages.at(-1);
    if (!last) {
      return "empty";
    }
    return `${messages.length}:${last.messageId}:${last.updatedAt}:${last.content.length}:${last.status ?? ""}`;
  }, [messages]);

  useEffect(() => {
    const key = draftStorageKey(sessionId);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        setInput(saved);
      }
    } catch {
      // ignore localStorage failures
    }
  }, [sessionId]);

  useEffect(() => {
    const key = draftStorageKey(sessionId);
    try {
      if (input.trim().length === 0) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, input);
      }
    } catch {
      // ignore localStorage failures
    }
  }, [input, sessionId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const inputLength = input.length;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 220);
    if (inputLength === 0) {
      textarea.scrollTop = 0;
    }
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    if (latestMessageKey === "empty") {
      setShowScrollToLatest(false);
      return;
    }

    if (atBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      setShowScrollToLatest(false);
      return;
    }

    setShowScrollToLatest(true);
  }, [latestMessageKey]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const atBottom = isNearBottom(container);
    atBottomRef.current = atBottom;
    if (atBottom) {
      setShowScrollToLatest(false);
    }
  }, []);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || runActive || isSubmitting) {
      return;
    }

    const promptMessageId = createPromptMessageId();

    setIsSubmitting(true);
    setInput("");
    try {
      await onSendPrompt(prompt, promptMessageId);
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting, onSendPrompt, runActive]);

  const handleStop = useCallback(async () => {
    if (!(activePromptMessageId && runActive)) {
      return;
    }
    await onStopPrompt(activePromptMessageId);
  }, [activePromptMessageId, onStopPrompt, runActive]);

  const handleComposerKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        await handleSend();
      }
    },
    [handleSend]
  );

  const handleScrollToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      atBottomRef.current = isNearBottom(container);
      if (atBottomRef.current) {
        setShowScrollToLatest(false);
      }
    });
  }, []);

  return (
    <aside
      className="flex h-full w-96 min-w-80 max-w-[32rem] flex-col border-l bg-background"
      data-testid="diagram-chat-sidebar"
    >
      <header className="border-b px-4 py-3" data-testid="diagram-chat-header">
        <h2 className="font-semibold text-sm">AI Assistant</h2>
      </header>

      {!isCanvasEmpty && (
        <div
          className="border-b bg-muted/50 px-4 py-2.5"
          data-testid="diagram-restructure-warning"
        >
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
            <p className="text-muted-foreground leading-relaxed">
              Structural prompts can relayout or drop unsupported freeform
              elements.
            </p>
          </div>
        </div>
      )}

      <div
        className="relative flex-1 overflow-y-auto px-4 py-3"
        data-testid="diagram-chat-scroll-container"
        onScroll={handleScroll}
        ref={scrollContainerRef}
      >
        {messages.length === 0 ? (
          <p
            className="pt-8 text-center text-muted-foreground text-xs"
            data-testid="diagram-chat-placeholder"
          >
            {isCanvasEmpty
              ? "Describe the diagram to generate..."
              : "Describe how the current diagram should change..."}
          </p>
        ) : (
          <div className="flex flex-col gap-3 pb-2">
            {messages.map((message) => {
              if (message.messageType === "tool") {
                return (
                  <ToolMessageRow key={message.messageId} message={message} />
                );
              }

              return (
                <ChatMessageBubble key={message.messageId} message={message} />
              );
            })}
          </div>
        )}

        {showScrollToLatest && (
          <div className="pointer-events-none sticky bottom-3 mt-3 flex justify-end">
            <Button
              className="pointer-events-auto"
              data-testid="diagram-scroll-to-latest"
              onClick={handleScrollToLatest}
              size="xs"
              type="button"
              variant="secondary"
            >
              <ArrowDown className="mr-1 size-3" />
              Scroll to latest
            </Button>
          </div>
        )}
      </div>

      {activeStatus && (
        <div
          className="flex items-center gap-2 border-t bg-muted/35 px-4 py-2"
          data-testid="diagram-status-row"
        >
          {getStatusIcon(activeStatus, runActive)}
          <span className="text-muted-foreground text-xs">
            {statusLabel(activeStatus)}
            {runState?.stopRequested && runActive ? " (stop requested)" : ""}
          </span>
        </div>
      )}

      {showCompletionPulse && (
        <div
          className="border-emerald-500/30 border-t bg-emerald-500/10 px-4 py-1.5 text-center text-emerald-600 text-xs transition-opacity duration-700 dark:text-emerald-400"
          data-testid="diagram-completion-pulse"
        >
          Persisted
        </div>
      )}

      <div className="border-t px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-56 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            data-testid="diagram-chat-input"
            disabled={runActive || isSubmitting}
            onChange={(event) => {
              setInput(event.target.value);
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              isCanvasEmpty
                ? "e.g. Create a login flow with retries"
                : "e.g. Add fraud-check branch before approval"
            }
            ref={textareaRef}
            rows={1}
            value={input}
          />
          {runActive ? (
            <Button
              data-testid="diagram-chat-stop"
              onClick={handleStop}
              size="sm"
              type="button"
              variant="outline"
            >
              <Square className="mr-1 size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              data-testid="diagram-chat-send"
              disabled={isSubmitting || input.trim().length === 0}
              onClick={handleSend}
              size="sm"
              type="button"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function ChatMessageBubble({ message }: { message: ThreadMessage }) {
  const isUser = message.role === "user";
  return (
    <article
      className={
        isUser
          ? "ml-6 rounded-xl border bg-primary/10 px-3 py-2"
          : "mr-6 rounded-xl border bg-muted/55 px-3 py-2"
      }
      data-testid={
        isUser ? "diagram-chat-message-user" : "diagram-chat-message-assistant"
      }
    >
      {message.content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {message.content}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">...</p>
      )}
      {message.reasoningSummary ? (
        <details className="mt-2 rounded-md border bg-background/60 px-2 py-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Reasoning summary
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {message.reasoningSummary}
          </p>
        </details>
      ) : null}
    </article>
  );
}

function ToolMessageRow({ message }: { message: ThreadMessage }) {
  const status = (message.status ?? "pending") as
    | "pending"
    | "running"
    | "completed"
    | "error";

  const badgeClass = getToolBadgeClass(status);

  const output = prettyJson(message.toolOutput);
  const input = prettyJson(message.toolInput);
  const hasDetails = Boolean(
    input || output || message.error || message.traceId
  );

  return (
    <div
      className="rounded-lg border border-dashed bg-background/70 px-2.5 py-2"
      data-testid="diagram-tool-message"
      data-tool-status={status}
    >
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5 text-muted-foreground" />
        <span className="truncate font-medium text-xs">
          {message.toolName ?? "tool"}
        </span>
        <span
          className={`ml-auto rounded border px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${badgeClass}`}
        >
          {status}
        </span>
      </div>

      {hasDetails ? (
        <details className="mt-2 rounded border bg-muted/35 px-2 py-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Details
          </summary>
          {input ? (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">
              {input}
            </pre>
          ) : null}
          {output ? (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">
              {output}
            </pre>
          ) : null}
          {message.error ? (
            <p className="mt-1 text-[11px] text-destructive">{message.error}</p>
          ) : null}
          {message.traceId ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              trace: {message.traceId}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export type { ChatSidebarProps, ThreadMessage };
