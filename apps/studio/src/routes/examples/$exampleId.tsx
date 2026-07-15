import {
  flowchartDiagramFromSpec,
  type FlowchartSpec,
} from "@sketchi/diagram-agent";
import { mindmapFixture } from "@sketchi/diagram-core";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { ArtifactCanvas } from "@sketchi/diagram-studio-ui";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { SKETCHI_WEB_HOME_URL } from "@/lib/home-url";

export const Route = createFileRoute("/examples/$exampleId")({
  component: ExampleRoute,
});

interface CuratedExample {
  blurb: string;
  scene?: RenderedDiagramScene;
  spec?: FlowchartSpec;
  title: string;
}

/**
 * Curated, read-only diagrams that the docs link to. They're authored as real
 * canonical FlowchartSpec values and rendered from the same normalized core
 * diagram used by buildFlowchart, so "how it works" stays contract-accurate
 * without persisting a new artifact for every page view.
 */
const EXAMPLES: Record<string, CuratedExample> = {
  "public-mindmap": {
    title: "Public mindmap generation",
    blurb:
      "Generated from a semantic nested topic hierarchy — pan and zoom to inspect it.",
    scene: renderIntermediateDiagram(mindmapFixture),
  },
  "how-it-works": {
    title: "How Sketchi works",
    blurb: "Read-only — pan and zoom, but nothing you change is saved.",
    spec: {
      title: "How Sketchi works",
      layout: { direction: "TB" },
      style: {
        accentColor: "#8f707f",
        backgroundColor: "#fffdf8",
      },
      nodes: [
        { id: "describe", label: "You describe a diagram", kind: "start" },
        { id: "where", label: "Where are you working?", kind: "decision" },
        { id: "playground", label: "Playground draws it", kind: "process" },
        {
          id: "playground-state",
          label: "Shareable link, no account",
          kind: "process",
        },
        { id: "agent", label: "Your agent calls Sketchi", kind: "process" },
        {
          id: "agent-state",
          label: "Your machine keeps the file",
          kind: "process",
        },
        { id: "result", label: "A real, editable diagram", kind: "end" },
      ],
      edges: [
        { source: "describe", target: "where" },
        { source: "where", target: "playground", label: "in the app" },
        { source: "playground", target: "playground-state" },
        { source: "where", target: "agent", label: "in your agent" },
        { source: "agent", target: "agent-state" },
        { source: "playground-state", target: "result" },
        { source: "agent-state", target: "result" },
      ],
    },
  },
};

function useCuratedScene(
  example: CuratedExample | undefined,
): RenderedDiagramScene | null {
  return useMemo(() => {
    if (!example) {
      return null;
    }
    try {
      return (
        example.scene ??
        (example.spec
          ? renderIntermediateDiagram(flowchartDiagramFromSpec(example.spec))
          : null)
      );
    } catch {
      return null;
    }
  }, [example]);
}

function ExampleRoute() {
  const { exampleId } = Route.useParams();
  const example = EXAMPLES[exampleId];
  const scene = useCuratedScene(example);

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
          {example && scene ? (
            <span className="studio__note">{example.blurb}</span>
          ) : null}
          <a className="studio__artifact-link" href="/">
            Playground
          </a>
        </div>
      </header>

      <section className="artifact-view__stage">
        {example && scene ? (
          <ArtifactCanvas mode="view" scene={scene} title={example.title} />
        ) : (
          <p className="artifact-view__message artifact-view__message--error">
            That example doesn&rsquo;t exist.
          </p>
        )}
      </section>
    </main>
  );
}
