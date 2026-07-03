import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@sketchi/diagram-excalidraw";

import {
  evaluateScenarioDiagram,
  evaluateScenarioFixture,
  evaluateScenarioOutput,
  extractJsonCandidate,
} from "./evaluate";
import { flowchartScenarios, getScenario } from "./scenarios";

const onboardingScenario = getScenario("sketchi-onboarding-decision-flow");
const MOVE_DELTA = { x: 48, y: 32 };

function numericBounds(element: ExcalidrawElement | undefined) {
  if (
    !element ||
    typeof element.x !== "number" ||
    typeof element.y !== "number" ||
    typeof element.width !== "number" ||
    typeof element.height !== "number"
  ) {
    throw new Error(`Expected numeric bounds for ${element?.id ?? "element"}.`);
  }

  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
}

function binding(
  element: ExcalidrawElement,
  key: "startBinding" | "endBinding",
) {
  const value = element[key];
  if (!(value && typeof value === "object")) {
    throw new Error(`Expected ${element.id} ${key}.`);
  }

  const elementId = (value as { elementId?: unknown }).elementId;
  const fixedPoint = (value as { fixedPoint?: unknown }).fixedPoint;
  const gap = (value as { gap?: unknown }).gap;

  if (
    typeof elementId !== "string" ||
    typeof gap !== "number" ||
    !Array.isArray(fixedPoint) ||
    fixedPoint.length < 2 ||
    typeof fixedPoint[0] !== "number" ||
    typeof fixedPoint[1] !== "number"
  ) {
    throw new Error(`Expected ${element.id} ${key} fixedPoint metadata.`);
  }

  return {
    elementId,
    gap,
    fixedPoint: [
      Math.abs(fixedPoint[0] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[0],
      Math.abs(fixedPoint[1] - 0.5001) < 0.0001 ? 0.5 : fixedPoint[1],
    ] as const,
  };
}

function arrowEndpoint(
  element: ExcalidrawElement,
  key: "startBinding" | "endBinding",
) {
  const points = element.points;
  if (
    typeof element.x !== "number" ||
    typeof element.y !== "number" ||
    !Array.isArray(points)
  ) {
    throw new Error(`Expected numeric arrow points for ${element.id}.`);
  }

  const point = key === "startBinding" ? points[0] : points[points.length - 1];
  if (
    !Array.isArray(point) ||
    typeof point[0] !== "number" ||
    typeof point[1] !== "number"
  ) {
    throw new Error(`Expected ${element.id} ${key} endpoint.`);
  }

  return {
    x: element.x + point[0],
    y: element.y + point[1],
  };
}

function pointFromBinding(
  shape: ExcalidrawElement | undefined,
  fixedPoint: readonly [number, number],
) {
  const bounds = numericBounds(shape);
  return {
    x: bounds.x + bounds.width * fixedPoint[0],
    y: bounds.y + bounds.height * fixedPoint[1],
  };
}

function expectClosePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.05);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.05);
}

describe("diagram scenario evaluation", () => {
  it("passes maintained fixture diagrams through the deterministic pipeline", () => {
    const result = evaluateScenarioFixture(onboardingScenario);

    expect(result.ok).toBe(true);
    expect(result.excalidrawValidation.ok).toBe(true);
    expect(
      result.excalidrawScene.elements.some(
        (element) => element.type === "arrow",
      ),
    ).toBe(true);
  });

  it("passes every maintained scenario through the deterministic pipeline", () => {
    expect(flowchartScenarios.length).toBeGreaterThanOrEqual(20);

    for (const scenario of flowchartScenarios) {
      expect(
        scenario.assertions.requiredEdges,
        `${scenario.id}: every expected edge should become a semantic assertion`,
      ).toHaveLength(scenario.expectedDiagram.edges.length);

      const result = evaluateScenarioFixture(scenario);

      expect(
        result.ok,
        `${scenario.id}: ${result.checks
          .filter((check) => !check.passed)
          .map((check) => check.message)
          .join(", ")}`,
      ).toBe(true);
      expect(
        result.excalidrawValidation.ok,
        `${scenario.id}: ${result.excalidrawValidation.issues
          .map((issue) => issue.message)
          .join(", ")}`,
      ).toBe(true);
    }
  });

  it("exports every maintained scenario with move-stable Excalidraw bindings", () => {
    for (const scenario of flowchartScenarios) {
      const result = evaluateScenarioFixture(scenario);
      const elementsById = new Map(
        result.excalidrawScene.elements.map((element) => [element.id, element]),
      );
      const arrows = result.excalidrawScene.elements.filter(
        (element) => element.type === "arrow",
      );

      expect(arrows, scenario.id).toHaveLength(
        scenario.expectedDiagram.edges.length,
      );

      for (const arrow of arrows) {
        for (const key of ["startBinding", "endBinding"] as const) {
          const originalEndpoint = arrowEndpoint(arrow, key);
          const { elementId, fixedPoint, gap } = binding(arrow, key);
          const shape = elementsById.get(elementId);
          const originalFixedPoint = pointFromBinding(shape, fixedPoint);
          const movedFixedPoint = pointFromBinding(
            shape
              ? {
                  ...shape,
                  x: Number(shape.x) + MOVE_DELTA.x,
                  y: Number(shape.y) + MOVE_DELTA.y,
                }
              : undefined,
            fixedPoint,
          );

          expect(gap, `${scenario.id}: ${arrow.id} ${key} gap`).toBe(0);
          expectClosePoint(originalFixedPoint, originalEndpoint);
          expectClosePoint(movedFixedPoint, {
            x: originalEndpoint.x + MOVE_DELTA.x,
            y: originalEndpoint.y + MOVE_DELTA.y,
          });
        }
      }
    }
  });

  it("extracts a JSON object from wrapped model output", () => {
    const output = `Here is the JSON:\n${JSON.stringify(onboardingScenario.expectedDiagram)}`;

    expect(extractJsonCandidate(output)).toMatchObject({
      id: onboardingScenario.expectedDiagram.id,
      type: "flowchart",
    });
    expect(evaluateScenarioOutput(onboardingScenario, output).ok).toBe(true);
  });

  it("fails semantic checks when required branches are missing", () => {
    const candidate = {
      ...onboardingScenario.expectedDiagram,
      edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
        edge.id === "clear-review" ? { ...edge, label: "maybe" } : edge,
      ),
    };

    const result = evaluateScenarioDiagram(onboardingScenario, candidate);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "branch-label:no",
        passed: false,
      }),
    );
  });

  it("fails semantic checks when required wiring is changed but labels remain present", () => {
    const candidate = {
      ...onboardingScenario.expectedDiagram,
      edges: onboardingScenario.expectedDiagram.edges.map((edge) =>
        edge.id === "clear-review" ? { ...edge, target: "draft" } : edge,
      ),
    };

    const result = evaluateScenarioDiagram(onboardingScenario, candidate);

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "edge:Scope clear?->Review diagram:no",
        passed: false,
      }),
    );
  });
});
