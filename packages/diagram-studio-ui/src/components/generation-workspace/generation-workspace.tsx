import { type UseHotkeyDefinition, useHotkeys } from "@tanstack/react-hotkeys";
import { useCallback, useMemo, useState } from "react";
import { DiagramCatalog, type DiagramCatalogItem } from "../diagram-catalog";
import { DiagramPreview } from "../diagram-preview";
import { DiagramSummaryPanel } from "../diagram-summary-panel";

export interface GenerationWorkspaceProps {
  diagrams: DiagramCatalogItem[];
  initialSelectedDiagramId?: string | undefined;
  onSelectedDiagramChange?: ((id: string) => void) | undefined;
  selectedDiagramId?: string | undefined;
  status?: "idle" | "validating" | "rendered" | "error";
}

export function GenerationWorkspace({
  diagrams,
  initialSelectedDiagramId,
  onSelectedDiagramChange,
  selectedDiagramId,
  status = "rendered",
}: GenerationWorkspaceProps) {
  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState(
    initialSelectedDiagramId ?? diagrams[0]?.id
  );
  const resolvedSelectedId = selectedDiagramId ?? uncontrolledSelectedId;
  const selectedIndex = Math.max(
    0,
    diagrams.findIndex((diagram) => diagram.id === resolvedSelectedId)
  );
  const selectedDiagram = diagrams[selectedIndex] ?? diagrams[0];

  const selectDiagram = useCallback(
    (id: string) => {
      if (selectedDiagramId === undefined) {
        setUncontrolledSelectedId(id);
      }
      onSelectedDiagramChange?.(id);
    },
    [onSelectedDiagramChange, selectedDiagramId]
  );

  const selectRelativeDiagram = useCallback(
    (offset: number) => {
      const nextIndex =
        (selectedIndex + offset + diagrams.length) % diagrams.length;
      const nextDiagram = diagrams[nextIndex];

      if (nextDiagram) {
        selectDiagram(nextDiagram.id);
      }
    },
    [diagrams, selectDiagram, selectedIndex]
  );

  const navigationHotkeys = useMemo<UseHotkeyDefinition[]>(
    () => [
      { callback: () => selectRelativeDiagram(-1), hotkey: "ArrowLeft" },
      { callback: () => selectRelativeDiagram(-1), hotkey: "ArrowUp" },
      { callback: () => selectRelativeDiagram(-1), hotkey: "K" },
      { callback: () => selectRelativeDiagram(1), hotkey: "ArrowRight" },
      { callback: () => selectRelativeDiagram(1), hotkey: "ArrowDown" },
      { callback: () => selectRelativeDiagram(1), hotkey: "J" },
    ],
    [selectRelativeDiagram]
  );

  useHotkeys(navigationHotkeys, {
    enabled: Boolean(selectedDiagram) && diagrams.length > 1,
    ignoreInputs: true,
    preventDefault: true,
  });

  if (!selectedDiagram) {
    return (
      <main className="sketchi-workspace" data-empty="true">
        <section className="sketchi-workspace__panel">
          <h1>Sketchi v2</h1>
        </section>
      </main>
    );
  }

  return (
    <main
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown j k"
      className="sketchi-workspace"
    >
      <section className="sketchi-workspace__panel">
        <DiagramSummaryPanel
          diagram={selectedDiagram.diagram}
          prompt={selectedDiagram.prompt}
          status={status}
        />
        <DiagramCatalog
          items={diagrams}
          onSelect={selectDiagram}
          selectedId={selectedDiagram.id}
        />
      </section>
      <section className="sketchi-workspace__canvas">
        <DiagramPreview diagram={selectedDiagram.diagram} />
      </section>
    </main>
  );
}
