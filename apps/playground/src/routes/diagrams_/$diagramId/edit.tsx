import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  fetchStudioDiagramDetails,
  type StudioDiagramSummary,
  type StudioProjectSummary,
} from "@sketchi/studio-projects/client";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { fetchArtifactScene } from "@/features/artifacts/artifact-view-client";
import { EditableArtifactStage } from "@/features/artifacts/editable-artifact-stage";

export const Route = createFileRoute("/diagrams_/$diagramId/edit")({
  component: DiagramEditRoute,
});

type DiagramEditState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      diagram: StudioDiagramSummary;
      project: StudioProjectSummary;
      scene: RenderedDiagramScene;
      status: "ready";
    };

function DiagramEditRoute() {
  const { diagramId } = Route.useParams();
  const [state, setState] = useState<DiagramEditState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });
    void fetchStudioDiagramDetails(diagramId)
      .then(async (details) => {
        const scene = await fetchArtifactScene(details.diagram.artifactId);
        if (!cancelled) {
          setState({
            diagram: details.diagram,
            project: details.project,
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
                : "Studio diagram could not be loaded.",
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [diagramId]);

  return (
    <EditableArtifactStage
      {...(state.status === "ready"
        ? { artifactId: state.diagram.artifactId }
        : {})}
      downloadName={diagramId}
      headerLinks={
        state.status === "ready" ? (
          <>
            <a
              className="studio__artifact-link"
              href={`/diagrams/${state.diagram.id}`}
            >
              Review
            </a>
            <a
              className="studio__artifact-link"
              href={`/projects/${state.project.id}`}
            >
              Project
            </a>
          </>
        ) : null
      }
      loadingMessage="Loading diagram..."
      state={state}
    />
  );
}
