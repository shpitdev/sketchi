"use client";

import { api } from "@sketchi/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import LibraryCard from "@/components/icon-library/library-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LibraryGeneratorPage() {
  const router = useRouter();
  const libraries = useQuery(api.iconLibraries.list);
  const createLibrary = useMutation(api.iconLibraries.create);
  const [libraryName, setLibraryName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  let libraryContent = (
    <div className="rounded-2xl border-2 border-muted-foreground/30 border-dashed bg-muted/10 p-8 text-center font-medium text-muted-foreground text-sm">
      Loading libraries…
    </div>
  );

  if (libraries && libraries.length === 0) {
    libraryContent = (
      <div className="rounded-2xl border-2 border-muted-foreground/30 border-dashed bg-muted/10 p-12 text-center font-medium text-muted-foreground text-sm">
        No libraries yet. Create one to get started.
      </div>
    );
  } else if (libraries && libraries.length > 0) {
    libraryContent = (
      <div className="grid gap-4 md:grid-cols-2">
        {libraries.map((library) => (
          <LibraryCard
            iconCount={library.iconCount}
            id={library._id}
            key={library._id}
            name={library.name}
            previewUrls={library.previewUrls}
          />
        ))}
      </div>
    );
  }

  const handleCreate = async () => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);

    try {
      const name = libraryName.trim() || "Untitled Library";
      const id = await createLibrary({ name });
      router.push(`/library-generator/${id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create library.";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:py-12">
      <div className="flex flex-col gap-2.5">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
          Icon Library Generator
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Build and export Excalidraw icon libraries from SVG files.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-2xl border-2 border-foreground/10 bg-card p-6 shadow-sm transition-all hover:border-foreground/25 hover:shadow-md">
        <h2 className="font-semibold text-base">Create a new library</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            className="border-2 shadow-sm"
            onChange={(event) => setLibraryName(event.target.value)}
            placeholder="Library name"
            value={libraryName}
          />
          <Button
            className="font-semibold shadow-sm transition-transform [border-radius:255px_15px_225px_15px/15px_225px_15px_255px] hover:-translate-y-0.5"
            disabled={isCreating}
            onClick={handleCreate}
            size="default"
            type="button"
          >
            {isCreating ? "Creating…" : "Create"}
          </Button>
        </div>
      </section>

      <section className="mt-2 flex flex-col gap-4">
        <h2 className="font-semibold text-base">Your libraries</h2>
        {libraryContent}
      </section>
    </div>
  );
}
