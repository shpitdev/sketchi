import {
  convertSceneToExcalidraw,
  createExcalidrawFile,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchArtifactScene } from "@/features/artifacts/artifact-view-client";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { StudioBrand } from "@/components/studio-brand";
import {
  fetchStudioDiagramDetails,
  type StudioDiagramSummary,
  type StudioProjectSummary,
} from "@sketchi/studio-projects/client";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";

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

function editedDrawingDownloadUrl(scene: ExcalidrawScene): string {
  const file = createExcalidrawFile(scene, {
    source: window.location.origin,
  });

  return URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], {
      type: "application/vnd.excalidraw+json",
    }),
  );
}

function drawingChangeSignature(scene: ExcalidrawScene): string {
  return JSON.stringify({
    appState: {
      viewBackgroundColor: scene.appState.viewBackgroundColor,
    },
    elements: scene.elements.map((element) => {
      const signatureElement = { ...element };
      const hasDerivedSize =
        element.type === "arrow" || element.type === "line";
      delete signatureElement.lastCommittedPoint;

      if (hasDerivedSize) {
        delete signatureElement.height;
        delete signatureElement.width;
      }

      signatureElement.boundElements = Array.isArray(element.boundElements)
        ? element.boundElements
        : [];

      return signatureElement;
    }),
  });
}

function DiagramEditRoute() {
  const { diagramId } = Route.useParams();
  const [editedScene, setEditedScene] = useState<ExcalidrawScene | null>(null);
  const [state, setState] = useState<DiagramEditState>({ status: "loading" });
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const initialDrawingSignature = useMemo(
    () =>
      state.status === "ready"
        ? drawingChangeSignature(convertSceneToExcalidraw(state.scene))
        : null,
    [state],
  );
  const handleSceneChange = useCallback(
    (scene: ExcalidrawScene) => {
      if (drawingChangeSignature(scene) === initialDrawingSignature) {
        setEditedScene(null);
        return;
      }

      setEditedScene(scene);
    },
    [initialDrawingSignature],
  );

  useEffect(() => {
    let cancelled = false;

    setEditedScene(null);
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

  useEffect(() => {
    if (!editedScene) {
      setDownloadUrl(null);
      return;
    }

    const url = editedDrawingDownloadUrl(editedScene);
    setDownloadUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [editedScene]);

  return (
    <main className="artifact-view artifact-view--edit">
      <header className="artifact-view__bar">
        <StudioBrand />
        <div className="artifact-view__actions">
          {state.status === "ready" ? (
            <a
              className="studio__artifact-link"
              href={`/diagrams/${state.diagram.id}`}
            >
              Review
            </a>
          ) : null}
          {state.status === "ready" ? (
            <a
              className="studio__artifact-link"
              href={`/projects/${state.project.id}`}
            >
              Project
            </a>
          ) : null}
          <IconActionBar>
            <IconLink
              download={
                downloadUrl && state.status === "ready"
                  ? `${state.diagram.id}.excalidraw`
                  : undefined
              }
              href={
                downloadUrl ??
                (state.status === "ready"
                  ? `/api/v1/artifacts/${encodeURIComponent(
                      state.diagram.artifactId,
                    )}?format=excalidraw&raw=true`
                  : "#")
              }
              icon="download"
              label={downloadUrl ? "Download changes" : "Drawing file"}
              tone={downloadUrl ? "primary" : "default"}
            />
          </IconActionBar>
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
          <ArtifactCanvas
            mode="edit"
            onSceneChange={handleSceneChange}
            scene={state.scene}
          />
        ) : null}
      </section>
    </main>
  );
}
