import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  artifactRouteUrls,
  fetchArtifactScene,
  type ArtifactViewState,
} from "@/features/artifacts/artifact-view-client";
import { EditableArtifactStage } from "@/features/artifacts/editable-artifact-stage";

export const Route = createFileRoute("/artifacts_/$artifactId/edit")({
  component: ArtifactEditRoute,
});

function ArtifactEditRoute() {
  const { artifactId } = Route.useParams();
  const [state, setState] = useState<ArtifactViewState>({ status: "loading" });
  const urls = artifactRouteUrls(artifactId);

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    void fetchArtifactScene(artifactId)
      .then((scene) => {
        if (!cancelled) {
          setState({ scene, status: "ready" });
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
    <EditableArtifactStage
      artifactId={artifactId}
      downloadName={artifactId}
      headerLinks={
        <a className="studio__artifact-link" href={urls.review}>
          Review
        </a>
      }
      loadingMessage="Loading artifact..."
      showSceneFile
      state={state}
    />
  );
}
