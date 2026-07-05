import { ArtifactCanvas } from "@sketchi/diagram-studio-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  artifactRouteUrls,
  fetchArtifactScene,
  type ArtifactViewState,
} from "@/lib/artifact-view-client";
import { createStudioProjectFromArtifact } from "@/lib/studio-projects-client";

export const Route = createFileRoute("/artifacts/$artifactId")({
  component: ArtifactRoute,
});

type StudioSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { message: string; status: "error" }
  | { projectUrl: string; status: "ready" };

function ArtifactRoute() {
  const { artifactId } = Route.useParams();
  const [state, setState] = useState<ArtifactViewState>({
    status: "loading",
  });
  const [saveState, setSaveState] = useState<StudioSaveState>({
    status: "idle",
  });
  const urls = useMemo(() => artifactRouteUrls(artifactId), [artifactId]);
  const saveToStudio = useCallback(() => {
    setSaveState({ status: "saving" });
    void createStudioProjectFromArtifact(artifactId)
      .then((created) => {
        setSaveState({
          projectUrl: created.urls.project,
          status: "ready",
        });
      })
      .catch((caught) => {
        setSaveState({
          message:
            caught instanceof Error
              ? caught.message
              : "Artifact could not be saved to Studio.",
          status: "error",
        });
      });
  }, [artifactId]);

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    void fetchArtifactScene(artifactId)
      .then((scene) => {
        if (!cancelled) {
          setState({
            scene,
            status: "ready",
          });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setState({
            message:
              caught instanceof Error
                ? caught.message
                : "Artifact could not be loaded.",
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  useEffect(() => {
    setSaveState({ status: "idle" });
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
          {saveState.status === "ready" ? (
            <a className="studio__artifact-link" href={saveState.projectUrl}>
              Open project
            </a>
          ) : (
            <button
              className="studio__artifact-link"
              disabled={saveState.status === "saving"}
              onClick={saveToStudio}
              type="button"
            >
              {saveState.status === "saving" ? "Saving..." : "Save to Studio"}
            </button>
          )}
          <a className="studio__artifact-link" href={urls.edit}>
            Edit
          </a>
          <a className="studio__artifact-link" href={urls.scene}>
            Scene file
          </a>
          <a className="studio__artifact-link" href={urls.drawing}>
            Drawing file
          </a>
        </div>
      </header>

      <section className="artifact-view__stage">
        {saveState.status === "error" ? (
          <p className="artifact-view__message artifact-view__message--error">
            {saveState.message}
          </p>
        ) : null}
        {state.status === "loading" ? (
          <p className="artifact-view__message">Loading artifact...</p>
        ) : null}
        {state.status === "error" ? (
          <p className="artifact-view__message artifact-view__message--error">
            {state.message}
          </p>
        ) : null}
        {state.status === "ready" ? (
          <ArtifactCanvas scene={state.scene} />
        ) : null}
      </section>
    </main>
  );
}
