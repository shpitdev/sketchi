import {
  flowchartDiagramFromSpec,
  type FlowchartSpec,
} from "@sketchi/diagram-agent";
import { SKETCHI_DIAGRAM_STYLE } from "@sketchi/diagram-core";
import {
  type ArrowSceneElement,
  renderIntermediateDiagram,
} from "@sketchi/diagram-renderer";

export const DEPLOY_PIPELINE_SPEC = {
  title: "Deploy pipeline",
  layout: { direction: "LR" },
  style: { ...SKETCHI_DIAGRAM_STYLE },
  nodes: [
    { id: "push", label: "GitHub push", kind: "start" },
    { id: "build", label: "Docker build", kind: "process" },
    { id: "tests", label: "Run tests", kind: "process" },
    { id: "deploy", label: "Cloudflare ship", kind: "end" },
  ],
  edges: [
    { source: "push", target: "build" },
    { source: "build", target: "tests" },
    { source: "tests", target: "deploy", label: "pass" },
  ],
} satisfies FlowchartSpec;

const generatedDeployPipelineScene = renderIntermediateDiagram(
  flowchartDiagramFromSpec(DEPLOY_PIPELINE_SPEC),
);

const SAMPLE_HORIZONTAL_SCALE = 0.5;
const SAMPLE_LABEL_MAX_WIDTH = 90;
const SAMPLE_TEXT_HORIZONTAL_PADDING = 24;
const SAMPLE_DEPLOY_NODE_MIN_WIDTH =
  SAMPLE_LABEL_MAX_WIDTH + SAMPLE_TEXT_HORIZONTAL_PADDING;
const SAMPLE_LABEL_LINES: Readonly<Record<string, string>> = {
  "Cloudflare ship": "Cloudflare\nship",
  "Docker build": "Docker\nbuild",
  "GitHub push": "GitHub\npush",
  "Run tests": "Run\ntests",
};

function compactArrowPoints(
  points: ArrowSceneElement["points"],
): ArrowSceneElement["points"] {
  const [first, ...rest] = points;

  return [
    { ...first, x: first.x * SAMPLE_HORIZONTAL_SCALE },
    ...rest.map((point) => ({
      ...point,
      x: point.x * SAMPLE_HORIZONTAL_SCALE,
    })),
  ];
}

// DiagramPreview fits the full renderer scene into this fixed-size sample card.
// Compact its horizontal coordinates and preserve readable text sizes so both
// node and edge labels survive fit-to-content without substituting hand-built
// diagram markup.
export const DEPLOY_PIPELINE_SCENE = {
  ...generatedDeployPipelineScene,
  width: generatedDeployPipelineScene.width * SAMPLE_HORIZONTAL_SCALE,
  elements: generatedDeployPipelineScene.elements.map((element) => {
    if (element.type === "arrow") {
      return {
        ...element,
        points: compactArrowPoints(element.points),
      };
    }

    if (element.type === "node") {
      const scaledWidth = element.width * SAMPLE_HORIZONTAL_SCALE;

      return {
        ...element,
        width:
          element.nodeId === "deploy"
            ? Math.max(scaledWidth, SAMPLE_DEPLOY_NODE_MIN_WIDTH)
            : scaledWidth,
        x: element.x * SAMPLE_HORIZONTAL_SCALE,
      };
    }

    if (element.type !== "text") {
      return element;
    }

    return {
      ...element,
      fontSize: 15,
      maxWidth: SAMPLE_LABEL_MAX_WIDTH,
      text: SAMPLE_LABEL_LINES[element.text] ?? element.text,
      x: element.x * SAMPLE_HORIZONTAL_SCALE,
    };
  }),
};
