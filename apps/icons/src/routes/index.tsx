import { QueryClient, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { IconLibrary } from "../components/icon-library/index.js";
import { decodeIconManifest, type IconManifest } from "@sketchi/icon-catalog";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

async function loadIconManifest(signal: AbortSignal): Promise<IconManifest> {
  const response = await fetch("/icons-manifest.json", { signal });
  if (!response.ok) {
    throw new Error(`Icon library returned HTTP ${response.status}.`);
  }
  const payload: unknown = await response.json();
  return decodeIconManifest(payload);
}

function HomeRoute() {
  const [queryClient] = useState(() => new QueryClient());
  // Route-local query: unmounting aborts the manifest request, and retry
  // refetches through the same query instead of a manual attempt counter.
  const manifest = useQuery(
    {
      gcTime: 0,
      queryFn: ({ signal }) => loadIconManifest(signal),
      queryKey: ["icons-manifest"],
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
    },
    queryClient,
  );

  return (
    <IconLibrary
      {...(manifest.isSuccess ? { data: manifest.data } : {})}
      {...(manifest.isError
        ? {
            errorMessage:
              manifest.error instanceof Error
                ? manifest.error.message
                : "The icon library could not be loaded.",
          }
        : {})}
      onRetry={() => void manifest.refetch()}
      status={
        manifest.isSuccess
          ? "ready"
          : manifest.isError && !manifest.isFetching
            ? "error"
            : "loading"
      }
    />
  );
}
