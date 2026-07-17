import {
  convertSceneToExcalidraw,
  createExcalidrawFile,
  type ExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { ArtifactCanvas } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  artifactRouteUrls,
  fetchArtifactScene,
  type ArtifactViewState,
} from "@/lib/artifact-view-client";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { SKETCHI_WEB_HOME_URL } from "@/lib/home-url";

export const Route = createFileRoute("/artifacts_/$artifactId/edit")({
  component: ArtifactEditRoute,
});

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

function ArtifactEditRoute() {
  const { artifactId } = Route.useParams();
  const [editedScene, setEditedScene] = useState<ExcalidrawScene | null>(null);
  const [state, setState] = useState<ArtifactViewState>({
    status: "loading",
  });
  const urls = useMemo(() => artifactRouteUrls(artifactId), [artifactId]);
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
        <a
          aria-label="Sketchi home"
          className="studio__mark artifact-view__mark"
          href={SKETCHI_WEB_HOME_URL}
        >
          sketchi
        </a>
        <div className="artifact-view__actions">
          <a className="studio__artifact-link" href={urls.review}>
            Review
          </a>
          <IconActionBar>
            <IconLink href={urls.scene} icon="scene" label="Scene file" />
            <IconLink
              download={downloadUrl ? `${artifactId}.excalidraw` : undefined}
              href={downloadUrl ?? urls.drawing}
              icon="download"
              label={downloadUrl ? "Download changes" : "Drawing file"}
              tone={downloadUrl ? "primary" : "default"}
            />
          </IconActionBar>
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
