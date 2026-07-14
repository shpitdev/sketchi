import { describe, expect, it } from "vitest";

import { parseFlowchartDiagram } from "@sketchi/diagram-core";

import { assessFlowchartQuality } from "./flowchart-quality";

function decisionLoopFlowchart() {
  return parseFlowchartDiagram({
    id: "review-loop",
    title: "Release review loop",
    type: "flowchart",
    nodes: [
      { id: "start", kind: "start", label: "Open release" },
      { id: "review", kind: "decision", label: "Release ready?" },
      { id: "publish", kind: "process", label: "Publish release" },
      { id: "revise", kind: "process", label: "Revise release" },
      { id: "done", kind: "end", label: "Release live" },
    ],
    edges: [
      { id: "open-review", source: "start", target: "review" },
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
    layout: { direction: "TB", edgeRouting: "orthogonal" },
    style: { accentColor: "#8f707f", backgroundColor: "#fffdf8" },
  });
}

describe("assessFlowchartQuality", () => {
  it("accepts a specific canonical decision flow with a terminating loop", () => {
    const quality = assessFlowchartQuality(decisionLoopFlowchart(), 8);

    expect(quality).toMatchObject({
      accepted: true,
      score: 10,
      summary: { edgeCount: 5, nodeCount: 5 },
      threshold: 8,
    });
    expect(quality.checks).toEqual([]);
  });

  it("returns deterministic canonical checks for weak labels", () => {
    const diagram = decisionLoopFlowchart();
    const publish = diagram.nodes[2];
    if (!publish) {
      throw new Error("Expected the release flow to contain a publish node.");
    }
    diagram.nodes[2] = { ...publish, label: "Step 2" };

    const first = assessFlowchartQuality(diagram, 8);
    const second = assessFlowchartQuality(diagram, 8);

    expect(second).toEqual(first);
    expect(first.accepted).toBe(true);
    expect(first.checks).toEqual([
      expect.objectContaining({
        code: "generic_label",
        message: expect.stringContaining("Step 2"),
        severity: "warning",
      }),
    ]);
  });
});
