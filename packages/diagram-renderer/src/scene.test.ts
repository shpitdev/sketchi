import { describe, expect, it } from "vitest";

import {
  flowchartFixture,
  pharmaBatchDispositionFlowchart,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";

import { renderIntermediateDiagram } from "./scene";

interface TestRouteSegment {
  max: number;
  min: number;
  orientation: "horizontal" | "vertical";
  staticCoordinate: number;
}

interface TestScenePoint {
  x: number;
  y: number;
}

function testRouteSegments(
  points: readonly TestScenePoint[],
): TestRouteSegment[] {
  const segments: TestRouteSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    if (!start || !end) {
      continue;
    }

    if (start.y === end.y) {
      segments.push({
        max: Math.max(start.x, end.x),
        min: Math.min(start.x, end.x),
        orientation: "horizontal",
        staticCoordinate: start.y,
      });
      continue;
    }

    if (start.x === end.x) {
      segments.push({
        max: Math.max(start.y, end.y),
        min: Math.min(start.y, end.y),
        orientation: "vertical",
        staticCoordinate: start.x,
      });
    }
  }

  return segments.filter((segment) => segment.max - segment.min > 0.01);
}

function testRouteSegmentOverlapLength(
  left: TestRouteSegment,
  right: TestRouteSegment,
) {
  return Math.min(left.max, right.max) - Math.max(left.min, right.min);
}

function testRouteOverlapCount(
  leftPoints: readonly TestScenePoint[],
  rightPoints: readonly TestScenePoint[],
) {
  let overlapCount = 0;

  for (const left of testRouteSegments(leftPoints)) {
    for (const right of testRouteSegments(rightPoints)) {
      if (
        left.orientation === right.orientation &&
        Math.abs(left.staticCoordinate - right.staticCoordinate) <= 0.01 &&
        testRouteSegmentOverlapLength(left, right) > 0.01
      ) {
        overlapCount += 1;
      }
    }
  }

  return overlapCount;
}

function testRouteSelfOverlapCount(points: readonly TestScenePoint[]) {
  const segments = testRouteSegments(points);
  let overlapCount = 0;

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];

    if (!left) {
      continue;
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex];

      if (
        right &&
        left.orientation === right.orientation &&
        Math.abs(left.staticCoordinate - right.staticCoordinate) <= 0.01 &&
        testRouteSegmentOverlapLength(left, right) > 0.01
      ) {
        overlapCount += 1;
      }
    }
  }

  return overlapCount;
}

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

  it("keeps upward return edges on the closest vertical ports", () => {
    const scene = renderIntermediateDiagram(
      parseFlowchartDiagram({
        id: "procurement-vendor-approval",
        title: "Procurement vendor approval",
        type: "flowchart",
        nodes: [
          { id: "need-identified", label: "Need identified", kind: "start" },
          { id: "collect-quotes", label: "Collect quotes", kind: "process" },
          {
            id: "preferred-vendor",
            label: "Preferred vendor?",
            kind: "decision",
          },
          { id: "competitive-bid", label: "Competitive bid", kind: "process" },
          { id: "risk-assessment", label: "Risk assessment", kind: "process" },
          {
            id: "risk-acceptable",
            label: "Risk acceptable?",
            kind: "decision",
          },
          { id: "legal-review", label: "Legal review", kind: "process" },
          {
            id: "legal-approved",
            label: "Legal approved?",
            kind: "decision",
          },
          {
            id: "renegotiate-terms",
            label: "Renegotiate terms",
            kind: "process",
          },
          { id: "create-contract", label: "Create contract", kind: "end" },
          { id: "reject-vendor", label: "Reject vendor", kind: "end" },
        ],
        edges: [
          {
            id: "edge-1",
            source: "need-identified",
            target: "collect-quotes",
          },
          {
            id: "edge-2",
            source: "collect-quotes",
            target: "preferred-vendor",
          },
          {
            id: "edge-3",
            source: "preferred-vendor",
            target: "risk-assessment",
            label: "yes",
          },
          {
            id: "edge-4",
            source: "preferred-vendor",
            target: "competitive-bid",
            label: "no",
          },
          {
            id: "edge-5",
            source: "competitive-bid",
            target: "risk-assessment",
          },
          {
            id: "edge-6",
            source: "risk-assessment",
            target: "risk-acceptable",
          },
          {
            id: "edge-7",
            source: "risk-acceptable",
            target: "legal-review",
            label: "yes",
          },
          {
            id: "edge-8",
            source: "risk-acceptable",
            target: "reject-vendor",
            label: "no",
          },
          {
            id: "edge-9",
            source: "legal-review",
            target: "legal-approved",
          },
          {
            id: "edge-10",
            source: "legal-approved",
            target: "create-contract",
            label: "yes",
          },
          {
            id: "edge-11",
            source: "legal-approved",
            target: "renegotiate-terms",
            label: "no",
          },
          {
            id: "edge-12",
            source: "renegotiate-terms",
            target: "legal-review",
          },
        ],
        layout: { direction: "TB", edgeRouting: "orthogonal" },
        style: {
          accentColor: "#000000",
          backgroundColor: "#ffffff",
        },
      }),
    );
    const legalReview = scene.elements.find(
      (element) => element.type === "node" && element.nodeId === "legal-review",
    );
    const renegotiateTerms = scene.elements.find(
      (element) =>
        element.type === "node" && element.nodeId === "renegotiate-terms",
    );
    const returnArrow = scene.elements.find(
      (element) => element.type === "arrow" && element.edgeId === "edge-12",
    );
    const legalToDecisionArrow = scene.elements.find(
      (element) => element.type === "arrow" && element.edgeId === "edge-9",
    );
    const renegotiateEntryArrow = scene.elements.find(
      (element) => element.type === "arrow" && element.edgeId === "edge-11",
    );

    if (
      !legalReview ||
      legalReview.type !== "node" ||
      !renegotiateTerms ||
      renegotiateTerms.type !== "node" ||
      !returnArrow ||
      returnArrow.type !== "arrow" ||
      !legalToDecisionArrow ||
      legalToDecisionArrow.type !== "arrow" ||
      !renegotiateEntryArrow ||
      renegotiateEntryArrow.type !== "arrow"
    ) {
      throw new Error("Expected procurement return route elements.");
    }

    const start = returnArrow.points[0];
    const end = returnArrow.points[returnArrow.points.length - 1];
    const lowestPoint = Math.max(...returnArrow.points.map((point) => point.y));

    if (!start || !end) {
      throw new Error("Expected return route points.");
    }

    expect(start.y).toBe(renegotiateTerms.y);
    expect(end.y).toBe(legalReview.y + legalReview.height);
    expect(lowestPoint).toBeLessThanOrEqual(renegotiateTerms.y);
    expect(testRouteSelfOverlapCount(returnArrow.points)).toBe(0);
    expect(
      testRouteOverlapCount(returnArrow.points, legalToDecisionArrow.points),
    ).toBe(0);
    expect(
      testRouteOverlapCount(returnArrow.points, renegotiateEntryArrow.points),
    ).toBe(0);
  });
});
