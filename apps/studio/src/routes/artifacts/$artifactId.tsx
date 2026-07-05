import {
  RenderedDiagramSceneSchema,
  type GetArtifactResult,
} from "@sketchi/diagram-agent";
import { DiagramPreview } from "@sketchi/diagram-studio-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

export const Route = createFileRoute("/artifacts/$artifactId")({
  component: ArtifactRoute,
});

type ArtifactViewState =
  | { status: "loading" }
  | { scene: RenderedDiagramScene; status: "ready" }
  | { message: string; status: "error" };

function isGetArtifactResult(value: unknown): value is GetArtifactResult {
  return Boolean(value) && typeof value === "object";
}

function artifactExportUrls(artifactId: string) {
  const encoded = encodeURIComponent(artifactId);
  return {
    excalidraw: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
    scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
  };
}

function ArtifactRoute() {
  const { artifactId } = Route.useParams();
  const [state, setState] = useState<ArtifactViewState>({
    status: "loading",
  });
  const exportUrls = useMemo(
    () => artifactExportUrls(artifactId),
    [artifactId],
  );

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/artifacts/${encodeURIComponent(
            artifactId,
          )}?format=scene&inline=true`,
        );
        const payload: unknown = await response.json();

        if (!response.ok || !isGetArtifactResult(payload) || !payload.ok) {
          throw new Error("Artifact could not be loaded.");
        }

        const parsed = RenderedDiagramSceneSchema.safeParse(payload.inline);
        if (!parsed.success) {
          throw new Error("Artifact scene could not be rendered.");
        }

        if (!cancelled) {
          setState({
            scene: parsed.data as RenderedDiagramScene,
            status: "ready",
          });
        }
      } catch (caught) {
        if (!cancelled) {
          setState({
            message:
              caught instanceof Error
                ? caught.message
                : "Artifact could not be loaded.",
            status: "error",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  return (
    <main className="artifact-view">
      <header className="artifact-view__bar">
        <a className="studio__mark artifact-view__mark" href="/">
          sketchi
        </a>
        <div className="artifact-view__actions">
          <a className="studio__artifact-link" href="/">
            Playground
          </a>
          <a className="studio__artifact-link" href={exportUrls.scene}>
            Scene JSON
          </a>
          <a className="studio__artifact-link" href={exportUrls.excalidraw}>
            Excalidraw
          </a>
        </div>
      </header>

      <section className="artifact-view__stage">
        {state.status === "loading" ? (
          <p className="artifact-view__message">Loading artifact...</p>
        ) : null}
        {state.status === "error" ? (
          <p className="artifact-view__message artifact-view__message--error">
            {state.message}
          </p>
        ) : null}
        {state.status === "ready" ? (
          <DiagramPreview scene={state.scene} />
        ) : null}
      </section>
    </main>
  );
}
