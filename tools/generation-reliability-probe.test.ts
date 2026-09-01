import {
  generationReliabilityScenarios,
  type GenerationReliabilityScenario,
} from "@sketchi/diagram-scenarios";
import { describe, expect, it } from "vitest";

import {
  evaluateStructuralFidelity,
  generationProbeRequestTimeoutMs,
  selectProbeScenarios,
} from "./generation-reliability-probe";

function scenario(id: string): GenerationReliabilityScenario {
  const value = generationReliabilityScenarios.find(
    (candidate) => candidate.id === id,
  );
  if (!value) throw new Error(`Missing test scenario ${id}.`);
  return value;
}

describe("generation reliability structural assertions", () => {
  it("selects one scenario for an intensified regression probe", () => {
    expect(
      selectProbeScenarios("reliability-expense-resubmission-loop").map(
        (selected) => selected.id,
      ),
    ).toEqual(["reliability-expense-resubmission-loop"]);
    expect(selectProbeScenarios("missing-scenario")).toEqual([]);
    expect(selectProbeScenarios(undefined)).toEqual(
      generationReliabilityScenarios,
    );
  });

  it("budgets the outer request timeout beyond generation and repair policy", () => {
    const policyBudgetMs = 3 * (3 * 30_000 + 250 + 500);

    expect(generationProbeRequestTimeoutMs()).toBeGreaterThan(policyBudgetMs);
  });

  it("requires distinct labeled cycles and labeled terminal outcomes", () => {
    const result = evaluateStructuralFidelity(
      scenario("reliability-manuscript-interacting-loops"),
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "start", label: "Submission", kind: "start" },
            {
              id: "decision-a",
              label: "Reviews complete?",
              kind: "decision",
            },
            {
              id: "work-a",
              label: "Author revision and resubmission",
              kind: "process",
            },
            {
              id: "decision-b",
              label: "Plagiarism flag?",
              kind: "decision",
            },
            {
              id: "work-b",
              label: "Ethics investigation",
              kind: "process",
            },
            {
              id: "decision-c",
              label: "Editorial triage",
              kind: "decision",
            },
            {
              id: "decision-d",
              label: "Proof approved?",
              kind: "decision",
            },
            { id: "end-a", label: "Desk rejection", kind: "end" },
            { id: "end-b", label: "Final rejection", kind: "end" },
            { id: "end-c", label: "Publication", kind: "end" },
            ...Array.from({ length: 5 }, (_, index) => ({
              id: `extra-${index}`,
              label: `Review work ${index}`,
              kind: "process",
            })),
          ],
          edges: [
            { source: "start", target: "decision-a" },
            {
              source: "decision-a",
              target: "work-a",
              label: "revision requested",
            },
            { source: "work-a", target: "decision-a" },
            {
              source: "decision-a",
              target: "decision-b",
              label: "reviews complete",
            },
            {
              source: "decision-b",
              target: "work-b",
              label: "plagiarism flagged",
            },
            { source: "work-b", target: "decision-c" },
            { source: "decision-b", target: "decision-c", label: "clear" },
            {
              source: "decision-c",
              target: "decision-b",
              label: "ethics cleared",
            },
            { source: "decision-c", target: "end-a", label: "desk reject" },
            { source: "decision-c", target: "decision-d", label: "accepted" },
            { source: "decision-d", target: "end-b", label: "retract" },
            { source: "decision-d", target: "end-c", label: "publish" },
            {
              source: "decision-d",
              target: "extra-0",
              label: "extended review",
            },
            { source: "extra-0", target: "extra-1" },
            { source: "extra-1", target: "extra-2" },
            { source: "extra-2", target: "extra-3" },
            { source: "extra-3", target: "extra-4" },
            { source: "extra-4", target: "end-c" },
            { source: "extra-1", target: "extra-3" },
          ],
        },
      },
    );

    expect(result.details.cycleDecisionCount).toBe(3);
    expect(result.details.distinctCycleCount).toBe(2);
    expect(result.details.requiredCyclePathCount).toBe(2);
    expect(result.details.requiredTerminalPathCount).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("requires every expense-loop waypoint group", () => {
    const selected = scenario("reliability-expense-resubmission-loop");
    if (selected.diagramType !== "flowchart") {
      throw new Error("Expected an expense flowchart scenario.");
    }
    const requiredPath = selected.assertions.requiredCyclePaths?.[0];
    if (!requiredPath) throw new Error("Missing expense cycle assertion.");

    const result = evaluateStructuralFidelity(
      {
        ...selected,
        assertions: {
          minCycleDecisionCount: 0,
          minDecisionCount: 0,
          minEdgeCount: 0,
          minEndCount: 0,
          minNodeCount: 0,
          requiredCyclePaths: [requiredPath],
        },
      },
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "finance", label: "Finance audit", kind: "decision" },
            { id: "rejection", label: "Rejection", kind: "process" },
            {
              id: "submission",
              label: "Expense submission",
              kind: "process",
            },
          ],
          edges: [
            { source: "finance", target: "rejection", label: "rejected" },
            { source: "rejection", target: "submission" },
            { source: "submission", target: "finance" },
          ],
        },
      },
    );

    expect(result.details.requiredCyclePathCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("does not stitch adjacent cycles to satisfy expense-loop waypoints", () => {
    const selected = scenario("reliability-expense-resubmission-loop");
    if (selected.diagramType !== "flowchart") {
      throw new Error("Expected an expense flowchart scenario.");
    }
    const requiredPath = selected.assertions.requiredCyclePaths?.[0];
    if (!requiredPath) throw new Error("Missing expense cycle assertion.");

    const result = evaluateStructuralFidelity(
      {
        ...selected,
        assertions: {
          minCycleDecisionCount: 0,
          minDecisionCount: 0,
          minEdgeCount: 0,
          minEndCount: 0,
          minNodeCount: 0,
          requiredCyclePaths: [requiredPath],
        },
      },
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "finance", label: "Finance audit", kind: "decision" },
            { id: "short-loop", label: "Correction", kind: "process" },
            {
              id: "submission",
              label: "Expense submission",
              kind: "process",
            },
            {
              id: "resubmission",
              label: "Resubmission",
              kind: "process",
            },
          ],
          edges: [
            { source: "finance", target: "short-loop", label: "rejected" },
            { source: "short-loop", target: "finance" },
            { source: "finance", target: "submission", label: "approved" },
            { source: "submission", target: "resubmission" },
            { source: "resubmission", target: "finance" },
          ],
        },
      },
    );

    expect(result.details.requiredCyclePathCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("requires Editorial Triage to participate in the ethics cycle", () => {
    const selected = scenario("reliability-manuscript-interacting-loops");
    if (selected.diagramType !== "flowchart") {
      throw new Error("Expected a manuscript flowchart scenario.");
    }
    const requiredPath = selected.assertions.requiredCyclePaths?.[1];
    if (!requiredPath) throw new Error("Missing ethics cycle assertion.");

    const result = evaluateStructuralFidelity(
      {
        ...selected,
        assertions: {
          minCycleDecisionCount: 0,
          minDecisionCount: 0,
          minEdgeCount: 0,
          minEndCount: 0,
          minNodeCount: 0,
          requiredCyclePaths: [requiredPath],
        },
      },
      {
        type: "flowchart",
        spec: {
          nodes: [
            {
              id: "plagiarism",
              label: "Plagiarism flagged?",
              kind: "decision",
            },
            {
              id: "ethics",
              label: "Ethics investigation",
              kind: "process",
            },
            {
              id: "triage",
              label: "Editorial triage",
              kind: "process",
            },
          ],
          edges: [
            {
              source: "plagiarism",
              target: "ethics",
              label: "plagiarism flagged",
            },
            { source: "ethics", target: "plagiarism" },
            { source: "plagiarism", target: "triage", label: "clear" },
          ],
        },
      },
    );

    expect(result.details.requiredCyclePathCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("binds terminal branch labels to the required source node", () => {
    const selected = scenario("reliability-expense-resubmission-loop");
    if (selected.diagramType !== "flowchart") {
      throw new Error("Expected an expense flowchart scenario.");
    }
    const requiredPath = selected.assertions.requiredTerminalPaths?.[0];
    if (!requiredPath) throw new Error("Missing expense terminal assertion.");

    const result = evaluateStructuralFidelity(
      {
        ...selected,
        assertions: {
          minCycleDecisionCount: 0,
          minDecisionCount: 0,
          minEdgeCount: 0,
          minEndCount: 0,
          minNodeCount: 0,
          requiredTerminalPaths: [requiredPath],
        },
      },
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "manager", label: "Manager approval", kind: "decision" },
            { id: "finance", label: "Finance audit", kind: "process" },
            {
              id: "reimbursement",
              label: "Reimbursement",
              kind: "process",
            },
            { id: "end", label: "Reimbursed", kind: "end" },
          ],
          edges: [
            { source: "manager", target: "finance", label: "approved" },
            { source: "finance", target: "reimbursement" },
            { source: "reimbursement", target: "end" },
          ],
        },
      },
    );

    expect(result.details.requiredTerminalPathCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("rejects inverse expense semantics even when counts and a cycle pass", () => {
    const result = evaluateStructuralFidelity(
      scenario("reliability-expense-resubmission-loop"),
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "start", label: "Submission", kind: "start" },
            { id: "manager", label: "Manager review", kind: "decision" },
            { id: "finance", label: "Finance audit", kind: "decision" },
            { id: "rejection", label: "Rejection", kind: "process" },
            {
              id: "reimbursement",
              label: "Reimbursement",
              kind: "process",
            },
            {
              id: "resubmit",
              label: "Resubmission",
              kind: "process",
            },
            { id: "end", label: "Rejected", kind: "end" },
          ],
          edges: [
            { source: "start", target: "finance" },
            { source: "finance", target: "manager", label: "audited" },
            { source: "finance", target: "rejection", label: "rejected" },
            { source: "manager", target: "reimbursement", label: "approved" },
            { source: "manager", target: "rejection", label: "rejected" },
            { source: "reimbursement", target: "resubmit" },
            { source: "resubmit", target: "manager" },
            { source: "rejection", target: "end" },
          ],
        },
      },
    );

    expect(result.details.cycleDecisionCount).toBe(1);
    expect(result.details.requiredCyclePathCount).toBe(0);
    expect(result.details.requiredTerminalPathCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("rejects one labeled cycle containing two manuscript decisions", () => {
    const result = evaluateStructuralFidelity(
      scenario("reliability-manuscript-interacting-loops"),
      {
        type: "flowchart",
        spec: {
          nodes: [
            { id: "start", label: "Submission", kind: "start" },
            {
              id: "revision-decision",
              label: "Revision needed?",
              kind: "decision",
            },
            {
              id: "revision",
              label: "Author revision and resubmission",
              kind: "process",
            },
            {
              id: "ethics-decision",
              label: "Plagiarism flag?",
              kind: "decision",
            },
            {
              id: "ethics",
              label: "Ethics investigation",
              kind: "process",
            },
            { id: "triage", label: "Editorial triage", kind: "decision" },
            { id: "proof", label: "Proof approved?", kind: "decision" },
            { id: "desk-end", label: "Desk rejection", kind: "end" },
            { id: "reject-end", label: "Final rejection", kind: "end" },
            { id: "publish-end", label: "Publication", kind: "end" },
            ...Array.from({ length: 5 }, (_, index) => ({
              id: `extra-${index}`,
              label: `Review work ${index}`,
              kind: "process",
            })),
          ],
          edges: [
            { source: "start", target: "revision-decision" },
            {
              source: "revision-decision",
              target: "revision",
              label: "revision requested",
            },
            { source: "revision", target: "ethics-decision" },
            {
              source: "ethics-decision",
              target: "ethics",
              label: "plagiarism flagged",
            },
            { source: "ethics", target: "revision-decision" },
            {
              source: "revision-decision",
              target: "triage",
              label: "reviews complete",
            },
            { source: "ethics-decision", target: "triage", label: "clear" },
            { source: "triage", target: "desk-end", label: "desk reject" },
            { source: "triage", target: "proof", label: "accepted" },
            { source: "proof", target: "reject-end", label: "retract" },
            { source: "proof", target: "publish-end", label: "publish" },
            ...Array.from({ length: 7 }, (_, index) => ({
              source: `extra-${Math.max(0, index - 1)}`,
              target: `extra-${Math.min(4, index)}`,
            })),
          ],
        },
      },
    );

    expect(result.details.cycleDecisionCount).toBe(2);
    expect(result.details.requiredCyclePathCount).toBe(1);
    expect(result.details.distinctCycleCount).toBe(1);
    expect(result.passed).toBe(false);
  });

  it("rejects unlabeled decision branches even when counts pass", () => {
    const selected = scenario("reliability-expense-resubmission-loop");
    const result = evaluateStructuralFidelity(selected, {
      type: "flowchart",
      spec: {
        nodes: [
          { id: "start", kind: "start" },
          { id: "decision", kind: "decision" },
          { id: "loop", kind: "process" },
          { id: "decision-2", kind: "decision" },
          { id: "work", kind: "process" },
          { id: "work-2", kind: "process" },
          { id: "end", kind: "end" },
        ],
        edges: [
          { source: "start", target: "decision" },
          { source: "decision", target: "loop" },
          { source: "loop", target: "decision" },
          { source: "decision", target: "decision-2", label: "approved" },
          { source: "decision-2", target: "work", label: "yes" },
          { source: "decision-2", target: "work-2", label: "no" },
          { source: "work", target: "end" },
        ],
      },
    });

    expect(result.details.unlabeledDecisionBranches).toBe(1);
    expect(result.passed).toBe(false);
  });

  it("measures nested mindmap topic count and depth", () => {
    const selected = scenario("reliability-wedding-richness");
    const leaf = (label: string) => ({ label, children: [] });
    const result = evaluateStructuralFidelity(selected, {
      type: "mindmap",
      spec: {
        root: {
          label: "Wedding",
          children: [
            {
              label: "Venue",
              children: [leaf("Search"), leaf("Visit"), leaf("Book")],
            },
            {
              label: "Guests",
              children: [leaf("List"), leaf("Invites"), leaf("RSVP")],
            },
            {
              label: "Day",
              children: [leaf("Schedule")],
            },
          ],
        },
      },
    });

    expect(result.details).toEqual({ maxDepth: 2, topicCount: 11 });
    expect(result.passed).toBe(true);
  });
});
