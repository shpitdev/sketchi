"use client";

import { AlertTriangle, Loader2, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatSidebarProps {
  isRestructuring: boolean;
  messages: ChatMessage[];
  onSendPrompt: (prompt: string) => void;
}

export function ChatSidebar({
  isRestructuring,
  messages,
  onSendPrompt,
}: ChatSidebarProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isRestructuring) {
      return;
    }

    setInput("");
    onSendPrompt(prompt);
  }, [input, isRestructuring, onSendPrompt]);

  return (
    <div
      className="flex h-full w-80 flex-col border-l bg-background"
      data-testid="diagram-chat-sidebar"
    >
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold text-sm">Restructure</h2>
      </div>

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

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-center text-muted-foreground text-xs">
            Describe how to restructure the diagram.
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

      <div className="border-t px-4 py-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            data-testid="diagram-chat-input"
            disabled={isRestructuring}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="e.g. Add error handling flow..."
            type="text"
            value={input}
          />
          <Button
            data-testid="diagram-chat-send"
            disabled={isRestructuring || !input.trim()}
            onClick={handleSend}
            size="sm"
            type="button"
          >
            {isRestructuring ? (
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
