import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  IconLibrary,
  type IconLibraryData,
} from "../components/icon-library/index.js";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

interface IconLibraryLoadState {
  data?: IconLibraryData;
  error?: string;
  status: "error" | "loading" | "ready";
}

function HomeRoute() {
  const [loadState, setLoadState] = useState<IconLibraryLoadState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;

    fetch("/output/review/review-data.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Icon output returned HTTP ${response.status}.`);
        }

        return (await response.json()) as IconLibraryData;
      })
      .then((data) => {
        if (active) {
          setLoadState({ data, status: "ready" });
        }
      })
      .catch((error) => {
        if (active) {
          setLoadState({
            error:
              error instanceof Error
                ? error.message
                : "Icon output could not be loaded.",
            status: "error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <IconLibrary
      data={loadState.data}
      errorMessage={loadState.error}
      status={loadState.status}
    />
  );
}
