"use client";

import { AlertTriangle, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface ChatMessage {
  content: string;
  role: "user" | "assistant";
}

type ProcessingMode = "generating" | "updating" | null;

interface ChatSidebarProps {
  messages: ChatMessage[];
  nonDeletedElementCount: number;
  onSendPrompt: (prompt: string) => void;
  processingMode: ProcessingMode;
  showCompletionPulse: boolean;
}

export function ChatSidebar({
  messages,
  nonDeletedElementCount,
  onSendPrompt,
  processingMode,
  showCompletionPulse,
}: ChatSidebarProps) {
  const [input, setInput] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCanvasEmpty = nonDeletedElementCount === 0;
  const isProcessing = processingMode !== null;

  const handleSend = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isProcessing) {
      return;
    }

    setInput("");
    onSendPrompt(prompt);
  }, [input, isProcessing, onSendPrompt]);

  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messageCount]);

  useEffect(() => {
    if (isProcessing) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedSeconds(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isProcessing]);

  return (
    <div
      className="flex h-full w-80 flex-col border-l bg-background"
      data-testid="diagram-chat-sidebar"
    >
      <div className="border-b px-4 py-3" data-testid="diagram-chat-header">
        <h2 className="font-semibold text-sm">AI Assistant</h2>
      </div>

      {!isCanvasEmpty && (
        <div
          className="border-b bg-muted/50 px-4 py-3"
          data-testid="diagram-restructure-warning"
        >
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
            <p className="text-muted-foreground text-xs leading-relaxed">
              Restructure rewrites layout and may drop non-graph elements.
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p
            className="text-center text-muted-foreground text-xs"
            data-testid="diagram-chat-placeholder"
          >
            {isCanvasEmpty
              ? "Describe your diagram..."
              : "Describe changes to your diagram..."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div
                className={
                  msg.role === "user"
                    ? "ml-4 rounded-lg bg-primary/10 px-3 py-2 text-sm"
                    : "mr-4 rounded-lg bg-muted px-3 py-2 text-sm"
                }
                key={`${msg.role}-${i}`}
              >
                {msg.content}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {isProcessing && (
        <div
          className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2"
          data-testid="diagram-status-row"
        >
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground text-xs">
            {processingMode === "generating" ? "Generating" : "Updating"}
            {elapsedSeconds >= 2 ? ` (${elapsedSeconds}s)` : "..."}
          </span>
        </div>
      )}

      {showCompletionPulse && (
        <div
          className="border-emerald-500/30 border-t bg-emerald-500/10 px-4 py-1.5 text-center text-emerald-600 text-xs transition-opacity duration-700 dark:text-emerald-400"
          data-testid="diagram-completion-pulse"
        >
          Done
        </div>
      )}

      <div className="border-t px-4 py-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            data-testid="diagram-chat-input"
            disabled={isProcessing}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isCanvasEmpty
                ? "e.g. Create a login flow..."
                : "e.g. Add error handling flow..."
            }
            type="text"
            value={input}
          />
          <Button
            data-testid="diagram-chat-send"
            disabled={isProcessing || !input.trim()}
            onClick={handleSend}
            size="sm"
            type="button"
          >
            {isProcessing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { ChatSidebarProps, ChatMessage };
