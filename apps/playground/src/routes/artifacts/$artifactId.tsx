import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  artifactRouteUrls,
  fetchArtifactReview,
  type ArtifactViewState,
} from "@/lib/artifact-view-client";
import { ArtifactSourceLink } from "@/components/artifact-source-link";
import { createStudioProjectFromArtifact } from "@sketchi/studio-projects/client";
import { IconActionBar, IconButton, IconLink } from "@/components/sketch-icons";
import { SKETCHI_WEB_HOME_URL } from "@/lib/home-url";

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
    void fetchArtifactReview(artifactId)
      .then((artifact) => {
        if (!cancelled) {
          setState({
            ...artifact,
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
        <a
          aria-label="Sketchi home"
          className="studio__mark artifact-view__mark"
          href={SKETCHI_WEB_HOME_URL}
        >
          sketchi
        </a>
        <div className="artifact-view__actions">
          <a className="studio__artifact-link" href="/">
            Playground
          </a>
          <IconActionBar>
            {state.status === "ready" && state.provenance ? (
              <ArtifactSourceLink provenance={state.provenance} />
            ) : null}
            {saveState.status === "ready" ? (
              <IconLink
                href={saveState.projectUrl}
                icon="project"
                label="Open project"
                tone="primary"
              />
            ) : (
              <IconButton
                disabled={saveState.status === "saving"}
                icon="save"
                label={
                  saveState.status === "saving" ? "Saving…" : "Save to Studio"
                }
                onClick={saveToStudio}
                tone="primary"
              />
            )}
            <IconLink href={urls.edit} icon="edit" label="Edit" />
            <IconLink href={urls.scene} icon="scene" label="Scene file" />
            <IconLink href={urls.drawing} icon="drawing" label="Drawing file" />
          </IconActionBar>
          {saveState.status === "ready" ? (
            <span className="studio__note">
              Saved to this browser · no account yet
            </span>
          ) : null}
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
