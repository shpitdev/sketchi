import {
  flowchartFixture,
  type IntermediateDiagram,
  mindmapFixture,
  pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { useEffect, useMemo, useState } from "react";

import { DiagramInspector } from "../diagram-inspector/index.js";
import {
  type DiagramOption,
  DiagramSwitcher,
} from "../diagram-switcher/index.js";
import {
  WorkspaceTopBar,
  type WorkspaceStatus,
} from "../workspace-top-bar/index.js";

const defaultDiagrams: readonly IntermediateDiagram[] = [
  pharmaBatchDispositionFlowchart,
  flowchartFixture,
  mindmapFixture,
];

type CopyState = "copied" | "error" | "idle";

export interface ExcalidrawWorkspaceProps {
  diagrams?: readonly IntermediateDiagram[];
  errorMessage?: string;
  initialDiagramId?: string;
  status?: WorkspaceStatus;
}

export function ExcalidrawWorkspace({
  diagrams = defaultDiagrams,
  errorMessage,
  initialDiagramId,
  status = "ready",
}: ExcalidrawWorkspaceProps) {
  const [selectedId, setSelectedId] = useState(
    initialDiagramId ?? diagrams[0]?.id ?? "",
  );
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const active = diagrams.find((item) => item.id === selectedId) ?? diagrams[0];

  const scene = useMemo(
    () =>
      active
        ? convertSceneToExcalidraw(renderIntermediateDiagram(active))
        : null,
    [active],
  );

  const options: DiagramOption[] = diagrams.map((item) => ({
    edgeCount: item.edges.length,
    id: item.id,
    nodeCount: item.nodes.length,
    title: item.title,
    type: item.type,
  }));

  const effectiveStatus: WorkspaceStatus =
    diagrams.length === 0 ? "empty" : status;

  const irJson = useMemo(
    () => (active ? JSON.stringify(active, null, 2) : ""),
    [active],
  );

  const sceneJson = useMemo(
    () => (scene ? JSON.stringify(scene, null, 2) : ""),
    [scene],
  );

  const sceneDownloadHref = sceneJson
    ? `data:application/json;charset=utf-8,${encodeURIComponent(sceneJson)}`
    : undefined;

  useEffect(() => {
    setCopyState("idle");
  }, [active?.id]);

  async function copyIr() {
    if (!active) {
      return;
    }

    try {
      await navigator.clipboard.writeText(irJson);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="sketchi-excalidraw-app">
      <WorkspaceTopBar
        actions={
          active && sceneDownloadHref ? (
            <>
              <a className="workspace-action" href="#workspace-canvas">
                Canvas
              </a>
              <button
                className="workspace-action"
                onClick={copyIr}
                type="button"
              >
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "error"
                    ? "Copy failed"
                    : "Copy IR"}
              </button>
              <a
                className="workspace-action workspace-action--primary"
                download={`${active.id}.excalidraw.json`}
                href={sceneDownloadHref}
              >
                Download scene
              </a>
            </>
          ) : null
        }
        diagramType={active?.type}
        status={effectiveStatus}
        title={active?.title ?? "No diagram"}
      />

      <div className="sketchi-excalidraw-app__body">
        <aside className="sketchi-excalidraw-app__sidebar">
          {diagrams.length > 0 ? (
            <DiagramSwitcher
              activeId={active?.id ?? ""}
              diagrams={options}
              onSelect={setSelectedId}
            />
          ) : null}
          {active && scene ? (
            <DiagramInspector diagram={active} scene={scene} />
          ) : null}
        </aside>

        <section
          aria-label="Workspace canvas"
          className="sketchi-excalidraw-app__canvas"
          id="workspace-canvas"
        >
          {effectiveStatus === "loading" ? (
            <WorkspaceState kind="loading" />
          ) : effectiveStatus === "error" ? (
            <WorkspaceState kind="error" message={errorMessage} />
          ) : active && scene ? (
            <ExcalidrawSceneCanvas
              scene={scene}
              title={`${active.title} canvas`}
              viewModeEnabled={false}
              zenModeEnabled={false}
            />
          ) : (
            <WorkspaceState kind="empty" />
          )}
        </section>
      </div>
    </div>
  );
}

interface WorkspaceStateProps {
  kind: "empty" | "error" | "loading";
  message?: string | undefined;
}

const stateCopy: Record<
  WorkspaceStateProps["kind"],
  { body: string; title: string }
> = {
  empty: {
    body: "Pick a sample diagram to render a deterministic scene.",
    title: "No diagram selected",
  },
  error: {
    body: "The diagram could not be rendered into a scene.",
    title: "Scene unavailable",
  },
  loading: {
    body: "Validating the diagram and laying out the scene.",
    title: "Generating scene",
  },
};

function WorkspaceState({ kind, message }: WorkspaceStateProps) {
  const copy = stateCopy[kind];

  return (
    <div className={`workspace-state workspace-state--${kind}`} role="status">
      <span className="workspace-state__glyph" aria-hidden="true">
        {kind === "loading" ? <span className="workspace-state__spin" /> : "◇"}
      </span>
      <h2 className="workspace-state__title">{copy.title}</h2>
      <p className="workspace-state__body">{message ?? copy.body}</p>
    </div>
  );
}
