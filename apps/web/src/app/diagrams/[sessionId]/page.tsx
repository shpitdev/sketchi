"use client";

import { useParams } from "next/navigation";

export default function DiagramStudioPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  return (
    <div className="container mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl">Diagram Studio</h1>
        <p className="text-muted-foreground text-sm">Session: {sessionId}</p>
      </div>
      <div className="flex items-center justify-center rounded border border-dashed p-12 text-muted-foreground text-xs">
        Excalidraw canvas will be embedded here.
      </div>
    </div>
  );
}
