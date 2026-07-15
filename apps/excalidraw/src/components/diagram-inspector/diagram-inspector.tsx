import type { IntermediateDiagram } from "@sketchi/diagram-core";
import {
  type ExcalidrawScene,
  validateExcalidrawScene,
} from "@sketchi/diagram-excalidraw";
import { useMemo, useState } from "react";

export interface DiagramInspectorProps {
  diagram: IntermediateDiagram;
  scene: ExcalidrawScene;
}

type InspectorTab = "ir" | "overview" | "scene";

const tabs: readonly { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ir", label: "Typed IR" },
  { id: "scene", label: "Scene" },
];

export function DiagramInspector({ diagram, scene }: DiagramInspectorProps) {
  const [active, setActive] = useState<InspectorTab>("overview");

  const elementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const element of scene.elements) {
      counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scene]);

  const validation = useMemo(() => validateExcalidrawScene(scene), [scene]);

  return (
    <section className="diagram-inspector" aria-label="Diagram inspector">
      <div
        className="diagram-inspector__tabs"
        role="tablist"
        aria-label="Inspect diagram"
      >
        {tabs.map((tab) => (
          <button
            aria-selected={active === tab.id}
            className="diagram-inspector__tab"
            id={`inspector-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActive(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="diagram-inspector__panel" role="tabpanel">
        {active === "overview" ? (
          <dl className="diagram-inspector__defs">
            <div>
              <dt>Type</dt>
              <dd>{diagram.type}</dd>
            </div>
            <div>
              <dt>Direction</dt>
              <dd>{diagram.layout.direction}</dd>
            </div>
            <div>
              <dt>Edge routing</dt>
              <dd>{diagram.layout.edgeRouting}</dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{diagram.nodes.length}</dd>
            </div>
            <div>
              <dt>Edges</dt>
              <dd>{diagram.edges.length}</dd>
            </div>
            <div>
              <dt>Accent</dt>
              <dd className="diagram-inspector__swatch-row">
                <span
                  className="diagram-inspector__swatch"
                  style={{ background: diagram.style.accentColor }}
                />
                {diagram.style.accentColor}
              </dd>
            </div>
          </dl>
        ) : null}

        {active === "ir" ? (
          <pre className="diagram-inspector__code">
            {JSON.stringify(diagram, null, 2)}
          </pre>
        ) : null}

        {active === "scene" ? (
          <div className="diagram-inspector__scene">
            <p
              className={`diagram-inspector__validity ${
                validation.ok
                  ? "diagram-inspector__validity--ok"
                  : "diagram-inspector__validity--warn"
              }`}
            >
              {validation.ok
                ? "Scene validated · no issues"
                : `${validation.issues.length} validation issue${
                    validation.issues.length === 1 ? "" : "s"
                  }`}
            </p>
            <p className="diagram-inspector__scene-total">
              {scene.elements.length} Excalidraw elements
            </p>
            <dl className="diagram-inspector__defs">
              {elementCounts.map(([type, count]) => (
                <div key={type}>
                  <dt>{type}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}
