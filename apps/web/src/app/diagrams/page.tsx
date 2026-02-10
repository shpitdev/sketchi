"use client";

import { api } from "@sketchi/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { PenTool } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export default function DiagramsPage() {
  const router = useRouter();
  const createSession = useMutation(api.diagramSessions.create);
  const [isCreating, setIsCreating] = useState(false);

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

  return (
    <div className="container mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl">AI Diagram Studio</h1>
        <p className="text-muted-foreground text-sm">
          Create and edit diagrams with AI-powered restructuring. Each session
          gets a unique shareable URL.
        </p>
      </div>

      <section className="flex flex-col items-start gap-3 rounded border p-4">
        <h2 className="font-semibold text-sm">Start a new diagram</h2>
        <p className="text-muted-foreground text-xs">
          Opens an Excalidraw canvas with AI restructure, autosave, and
          import/export.
        </p>
        <Button
          data-testid="diagram-new-session"
          disabled={isCreating}
          onClick={handleCreate}
          size="sm"
          type="button"
        >
          <PenTool className="mr-1.5 size-4" />
          {isCreating ? "Creating..." : "New diagram"}
        </Button>
      </section>
    </div>
  );
}
