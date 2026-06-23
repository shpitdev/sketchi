import { describe, expect, it } from "vitest";

import { generateKeyBetween } from "fractional-indexing";

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

function expectValidOrderKeys(elements: readonly ExcalidrawElement[]) {
  let previous: string | null = null;

  for (const element of elements) {
    const index = element.index;

    expect(typeof index).toBe("string");
    if (typeof index !== "string") {
      throw new Error(`Expected ${element.id} to have a string order key.`);
    }

    expect(() => generateKeyBetween(previous, index)).not.toThrow();
    if (previous !== null) {
      expect(previous < index).toBe(true);
    }
    previous = index;
  }

  expect(() => generateKeyBetween(previous, null)).not.toThrow();
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

    expect(scene.appState.zoom).toEqual({
      value: expect.any(Number),
    });
    expect(
      Number((scene.appState.zoom as { value: number }).value),
    ).toBeGreaterThanOrEqual(0.42);
    expect(
      Number((scene.appState.zoom as { value: number }).value),
    ).toBeLessThanOrEqual(0.5);
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

  it("emits valid Excalidraw order keys for dense scenes past 90 elements", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(
        parseFlowchartDiagram({
          id: "production-release-incident-response-rollback-de",
          title: "Production Release, Incident Response & Rollback Decision Flow",
          type: "flowchart",
          nodes: [
            { id: "start", label: "Release Triggered", kind: "start" },
            { id: "ci_build", label: "CI Build & Unit Tests", kind: "process" },
            { id: "ci_gate", label: "CI Green?", kind: "decision" },
            {
              id: "security_scan",
              label: "Security & Dependency Scan",
              kind: "process",
            },
            { id: "scan_gate", label: "Scan Clean?", kind: "decision" },
            {
              id: "deploy_staging",
              label: "Deploy to Staging",
              kind: "process",
            },
            { id: "vuln_gate", label: "Exploitable Vuln?", kind: "decision" },
            {
              id: "smoke_staging",
              label: "Staging Smoke + Integration Tests",
              kind: "process",
            },
            { id: "release_aborted", label: "Release Aborted", kind: "end" },
            {
              id: "staging_gate",
              label: "Staging Healthy?",
              kind: "decision",
            },
            { id: "fix_code", label: "Fix Code & Rebuild", kind: "process" },
            {
              id: "canary_deploy",
              label: "Canary 5% Rollout",
              kind: "process",
            },
            {
              id: "canary_gate",
              label: "Canary Metrics OK?",
              kind: "decision",
            },
            {
              id: "full_rollout",
              label: "Full Production Rollout",
              kind: "process",
            },
            {
              id: "monitor",
              label: "Monitor SLOs, Errors & Alerts",
              kind: "process",
            },
            {
              id: "incident_gate",
              label: "Incident Detected?",
              kind: "decision",
            },
            {
              id: "severity_gate",
              label: "Sev1 / Customer Impact?",
              kind: "decision",
            },
            { id: "release_complete", label: "Release Complete", kind: "end" },
            {
              id: "page_oncall",
              label: "Page On-Call & Declare Incident",
              kind: "process",
            },
            {
              id: "mitigate",
              label: "Apply Mitigation / Feature Flag",
              kind: "process",
            },
            {
              id: "mitigation_gate",
              label: "Mitigated Within SLA?",
              kind: "decision",
            },
            {
              id: "rollback",
              label: "Rollback to Last Good Build",
              kind: "process",
            },
            {
              id: "rollback_gate",
              label: "Health Restored?",
              kind: "decision",
            },
            {
              id: "manual_recovery",
              label: "Escalate: Manual Infra/DB Recovery",
              kind: "process",
            },
            {
              id: "postmortem",
              label: "Postmortem & Action Items",
              kind: "process",
            },
            { id: "incident_closed", label: "Incident Closed", kind: "end" },
          ],
          edges: [
            { id: "edge-1", source: "start", target: "ci_build" },
            { id: "edge-2", source: "ci_build", target: "ci_gate" },
            {
              id: "edge-3",
              source: "ci_gate",
              target: "security_scan",
              label: "yes",
            },
            {
              id: "edge-4",
              source: "ci_gate",
              target: "fix_code",
              label: "no",
            },
            {
              id: "edge-5",
              source: "fix_code",
              target: "ci_build",
              label: "rebuild",
            },
            { id: "edge-6", source: "security_scan", target: "scan_gate" },
            {
              id: "edge-7",
              source: "scan_gate",
              target: "deploy_staging",
              label: "clean",
            },
            {
              id: "edge-8",
              source: "scan_gate",
              target: "vuln_gate",
              label: "vulns found",
            },
            {
              id: "edge-9",
              source: "vuln_gate",
              target: "release_aborted",
              label: "exploitable",
            },
            {
              id: "edge-10",
              source: "vuln_gate",
              target: "fix_code",
              label: "patchable",
            },
            {
              id: "edge-11",
              source: "deploy_staging",
              target: "smoke_staging",
            },
            {
              id: "edge-12",
              source: "smoke_staging",
              target: "staging_gate",
            },
            {
              id: "edge-13",
              source: "staging_gate",
              target: "canary_deploy",
              label: "healthy",
            },
            {
              id: "edge-14",
              source: "staging_gate",
              target: "fix_code",
              label: "failed",
            },
            {
              id: "edge-15",
              source: "canary_deploy",
              target: "canary_gate",
            },
            {
              id: "edge-16",
              source: "canary_gate",
              target: "full_rollout",
              label: "metrics ok",
            },
            {
              id: "edge-17",
              source: "canary_gate",
              target: "rollback",
              label: "regression",
            },
            { id: "edge-18", source: "full_rollout", target: "monitor" },
            { id: "edge-19", source: "monitor", target: "incident_gate" },
            {
              id: "edge-20",
              source: "incident_gate",
              target: "release_complete",
              label: "stable",
            },
            {
              id: "edge-21",
              source: "incident_gate",
              target: "severity_gate",
              label: "anomaly",
            },
            {
              id: "edge-22",
              source: "severity_gate",
              target: "page_oncall",
              label: "sev1",
            },
            {
              id: "edge-23",
              source: "severity_gate",
              target: "mitigate",
              label: "low sev",
            },
            { id: "edge-24", source: "page_oncall", target: "mitigate" },
            { id: "edge-25", source: "mitigate", target: "mitigation_gate" },
            {
              id: "edge-26",
              source: "mitigation_gate",
              target: "monitor",
              label: "mitigated",
            },
            {
              id: "edge-27",
              source: "mitigation_gate",
              target: "rollback",
              label: "not mitigated",
            },
            { id: "edge-28", source: "rollback", target: "rollback_gate" },
            {
              id: "edge-29",
              source: "rollback_gate",
              target: "postmortem",
              label: "restored",
            },
            {
              id: "edge-30",
              source: "rollback_gate",
              target: "manual_recovery",
              label: "still failing",
            },
            {
              id: "edge-31",
              source: "manual_recovery",
              target: "rollback_gate",
              label: "re-verify",
            },
            { id: "edge-32", source: "postmortem", target: "incident_closed" },
          ],
          layout: { direction: "TB", edgeRouting: "orthogonal" },
        }),
      ),
    );

    expect(scene.elements.length).toBeGreaterThan(90);
    expect(scene.elements.map((element) => element.index)).not.toContain("a90");
    expectValidOrderKeys(scene.elements);
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

  it("reports arrow route segments that pass through unrelated nodes", () => {
    const scene = convertSceneToExcalidraw({
      diagramId: "through-node-route",
      title: "Through-node route",
      width: 420,
      height: 140,
      accentColor: "#0f766e",
      backgroundColor: "#ffffff",
      elements: [
        {
          type: "arrow",
          id: "edge:start-end",
          edgeId: "start-end",
          sourceNodeId: "start",
          targetNodeId: "end",
          points: [
            { x: 120, y: 70 },
            { x: 320, y: 70 },
          ],
        },
        {
          type: "node",
          id: "node:start",
          nodeId: "start",
          shape: "rectangle",
          x: 20,
          y: 40,
          width: 100,
          height: 60,
          label: "Start",
        },
        {
          type: "node",
          id: "node:middle",
          nodeId: "middle",
          shape: "rectangle",
          x: 170,
          y: 40,
          width: 100,
          height: 60,
          label: "Middle",
        },
        {
          type: "node",
          id: "node:end",
          nodeId: "end",
          shape: "rectangle",
          x: 320,
          y: 40,
          width: 100,
          height: 60,
          label: "End",
        },
      ],
    });

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "arrow-segment-through-node",
        elementId: "edge:start-end",
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
