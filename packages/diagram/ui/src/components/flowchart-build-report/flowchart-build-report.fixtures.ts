import type {
  ArtifactBundle,
  BuildFlowchartResult,
  FlowchartSpecEdge,
  FlowchartSpecNode,
  NormalizedFlowchartSpec,
  QualityReport,
} from "@sketchi/diagram-agent";

const style = { accentColor: "#8f707f", backgroundColor: "#fffdf8" };

function artifact(diagramId: string): ArtifactBundle {
  return {
    artifactId: `artifact_${diagramId}`,
    diagramId,
    formats: [
      {
        format: "scene",
        mimeType: "application/vnd.sketchi.scene+json",
        sizeBytes: 4_096,
        url: `/api/v1/artifacts/artifact_${diagramId}?format=scene&raw=true`,
      },
      {
        format: "excalidraw",
        mimeType: "application/vnd.excalidraw+json",
        sizeBytes: 8_192,
        url: `/api/v1/artifacts/artifact_${diagramId}?format=excalidraw&raw=true`,
      },
    ],
  };
}

function quality(nodeCount: number, edgeCount: number): QualityReport {
  return {
    accepted: true,
    checks: [],
    score: 10,
    summary: { edgeCount, nodeCount },
    threshold: 8,
  };
}

const decisionLoopSpec: NormalizedFlowchartSpec = {
  id: "release-review-loop",
  title: "Release review loop",
  nodes: [
    { id: "start", kind: "start", label: "Open release" },
    { id: "review", kind: "decision", label: "Release ready?" },
    { id: "publish", kind: "process", label: "Publish release" },
    { id: "revise", kind: "process", label: "Revise release" },
    { id: "done", kind: "end", label: "Release live" },
  ],
  edges: [
    { id: "start-review", source: "start", target: "review" },
    {
      id: "review-publish",
      label: "yes",
      source: "review",
      target: "publish",
    },
    {
      id: "review-revise",
      label: "no",
      source: "review",
      target: "revise",
    },
    { id: "revise-review", source: "revise", target: "review" },
    { id: "publish-done", source: "publish", target: "done" },
  ],
  layout: { direction: "TB" },
  style,
};

export const acceptedFlowchartBuild = {
  ok: true,
  status: "accepted",
  buildId: "build_release",
  normalizedSpec: decisionLoopSpec,
  quality: quality(5, 5),
  artifact: artifact(decisionLoopSpec.id),
  issues: [],
} satisfies BuildFlowchartResult;

export const rejectedFlowchartBuild = {
  ok: false,
  status: "invalid_flowchart",
  buildId: "build_repair",
  normalizedSpec: {
    ...decisionLoopSpec,
    edges: decisionLoopSpec.edges.filter((edge) => edge.id !== "review-revise"),
  },
  issues: [
    {
      code: "underbranched_decision",
      severity: "error",
      stage: "flowchart",
      ref: { kind: "node", id: "review", path: "spec.nodes[1]" },
      message: "Decision review must have at least two outgoing branches.",
      hint: "Add another labeled branch from this decision.",
    },
  ],
} satisfies BuildFlowchartResult;

const denseNodes: FlowchartSpecNode[] = Array.from(
  { length: 24 },
  (_, index) => ({
    id: `step-${index + 1}`,
    kind: index === 0 ? "start" : index === 23 ? "end" : "process",
    label:
      index === 0
        ? "Start intake"
        : index === 23
          ? "Finish intake"
          : `Process intake ${index}`,
  }),
);
const denseEdges: Array<FlowchartSpecEdge & { id: string }> = Array.from(
  { length: 23 },
  (_, index) => ({
    id: `edge-${index + 1}`,
    source: `step-${index + 1}`,
    target: `step-${index + 2}`,
  }),
);
const denseSpec: NormalizedFlowchartSpec = {
  id: "dense-intake",
  title: "Dense intake process",
  nodes: denseNodes,
  edges: denseEdges,
  layout: { direction: "LR" },
  style,
};

export const denseFlowchartBuild = {
  ok: true,
  status: "accepted",
  buildId: "build_dense",
  normalizedSpec: denseSpec,
  quality: quality(24, 23),
  artifact: artifact(denseSpec.id),
  issues: [],
} satisfies BuildFlowchartResult;

export const decisionLoopFlowchartBuild = acceptedFlowchartBuild;
