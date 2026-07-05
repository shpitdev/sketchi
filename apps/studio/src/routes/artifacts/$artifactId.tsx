import { ArtifactCanvas } from "@sketchi/diagram-studio-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  artifactRouteUrls,
  fetchArtifactScene,
  type ArtifactViewState,
} from "@/lib/artifact-view-client";

export const Route = createFileRoute("/artifacts/$artifactId")({
  component: ArtifactRoute,
});

function ArtifactRoute() {
  const { artifactId } = Route.useParams();
  const [state, setState] = useState<ArtifactViewState>({
    status: "loading",
  });
  const urls = useMemo(() => artifactRouteUrls(artifactId), [artifactId]);

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
