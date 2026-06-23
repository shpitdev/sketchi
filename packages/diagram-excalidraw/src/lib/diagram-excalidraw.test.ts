import { describe, expect, it } from "vitest";

import {
  flowchartFixture,
  pharmaBatchDispositionFlowchart,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import {
  convertSceneToExcalidraw,
  type ExcalidrawElement,
  validateExcalidrawScene,
} from "./diagram-excalidraw";

function bindingFixedPoint(
  element: ExcalidrawElement | undefined,
  key: "startBinding" | "endBinding",
): [number, number] {
  const binding = element?.[key] as { fixedPoint?: unknown } | undefined;

  if (
    !Array.isArray(binding?.fixedPoint) ||
    binding.fixedPoint.length < 2 ||
    typeof binding.fixedPoint[0] !== "number" ||
    typeof binding.fixedPoint[1] !== "number"
  ) {
    throw new Error(`Expected ${key} fixedPoint.`);
  }

  return [binding.fixedPoint[0], binding.fixedPoint[1]];
}

function globalPointFromFixedPoint(
  shape: ExcalidrawElement | undefined,
  fixedPoint: readonly [number, number],
) {
  if (
    !shape ||
    typeof shape.x !== "number" ||
    typeof shape.y !== "number" ||
    typeof shape.width !== "number" ||
    typeof shape.height !== "number"
  ) {
    throw new Error("Expected numeric shape bounds.");
  }

  return {
    x: shape.x + shape.width * fixedPoint[0],
    y: shape.y + shape.height * fixedPoint[1],
  };
}

function firstGlobalPoint(element: ExcalidrawElement | undefined) {
  const points = element?.points;

  if (
    !Array.isArray(points) ||
    !Array.isArray(points[0]) ||
    typeof points[0][0] !== "number" ||
    typeof points[0][1] !== "number" ||
    typeof element?.x !== "number" ||
    typeof element.y !== "number"
  ) {
    throw new Error("Expected a numeric arrow start point.");
  }

  return {
    x: element.x + points[0][0],
    y: element.y + points[0][1],
  };
}

function expectClosePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.05);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.05);
}

describe("convertSceneToExcalidraw", () => {
  it("creates bound arrows that validate as real Excalidraw elements", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-draft",
    );

    const validation = validateExcalidrawScene(scene);

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(scene.appState).toMatchObject({
      viewBackgroundColor: "#ffffff",
      zoom: {
        value: expect.any(Number),
      },
    });
    expect(
      scene.elements.filter((element) => element.type === "arrow"),
    ).toHaveLength(flowchartFixture.edges.length);
    expect(branchArrow).toMatchObject({
      type: "arrow",
      points: expect.arrayContaining([
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
      ]),
      elbowed: true,
      fixedSegments: [],
      roundness: null,
      startBinding: expect.objectContaining({
        fixedPoint: expect.arrayContaining([expect.any(Number)]),
      }),
    });
  });

  it("opens maintained vertical flowcharts at an embedded-canvas friendly zoom", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );

    expect(scene.appState.zoom).toEqual({ value: 0.5 });
  });

  it("keeps wrapped flowchart text inside real shape containers", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(pharmaBatchDispositionFlowchart),
    );

    const validation = validateExcalidrawScene(scene);
    const qaText = scene.elements.find(
      (element) => element.id === "label:qa-review",
    );

    expect(validation).toEqual({ ok: true, issues: [] });
    expect(qaText).toMatchObject({
      type: "text",
      containerId: "node:qa-review",
      text: expect.stringContaining("\n"),
    });
  });

  it("keeps maintained flowchart arrow routes from overlapping", () => {
    const maintainedScenes = [
      flowchartFixture,
      pharmaBatchDispositionFlowchart,
    ].map((diagram) =>
      convertSceneToExcalidraw(renderIntermediateDiagram(diagram)),
    );

    for (const scene of maintainedScenes) {
      expect(validateExcalidrawScene(scene).issues).not.toContainEqual(
        expect.objectContaining({ code: "overlapping-arrow-segment" }),
      );
    }
  });

  it("allows shared bound stems when decision branches diverge", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(
        parseFlowchartDiagram({
          id: "shared-stem-branch",
          title: "Shared stem branch",
          type: "flowchart",
          nodes: [
            { id: "start", label: "Start", kind: "start" },
            { id: "gate", label: "Proceed?", kind: "decision" },
            { id: "left", label: "Left path", kind: "process" },
            { id: "right", label: "Right path", kind: "process" },
            { id: "done", label: "Done", kind: "end" },
          ],
          edges: [
            { id: "start-gate", source: "start", target: "gate" },
            { id: "gate-left", source: "gate", target: "left", label: "yes" },
            { id: "gate-right", source: "gate", target: "right", label: "no" },
            { id: "left-done", source: "left", target: "done" },
            { id: "right-done", source: "right", target: "done" },
          ],
          layout: { direction: "TB", edgeRouting: "orthogonal" },
        }),
      ),
    );

    expect(validateExcalidrawScene(scene).issues).not.toContainEqual(
      expect.objectContaining({ code: "overlapping-arrow-segment" }),
    );
  });

  it("uses fixed elbow bindings so Excalidraw can preserve connectors when shapes move", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-draft",
    );
    const sourceShape = scene.elements.find(
      (element) => element.id === "node:clear",
    );
    const startFixedPoint = bindingFixedPoint(branchArrow, "startBinding");
    const originalStart = firstGlobalPoint(branchArrow);
    const fixedStart = globalPointFromFixedPoint(sourceShape, startFixedPoint);
    const movedStart = globalPointFromFixedPoint(
      sourceShape
        ? {
            ...sourceShape,
            x: Number(sourceShape.x) + 48,
            y: Number(sourceShape.y) + 32,
          }
        : undefined,
      startFixedPoint,
    );

    expect(branchArrow).toMatchObject({
      elbowed: true,
      fixedSegments: [],
      startBinding: expect.objectContaining({
        elementId: "node:clear",
        fixedPoint: expect.any(Array),
      }),
      endBinding: expect.objectContaining({
        elementId: "node:draft",
        fixedPoint: expect.any(Array),
      }),
    });
    expectClosePoint(fixedStart, originalStart);
    expectClosePoint(movedStart, {
      x: originalStart.x + 48,
      y: originalStart.y + 32,
    });
  });

  it("accepts Excalidraw-edited elbow arrows with null fixed segments", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-draft",
    );

    if (branchArrow) {
      branchArrow.fixedSegments = null;
    }

    expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
  });

  it("reports broken reciprocal arrow bindings", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const firstShape = scene.elements.find(
      (element) => element.id === "node:prompt",
    );

    if (firstShape) {
      firstShape.boundElements = [];
    }

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "missing-bound-arrow",
        elementId: "node:prompt",
      }),
    );
  });

  it("reports overlapping arrow route segments", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const promptArrow = scene.elements.find(
      (element) => element.id === "edge:prompt-requirements",
    );
    const requirementsArrow = scene.elements.find(
      (element) => element.id === "edge:requirements-clear",
    );

    if (promptArrow && requirementsArrow) {
      requirementsArrow.x = promptArrow.x;
      requirementsArrow.y = promptArrow.y;
      requirementsArrow.points = promptArrow.points;
    }

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "overlapping-arrow-segment",
        elementId: "edge:prompt-requirements",
      }),
    );
  });

  it("reports arrow endpoints that no longer land on their bound shapes", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const promptArrow = scene.elements.find(
      (element) => element.id === "edge:prompt-requirements",
    );

    if (promptArrow) {
      promptArrow.x = Number(promptArrow.x) + 220;
    }

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "arrow-endpoint-off-shape",
        elementId: "edge:prompt-requirements",
      }),
    );
  });

  it("reports orthogonal routes missing Excalidraw elbow metadata", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-draft",
    );

    if (branchArrow) {
      branchArrow.elbowed = false;
      delete branchArrow.fixedSegments;
    }

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-elbow-binding",
        elementId: "edge:clear-draft",
      }),
    );
  });
});
