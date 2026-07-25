import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { IconLibrary } from "../components/icon-library/index.js";
import { decodeIconManifest, type IconManifest } from "../lib/icon-data.js";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

type IconLibraryLoadState =
  | { readonly status: "loading" }
  | { readonly data: IconManifest; readonly status: "ready" }
  | { readonly error: string; readonly status: "error" };

function HomeRoute() {
  const [loadState, setLoadState] = useState<IconLibraryLoadState>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    void fetch("/icons-manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Icon library returned HTTP ${response.status}.`);
        }
        const payload: unknown = await response.json();
        return decodeIconManifest(payload);
      })
      .then((data) => setLoadState({ data, status: "ready" }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          error:
            error instanceof Error
              ? error.message
              : "The icon library could not be loaded.",
          status: "error",
        });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <IconLibrary
      {...(loadState.status === "ready" ? { data: loadState.data } : {})}
      {...(loadState.status === "error"
        ? { errorMessage: loadState.error }
        : {})}
      onRetry={() => setAttempt((current) => current + 1)}
      status={loadState.status}
    />
  );
}
