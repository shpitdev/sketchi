import type { FlowchartDiagram } from "@sketchi/diagram-core";

import type { QualityCheck, QualityReport } from "../code-mode/contract.js";

const GENERIC_LABEL = /^(node|step|item|box|thing|process|task)\s*\d*$/i;
const GENERIC_TITLE = /^(diagram|untitled|flowchart|chart|sketch)$/i;

interface QualityFinding {
  message: string;
  severity: QualityCheck["severity"];
}

function connectedComponentCount(diagram: FlowchartDiagram): number {
  const adjacency = new Map<string, string[]>();
  for (const node of diagram.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of diagram.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  const seen = new Set<string>();
  let components = 0;
  for (const node of diagram.nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    components += 1;
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) {
        break;
      }
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }
  return components;
}

function isDecision(node: FlowchartDiagram["nodes"][number]): boolean {
  return node.kind === "decision" || node.label.endsWith("?");
}

function qualityCode(message: string): string {
  if (message.includes("generic label")) {
    return "generic_label";
  }
  if (message.includes("shorten label")) {
    return "label_too_long";
  }
  if (message.includes("disconnected")) {
    return "disconnected_graph";
  }
  return "quality_below_threshold";
}

/**
 * Deterministic quality assessment shared by every canonical flowchart host.
 * This preserves the established scoring behavior while returning the
 * canonical QualityReport directly instead of a legacy tool-grade envelope.
 */
export function assessFlowchartQuality(
  diagram: FlowchartDiagram,
  threshold: number,
): QualityReport {
  const findings: QualityFinding[] = [];
  let penalty = 0;

  const fault = (points: number, message: string, error = false) => {
    penalty += points;
    findings.push({ severity: error ? "error" : "warning", message });
  };

  const degree = new Map<string, number>();
  const outgoing = new Map<string, FlowchartDiagram["edges"]>();
  for (const edge of diagram.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  if (diagram.nodes.length > 1 && diagram.edges.length === 0) {
    fault(5, "no edges at all — every node floats unconnected", true);
  } else {
    const orphans = diagram.nodes.filter(
      (node) => (degree.get(node.id) ?? 0) === 0,
    );
    if (orphans.length > 0 && diagram.nodes.length > 1) {
      fault(
        Math.min(1.5 * orphans.length, 4.5),
        `unconnected node(s): ${orphans.map((node) => node.id).join(", ")}`,
        true,
      );
    }
    const components = connectedComponentCount(diagram);
    if (components > 1 && orphans.length === 0) {
      fault(2, `diagram splits into ${components} disconnected islands`, true);
    }
  }

  if (diagram.nodes.length < 3) {
    fault(2, "too sparse — a useful flow needs at least 3 nodes");
  } else if (diagram.nodes.length > 24) {
    fault(2, "too dense — trim or merge nodes (24 max)");
  }

  const labelCounts = new Map<string, number>();
  for (const node of diagram.nodes) {
    const key = node.label.trim().toLowerCase();
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  const duplicates = [...labelCounts.entries()].filter(
    ([, count]) => count > 1,
  );
  if (duplicates.length > 0) {
    fault(
      Math.min(duplicates.length, 3),
      `duplicate label(s): ${duplicates
        .map(([label]) => `"${label}"`)
        .join(", ")}`,
    );
  }

  let underBranched = 0;
  let unlabeledBranches = 0;
  for (const node of diagram.nodes.filter(isDecision)) {
    const branches = outgoing.get(node.id) ?? [];
    if (branches.length < 2) {
      underBranched += 1;
      findings.push({
        severity: "error",
        message: `decision "${node.id}" needs at least 2 outgoing branches`,
      });
    } else if (branches.some((edge) => !edge.label)) {
      unlabeledBranches += 1;
      findings.push({
        severity: "warning",
        message: `label every branch out of decision "${node.id}" (yes/no, …)`,
      });
    }
  }
  penalty +=
    Math.min(1.5 * underBranched, 4.5) + Math.min(unlabeledBranches, 3);

  const longLabels = diagram.nodes.filter((node) => node.label.length > 42);
  if (longLabels.length > 0) {
    fault(
      Math.min(0.5 * longLabels.length, 2),
      `shorten label(s): ${longLabels.map((node) => node.id).join(", ")}`,
    );
  }

  const genericLabels = diagram.nodes.filter((node) =>
    GENERIC_LABEL.test(node.label.trim()),
  );
  if (genericLabels.length > 0) {
    fault(
      Math.min(genericLabels.length, 3),
      `generic label(s) say nothing: ${genericLabels
        .map((node) => `"${node.label}"`)
        .join(", ")}`,
    );
  }

  if (
    diagram.title.trim().length < 4 ||
    GENERIC_TITLE.test(diagram.title.trim())
  ) {
    fault(0.5, "give the diagram a specific title");
  }

  const score = Math.max(0, Math.round((10 - penalty) * 10) / 10);
  const checks: QualityCheck[] = findings.map((finding) => ({
    code: qualityCode(finding.message),
    passed: false,
    severity: finding.severity,
    message: finding.message,
    refs: [],
  }));

  return {
    accepted:
      score >= threshold && !checks.some((check) => check.severity === "error"),
    score,
    threshold,
    summary: {
      nodeCount: diagram.nodes.length,
      edgeCount: diagram.edges.length,
    },
    checks,
  };
}
