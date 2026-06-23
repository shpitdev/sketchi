import { describe, expect, it } from "vitest";

import {
  flowchartFixture,
  pharmaBatchDispositionFlowchart,
} from "@sketchi/diagram-core";

import { renderIntermediateDiagram } from "./scene";

describe("renderIntermediateDiagram", () => {
  it("creates node, label, and edge scene elements", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    expect(
      scene.elements.filter((element) => element.type === "node"),
    ).toHaveLength(flowchartFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "text"),
    ).toHaveLength(flowchartFixture.nodes.length);
    expect(
      scene.elements.filter((element) => element.type === "arrow"),
    ).toHaveLength(flowchartFixture.edges.length);
  });

  it("renders deterministically for the same input", () => {
    expect(renderIntermediateDiagram(flowchartFixture)).toEqual(
      renderIntermediateDiagram(flowchartFixture),
    );
  });

  it("maps flowchart kinds to real scene shapes", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);

    expect(
      scene.elements.find(
        (element) => element.type === "node" && element.nodeId === "prompt",
      ),
    ).toMatchObject({ shape: "ellipse" });
    expect(
      scene.elements.find(
        (element) => element.type === "node" && element.nodeId === "clear",
      ),
    ).toMatchObject({ shape: "diamond" });
  });

  it("wraps long labels into larger node boxes before real export", () => {
    const scene = renderIntermediateDiagram(pharmaBatchDispositionFlowchart);
    const qaReviewNode = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "qa-review",
    );

    expect(qaReviewNode).toMatchObject({
      type: "node",
      label: expect.stringContaining("\n"),
    });
    if (!qaReviewNode || qaReviewNode.type !== "node") {
      throw new Error("Expected qa-review to render as a node scene element.");
    }
    expect(qaReviewNode.height).toBeGreaterThan(72);
  });

  it("spreads decision branches into separate rank positions", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);
    const clear = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "clear",
    );
    const draft = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "draft",
    );
    const review = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "review",
    );

    if (
      !clear ||
      clear.type !== "node" ||
      !draft ||
      draft.type !== "node" ||
      !review ||
      review.type !== "node"
    ) {
      throw new Error("Expected onboarding nodes to render as scene nodes.");
    }

    expect(draft.y).toBeGreaterThan(clear.y);
    expect(review.y).toBeGreaterThan(draft.y);
    expect(draft.x).toBe(clear.x);
  });

  it("routes offset decision branches with orthogonal points", () => {
    const scene = renderIntermediateDiagram(flowchartFixture);
    const clearDraft = scene.elements.find(
      (element) => element.type === "arrow" && element.edgeId === "clear-draft",
    );
    const clearReview = scene.elements.find(
      (element) =>
        element.type === "arrow" && element.edgeId === "clear-review",
    );

    expect(clearDraft).toMatchObject({ type: "arrow" });
    expect(clearReview).toMatchObject({ type: "arrow" });

    if (!clearDraft || clearDraft.type !== "arrow") {
      throw new Error("Expected clear-draft to render as an arrow.");
    }
    if (!clearReview || clearReview.type !== "arrow") {
      throw new Error("Expected clear-review to render as an arrow.");
    }

    expect(clearDraft.points.length).toBeGreaterThan(2);
    expect(clearReview.points.length).toBeGreaterThan(2);
    expect(clearDraft.points[0].x).toBeLessThan(clearReview.points[0].x);
    expect(clearDraft.points[0].y).toBe(clearReview.points[0].y);
  });
});
