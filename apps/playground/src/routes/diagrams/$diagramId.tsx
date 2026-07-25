import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { fetchArtifactScene } from "@/features/artifacts/artifact-view-client";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioBrand } from "@/components/studio-brand";
import {
  fetchStudioDiagramDetails,
  type StudioDiagramSummary,
  type StudioProjectSummary,
} from "@sketchi/studio-projects/client";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

export const Route = createFileRoute("/diagrams/$diagramId")({
  component: DiagramRoute,
});

type DiagramState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      diagram: StudioDiagramSummary;
      project: StudioProjectSummary;
      scene: RenderedDiagramScene;
      status: "ready";
    };

function DiagramRoute() {
  const { diagramId } = Route.useParams();
  const [state, setState] = useState<DiagramState>({ status: "loading" });

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
    <main className="artifact-view">
      <header className="artifact-view__bar">
        <StudioBrand />
        <div className="artifact-view__actions">
          {state.status === "ready" ? (
            <a
              className="studio__artifact-link"
              href={`/projects/${state.project.id}`}
            >
              Project
            </a>
          ) : null}
          <a className="studio__artifact-link" href="/projects">
            Projects
          </a>
          {state.status === "ready" ? (
            <IconActionBar>
              <IconLink href={state.diagram.editUrl} icon="edit" label="Edit" />
            </IconActionBar>
          ) : null}
        </div>
      </header>

      <section className="artifact-view__stage">
        {state.status === "loading" ? (
          <p className="artifact-view__message">Loading diagram...</p>
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
