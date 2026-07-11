import {
  normalizeDiagramInput,
  type DiagramToolInput,
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
  input?: DiagramToolInput;
  scene?: RenderedDiagramScene;
  title: string;
}

/**
 * Curated, read-only diagrams that the docs link to. They're authored as real
 * `create_diagram` inputs and rendered through the same pipeline as a live
 * generation, so "how it works" is shown with an actual Sketchi diagram — one
 * you can pan and zoom but not overwrite (view mode).
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
    input: {
      title: "How Sketchi works",
      direction: "TB",
      nodes: [
        { id: "describe", label: "You describe a diagram", kind: "start" },
        { id: "where", label: "Where are you working?", kind: "decision" },
        { id: "playground", label: "Playground draws it", kind: "process" },
        {
          id: "playground-state",
          label: "Shareable link, no account",
          kind: "data",
        },
        { id: "agent", label: "Your agent calls Sketchi", kind: "process" },
        {
          id: "agent-state",
          label: "Your machine keeps the file",
          kind: "external",
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
        (example.input
          ? renderIntermediateDiagram(normalizeDiagramInput(example.input))
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
