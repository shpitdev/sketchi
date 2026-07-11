import { describe, expect, it } from "vitest";

import { generateKeyBetween } from "fractional-indexing";

import {
  flowchartFixture,
  mindmapFixture,
  pharmaBatchDispositionFlowchart,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";

import {
  convertSceneToExcalidraw,
  createExcalidrawFile,
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

function bindingGap(
  element: ExcalidrawElement | undefined,
  key: "startBinding" | "endBinding",
): number {
  const binding = element?.[key] as { gap?: unknown } | undefined;

  if (typeof binding?.gap !== "number") {
    throw new Error(`Expected ${key} gap.`);
  }

  return binding.gap;
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

function expectFlowchartExportValid(
  input: Parameters<typeof parseFlowchartDiagram>[0],
) {
  const scene = convertSceneToExcalidraw(
    renderIntermediateDiagram(parseFlowchartDiagram(input)),
  );

  expect(validateExcalidrawScene(scene)).toEqual({ ok: true, issues: [] });
}

describe("convertSceneToExcalidraw", () => {
  it("exports the horizontal mindmap fixture with valid arrow bindings", () => {
    const exported = convertSceneToExcalidraw(
      renderIntermediateDiagram(mindmapFixture),
    );
    expect(validateExcalidrawScene(exported)).toEqual({ ok: true, issues: [] });
    expect(
      exported.elements.filter((element) => element.type === "arrow"),
    ).toHaveLength(mindmapFixture.edges.length);
  });

  it("wraps scenes as importable Excalidraw files", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const file = createExcalidrawFile(scene, {
      source: "https://studio.sketchi.app",
    });

    expect(file).toMatchObject({
      type: "excalidraw",
      version: 2,
      source: "https://studio.sketchi.app",
      elements: scene.elements,
      appState: scene.appState,
      files: {},
    });
  });

  it("creates bound arrows that validate as real Excalidraw elements", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-review",
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

  it("keeps Agy feedback-loop flowcharts valid without changing layout direction", () => {
    const feedbackLoopSpecs = [
      {
        id: "enterprise-sales-to-implementation-handoff",
        title: "Enterprise Sales-to-Implementation Handoff",
        type: "flowchart",
        nodes: [
          {
            id: "sales_qualify",
            label: "Sales: Qualify Opportunity",
            kind: "start",
          },
          {
            id: "solutions_scope",
            label: "Solutions: Scope Integration",
            kind: "process",
          },
          {
            id: "legal_review",
            label: "Legal: Review Contract",
            kind: "process",
          },
          {
            id: "contract_approved",
            label: "Contract Approved?",
            kind: "decision",
          },
          {
            id: "legal_redline",
            label: "Legal: Redline Contract",
            kind: "process",
          },
          {
            id: "finance_approve",
            label: "Finance: Approve Billing",
            kind: "process",
          },
          {
            id: "customer_sign",
            label: "Customer: Sign Order",
            kind: "process",
          },
          {
            id: "impl_kickoff",
            label: "Implementation: Kickoff",
            kind: "process",
          },
          {
            id: "customer_contacts",
            label: "Customer: Tech Contacts",
            kind: "process",
          },
          {
            id: "impl_configure",
            label: "Implementation: Config Workspace",
            kind: "process",
          },
          {
            id: "customer_validate",
            label: "Customer: Launch Checklist",
            kind: "process",
          },
          {
            id: "support_handoff",
            label: "Support: Success Handoff",
            kind: "end",
          },
        ],
        edges: [
          { id: "edge-1", source: "sales_qualify", target: "solutions_scope" },
          { id: "edge-2", source: "solutions_scope", target: "legal_review" },
          { id: "edge-3", source: "legal_review", target: "contract_approved" },
          {
            id: "edge-4",
            source: "contract_approved",
            target: "legal_redline",
            label: "no",
          },
          { id: "edge-5", source: "legal_redline", target: "legal_review" },
          {
            id: "edge-6",
            source: "contract_approved",
            target: "finance_approve",
            label: "yes",
          },
          { id: "edge-7", source: "finance_approve", target: "customer_sign" },
          { id: "edge-8", source: "customer_sign", target: "impl_kickoff" },
          { id: "edge-9", source: "impl_kickoff", target: "customer_contacts" },
          {
            id: "edge-10",
            source: "customer_contacts",
            target: "impl_configure",
          },
          {
            id: "edge-11",
            source: "impl_configure",
            target: "customer_validate",
          },
          {
            id: "edge-12",
            source: "customer_validate",
            target: "support_handoff",
          },
        ],
        layout: { direction: "TB" },
      },
      {
        id: "agentic-diagram-pipeline-feedback-loop",
        title: "Agentic Diagram Pipeline & Feedback Loop",
        type: "flowchart",
        nodes: [
          {
            id: "user_prompt",
            label: "Messy User Request Received",
            kind: "start",
          },
          {
            id: "agent_orchestration",
            label: "Agent Requests IR Candidate",
            kind: "process",
          },
          {
            id: "core_validation",
            label: "diagram-core Validates IR Schema",
            kind: "process",
          },
          { id: "ir_valid", label: "IR Valid?", kind: "decision" },
          {
            id: "agent_repair",
            label: "Agent Repairs IR Candidate",
            kind: "process",
          },
          {
            id: "scene_rendering",
            label: "diagram-renderer Generates Scene",
            kind: "process",
          },
          {
            id: "export_elements",
            label: "diagram-excalidraw Exports Elements",
            kind: "process",
          },
          {
            id: "export_succeeded",
            label: "Export Succeeded?",
            kind: "decision",
          },
          { id: "log_failure", label: "Log Error & Alert Owner", kind: "end" },
          {
            id: "store_artifacts",
            label: "Store Scene, Excalidraw & PNG",
            kind: "process",
          },
          {
            id: "telemetry_logs",
            label: "Cloudflare Gateway Logs Telemetry",
            kind: "process",
          },
          {
            id: "eval_usage",
            label: "Evaluate Usage & Tune Prompts",
            kind: "process",
          },
          {
            id: "deliver_block",
            label: "Deliver Final Artifact Ready Block",
            kind: "end",
          },
        ],
        edges: [
          {
            id: "edge-1",
            source: "user_prompt",
            target: "agent_orchestration",
          },
          {
            id: "edge-2",
            source: "agent_orchestration",
            target: "core_validation",
          },
          { id: "edge-3", source: "core_validation", target: "ir_valid" },
          {
            id: "edge-4",
            source: "ir_valid",
            target: "agent_repair",
            label: "no",
          },
          {
            id: "edge-5",
            source: "agent_repair",
            target: "agent_orchestration",
          },
          {
            id: "edge-6",
            source: "ir_valid",
            target: "scene_rendering",
            label: "yes",
          },
          {
            id: "edge-7",
            source: "scene_rendering",
            target: "export_elements",
          },
          {
            id: "edge-8",
            source: "export_elements",
            target: "export_succeeded",
          },
          {
            id: "edge-9",
            source: "export_succeeded",
            target: "log_failure",
            label: "no",
          },
          {
            id: "edge-10",
            source: "export_succeeded",
            target: "store_artifacts",
            label: "yes",
          },
          {
            id: "edge-11",
            source: "store_artifacts",
            target: "telemetry_logs",
          },
          { id: "edge-12", source: "telemetry_logs", target: "eval_usage" },
          { id: "edge-13", source: "eval_usage", target: "deliver_block" },
        ],
        layout: { direction: "TB" },
      },
    ];

    for (const spec of feedbackLoopSpecs) {
      expectFlowchartExportValid(spec);
    }
  });

  it("routes Agy left-to-right skip edges around intervening row nodes", () => {
    expectFlowchartExportValid({
      id: "enterprise-vendor-onboarding-flow",
      title: "Enterprise Vendor Onboarding Flow",
      type: "flowchart",
      nodes: [
        {
          id: "intake_request",
          label: "Intake Request Submitted",
          kind: "start",
        },
        {
          id: "requester_details",
          label: "Gather Requester Details",
          kind: "process",
        },
        {
          id: "risk_screening",
          label: "Vendor Risk Screening",
          kind: "process",
        },
        { id: "high_risk", label: "High Risk?", kind: "decision" },
        {
          id: "security_questionnaire",
          label: "Security Questionnaire",
          kind: "process",
        },
        { id: "legal_review", label: "Legal Review", kind: "process" },
        { id: "finance_tax", label: "Finance Tax Review", kind: "process" },
        {
          id: "procurement_approval",
          label: "Procurement Approval",
          kind: "process",
        },
        {
          id: "spend_threshold",
          label: "Spend Above Threshold?",
          kind: "decision",
        },
        {
          id: "executive_approval",
          label: "Executive Approval",
          kind: "process",
        },
        {
          id: "po_creation",
          label: "Purchase Order Creation",
          kind: "process",
        },
        {
          id: "portal_and_bank",
          label: "Portal Invite & Bank Validation",
          kind: "process",
        },
        { id: "invoice_match", label: "First Invoice Match", kind: "process" },
        {
          id: "activate_and_archive",
          label: "Activate & Archive Evidence",
          kind: "end",
        },
      ],
      edges: [
        { id: "edge-1", source: "intake_request", target: "requester_details" },
        { id: "edge-2", source: "requester_details", target: "risk_screening" },
        { id: "edge-3", source: "risk_screening", target: "high_risk" },
        {
          id: "edge-4",
          source: "high_risk",
          target: "security_questionnaire",
          label: "yes",
        },
        {
          id: "edge-5",
          source: "security_questionnaire",
          target: "legal_review",
        },
        {
          id: "edge-6",
          source: "high_risk",
          target: "legal_review",
          label: "no",
        },
        { id: "edge-7", source: "legal_review", target: "finance_tax" },
        {
          id: "edge-8",
          source: "finance_tax",
          target: "procurement_approval",
        },
        {
          id: "edge-9",
          source: "procurement_approval",
          target: "spend_threshold",
        },
        {
          id: "edge-10",
          source: "spend_threshold",
          target: "executive_approval",
          label: "yes",
        },
        {
          id: "edge-11",
          source: "executive_approval",
          target: "po_creation",
        },
        {
          id: "edge-12",
          source: "spend_threshold",
          target: "po_creation",
          label: "no",
        },
        { id: "edge-13", source: "po_creation", target: "portal_and_bank" },
        { id: "edge-14", source: "portal_and_bank", target: "invoice_match" },
        {
          id: "edge-15",
          source: "invoice_match",
          target: "activate_and_archive",
        },
      ],
      layout: { direction: "LR" },
    });
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
          title:
            "Production Release, Incident Response & Rollback Decision Flow",
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
      (element) => element.id === "edge:clear-review",
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
        gap: 0,
      }),
      endBinding: expect.objectContaining({
        elementId: "node:review",
        fixedPoint: expect.any(Array),
        gap: 0,
      }),
    });
    expect(bindingGap(branchArrow, "startBinding")).toBe(0);
    expect(bindingGap(branchArrow, "endBinding")).toBe(0);
    expectClosePoint(fixedStart, originalStart);
    expectClosePoint(movedStart, {
      x: originalStart.x + 48,
      y: originalStart.y + 32,
    });
  });

  it("exports boundary-bound arrows with zero binding gaps", () => {
    const diagrams = [flowchartFixture, pharmaBatchDispositionFlowchart];

    for (const diagram of diagrams) {
      const scene = convertSceneToExcalidraw(
        renderIntermediateDiagram(diagram),
      );
      const arrows = scene.elements.filter(
        (element) => element.type === "arrow",
      );

      for (const arrow of arrows) {
        expect(bindingGap(arrow, "startBinding")).toBe(0);
        expect(bindingGap(arrow, "endBinding")).toBe(0);
      }
    }
  });

  it("accepts Excalidraw-edited elbow arrows with null fixed segments", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-review",
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

  it("reports diamond endpoints that only land on the bounding box", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-review",
    );
    const decisionShape = scene.elements.find(
      (element) => element.id === "node:clear",
    );

    if (
      !branchArrow ||
      !decisionShape ||
      typeof decisionShape.x !== "number" ||
      typeof decisionShape.y !== "number" ||
      typeof decisionShape.width !== "number" ||
      typeof decisionShape.height !== "number"
    ) {
      throw new Error("Expected clear-review arrow and clear decision shape.");
    }

    const offDiamondPoint = {
      x: decisionShape.x + decisionShape.width / 2 - 9,
      y: decisionShape.y + decisionShape.height,
    };
    const startBinding = branchArrow.startBinding;

    if (!(startBinding && typeof startBinding === "object")) {
      throw new Error("Expected clear-review start binding.");
    }

    branchArrow.x = offDiamondPoint.x;
    branchArrow.y = offDiamondPoint.y;
    branchArrow.points = Array.isArray(branchArrow.points)
      ? [[0, 0], ...branchArrow.points.slice(1)]
      : [[0, 0]];
    branchArrow.startBinding = {
      ...startBinding,
      fixedPoint: [
        (offDiamondPoint.x - decisionShape.x) / decisionShape.width,
        1,
      ],
    };

    const validation = validateExcalidrawScene(scene);

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({
        code: "arrow-endpoint-off-shape",
        elementId: "edge:clear-review",
      }),
    );
  });

  it("reports orthogonal routes missing Excalidraw elbow metadata", () => {
    const scene = convertSceneToExcalidraw(
      renderIntermediateDiagram(flowchartFixture),
    );
    const branchArrow = scene.elements.find(
      (element) => element.id === "edge:clear-review",
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
        elementId: "edge:clear-review",
      }),
    );
  });
});
