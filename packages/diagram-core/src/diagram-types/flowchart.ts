import { z } from "zod";

import {
  DiagramEdgeSchema,
  DiagramNodeSchema,
  DiagramValidationError,
  IntermediateDiagramSchema,
} from "../intermediate.js";

export const flowchartDiagramType = "flowchart" as const;

export const FLOWCHART_MAX_NODES = 24;
export const FLOWCHART_MAX_EDGES = 64;
export const FLOWCHART_MAX_ISSUES = 20;

export const FlowchartValidationIssueCodeSchema = z.enum([
  "duplicate_node_id",
  "duplicate_edge_id",
  "missing_edge_source",
  "missing_edge_target",
  "self_loop",
  "missing_start",
  "multiple_starts",
  "missing_end",
  "start_has_incoming",
  "end_has_outgoing",
  "unreachable_node",
  "missing_outgoing_edge",
  "underbranched_decision",
  "unlabeled_decision_branch",
  "duplicate_decision_branch_label",
  "nonterminating_node",
  "flowchart_too_large",
]);

export const FlowchartValidationIssueRefSchema = z.object({
  kind: z.enum(["diagram", "node", "edge"]),
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});

export const FlowchartValidationIssueSchema = z.object({
  code: FlowchartValidationIssueCodeSchema,
  ref: FlowchartValidationIssueRefSchema.optional(),
  message: z.string().min(1),
  hint: z.string().min(1),
});

export const FlowchartNodeKindSchema = z.enum([
  "start",
  "process",
  "decision",
  "end",
]);

export const FlowchartNodeSchema = DiagramNodeSchema.extend({
  kind: FlowchartNodeKindSchema,
  description: z.string().min(1).optional(),
});

export const FlowchartEdgeSchema = DiagramEdgeSchema.extend({
  label: z.string().min(1).optional(),
});

export const FlowchartDiagramSchema = IntermediateDiagramSchema.extend({
  type: z.literal(flowchartDiagramType),
  nodes: z.array(FlowchartNodeSchema).min(2),
  edges: z.array(FlowchartEdgeSchema).min(1),
});

export type FlowchartNodeKind = z.infer<typeof FlowchartNodeKindSchema>;
export type FlowchartNode = z.infer<typeof FlowchartNodeSchema>;
export type FlowchartEdge = z.infer<typeof FlowchartEdgeSchema>;
export type FlowchartDiagram = z.infer<typeof FlowchartDiagramSchema>;
export type FlowchartValidationIssueCode = z.infer<
  typeof FlowchartValidationIssueCodeSchema
>;
export type FlowchartValidationIssueRef = z.infer<
  typeof FlowchartValidationIssueRefSchema
>;
export type FlowchartValidationIssue = z.infer<
  typeof FlowchartValidationIssueSchema
>;

function edgeBuckets(edges: readonly FlowchartEdge[]) {
  const incoming = new Map<string, FlowchartEdge[]>();
  const outgoing = new Map<string, FlowchartEdge[]>();

  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }

  return { incoming, outgoing };
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates];
}

function validateDecisionBranches(
  node: FlowchartNode,
  outgoingEdges: readonly FlowchartEdge[],
): FlowchartValidationIssue[] {
  const issues: FlowchartValidationIssue[] = [];
  if (outgoingEdges.length < 2) {
    issues.push({
      code: "underbranched_decision",
      ref: { kind: "node", id: node.id },
      message: `Decision node "${node.id}" must have at least two outgoing branches.`,
      hint: "Add at least two outgoing edges for the decision outcomes.",
    });
  }

  const labels = outgoingEdges.map((edge) => edge.label?.trim() ?? "");
  for (const edge of outgoingEdges.filter((edge) => !edge.label?.trim())) {
    issues.push({
      code: "unlabeled_decision_branch",
      ref: { kind: "edge", id: edge.id, path: "edges.label" },
      message: `Decision node "${node.id}" has an outgoing branch without a label.`,
      hint: 'Add a short branch label such as "yes", "no", "approved", or "rejected".',
    });
  }

  for (const label of duplicateValues(
    labels
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase()),
  )) {
    issues.push({
      code: "duplicate_decision_branch_label",
      ref: { kind: "node", id: node.id },
      message: `Decision node "${node.id}" repeats branch label "${label}".`,
      hint: "Make every outgoing branch label from the same decision unique.",
    });
  }

  return issues;
}

function reachableFrom(
  initialNodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly FlowchartEdge[]>,
  nextNodeId: (edge: FlowchartEdge) => string,
): Set<string> {
  const reached = new Set<string>();
  const queue = [...initialNodeIds];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined || reached.has(current)) {
      continue;
    }
    reached.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      queue.push(nextNodeId(edge));
    }
  }
  return reached;
}

export function getFlowchartValidationIssues(
  diagram: FlowchartDiagram,
): FlowchartValidationIssue[] {
  const issues: FlowchartValidationIssue[] = [];
  const nodeIds = new Set(diagram.nodes.map((node) => node.id));
  const { incoming, outgoing } = edgeBuckets(diagram.edges);

  if (diagram.nodes.length > FLOWCHART_MAX_NODES) {
    issues.push({
      code: "flowchart_too_large",
      ref: { kind: "diagram", id: diagram.id, path: "nodes" },
      message: `Flowchart has ${diagram.nodes.length} nodes; the supported maximum is ${FLOWCHART_MAX_NODES}.`,
      hint: "Split the workflow or combine lower-signal steps.",
    });
  }
  if (diagram.edges.length > FLOWCHART_MAX_EDGES) {
    issues.push({
      code: "flowchart_too_large",
      ref: { kind: "diagram", id: diagram.id, path: "edges" },
      message: `Flowchart has ${diagram.edges.length} edges; the supported maximum is ${FLOWCHART_MAX_EDGES}.`,
      hint: "Split the workflow or remove lower-signal connections.",
    });
  }

  for (const nodeId of duplicateValues(diagram.nodes.map((node) => node.id))) {
    issues.push({
      code: "duplicate_node_id",
      ref: { kind: "node", id: nodeId, path: "nodes" },
      message: `Node id "${nodeId}" is used more than once.`,
      hint: "Give every node a stable unique id.",
    });
  }
  for (const edgeId of duplicateValues(diagram.edges.map((edge) => edge.id))) {
    issues.push({
      code: "duplicate_edge_id",
      ref: { kind: "edge", id: edgeId, path: "edges" },
      message: `Edge id "${edgeId}" is used more than once.`,
      hint: "Give every edge a stable unique id.",
    });
  }

  for (const edge of diagram.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        code: "missing_edge_source",
        ref: { kind: "edge", id: edge.id, path: "edges.source" },
        message: `Edge "${edge.id}" references missing source node "${edge.source}".`,
        hint: "Set edge.source to one of the diagram node ids.",
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        code: "missing_edge_target",
        ref: { kind: "edge", id: edge.id, path: "edges.target" },
        message: `Edge "${edge.id}" references missing target node "${edge.target}".`,
        hint: "Set edge.target to one of the diagram node ids.",
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        code: "self_loop",
        ref: { kind: "edge", id: edge.id },
        message: `Edge "${edge.id}" connects node "${edge.source}" to itself.`,
        hint: "Connect the edge to a different target node.",
      });
    }
  }

  const startNodes = diagram.nodes.filter((node) => node.kind === "start");
  const endNodes = diagram.nodes.filter((node) => node.kind === "end");
  if (startNodes.length === 0) {
    issues.push({
      code: "missing_start",
      ref: { kind: "diagram", id: diagram.id, path: "nodes" },
      message: "Flowchart must contain exactly one start node.",
      hint: 'Mark the first node in the flow with kind: "start".',
    });
  } else if (startNodes.length > 1) {
    issues.push({
      code: "multiple_starts",
      ref: { kind: "diagram", id: diagram.id, path: "nodes" },
      message: `Flowchart has ${startNodes.length} start nodes.`,
      hint: "Keep one start node and change the others to process, decision, or end.",
    });
  }
  if (endNodes.length === 0) {
    issues.push({
      code: "missing_end",
      ref: { kind: "diagram", id: diagram.id, path: "nodes" },
      message: "Flowchart must contain at least one end node.",
      hint: 'Add an end node or mark terminal outcomes with kind: "end".',
    });
  }

  for (const node of diagram.nodes) {
    const incomingEdges = incoming.get(node.id) ?? [];
    const outgoingEdges = outgoing.get(node.id) ?? [];
    if (node.kind === "start" && incomingEdges.length > 0) {
      issues.push({
        code: "start_has_incoming",
        ref: { kind: "node", id: node.id },
        message: `Start node "${node.id}" cannot have incoming edges.`,
        hint: "Route the start node only to later nodes.",
      });
    }
    if (node.kind === "end" && outgoingEdges.length > 0) {
      issues.push({
        code: "end_has_outgoing",
        ref: { kind: "node", id: node.id },
        message: `End node "${node.id}" cannot have outgoing edges.`,
        hint: "End nodes must be terminal outcomes.",
      });
    }
    if (node.kind !== "end" && outgoingEdges.length === 0) {
      issues.push({
        code: "missing_outgoing_edge",
        ref: { kind: "node", id: node.id },
        message: `Node "${node.id}" must have at least one outgoing edge.`,
        hint: 'Connect it to the next step, or mark it as kind: "end".',
      });
    }
    if (node.kind === "decision") {
      issues.push(...validateDecisionBranches(node, outgoingEdges));
    }
  }

  const start = startNodes.length === 1 ? startNodes[0] : undefined;
  if (start) {
    const reachable = reachableFrom(
      [start.id],
      outgoing,
      (edge) => edge.target,
    );
    for (const node of diagram.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          code: "unreachable_node",
          ref: { kind: "node", id: node.id },
          message: `Node "${node.id}" is not reachable from the start node.`,
          hint: "Connect every node to the flow that begins at the single start node.",
        });
      }
    }

    if (endNodes.length > 0) {
      const reachesEnd = reachableFrom(
        endNodes.map((node) => node.id),
        incoming,
        (edge) => edge.source,
      );
      for (const node of diagram.nodes) {
        if (
          reachable.has(node.id) &&
          !reachesEnd.has(node.id) &&
          (outgoing.get(node.id)?.length ?? 0) > 0
        ) {
          issues.push({
            code: "nonterminating_node",
            ref: { kind: "node", id: node.id },
            message: `Node "${node.id}" cannot reach an end node.`,
            hint: "Add an eventual exit from this path to an end node; retry loops are valid when they retain an exit.",
          });
        }
      }
    }
  }

  return issues.slice(0, FLOWCHART_MAX_ISSUES);
}

export class FlowchartValidationError extends DiagramValidationError {
  constructor(readonly issues: readonly FlowchartValidationIssue[]) {
    super(issues[0]?.message ?? "Flowchart failed semantic validation.");
    this.name = "FlowchartValidationError";
  }
}

export function validateFlowchartDiagram(
  diagram: FlowchartDiagram,
): FlowchartDiagram {
  const issues = getFlowchartValidationIssues(diagram);
  if (issues.length > 0) {
    throw new FlowchartValidationError(issues);
  }

  return diagram;
}

export function parseFlowchartDiagram(input: unknown): FlowchartDiagram {
  return validateFlowchartDiagram(FlowchartDiagramSchema.parse(input));
}

export const flowchartFixture = parseFlowchartDiagram({
  id: "onboarding-flow",
  title: "Sketchi onboarding decision flow",
  type: flowchartDiagramType,
  nodes: [
    { id: "prompt", label: "Prompt received", kind: "start" },
    { id: "requirements", label: "Extract requirements", kind: "process" },
    { id: "clear", label: "Scope clear?", kind: "decision" },
    { id: "draft", label: "Draft typed IR", kind: "process" },
    { id: "review", label: "Review diagram", kind: "end" },
  ],
  edges: [
    { id: "prompt-requirements", source: "prompt", target: "requirements" },
    { id: "requirements-clear", source: "requirements", target: "clear" },
    { id: "clear-draft", source: "clear", target: "draft", label: "yes" },
    {
      id: "clear-review",
      source: "clear",
      target: "review",
      label: "no",
    },
    { id: "draft-review", source: "draft", target: "review" },
  ],
  layout: {
    direction: "TB",
    edgeRouting: "orthogonal",
  },
  style: {
    accentColor: "#0f766e",
    backgroundColor: "#ffffff",
  },
});

export const pharmaBatchDispositionFlowchart = parseFlowchartDiagram({
  id: "pharma-batch-disposition",
  title: "Pharma batch disposition flow",
  type: flowchartDiagramType,
  nodes: [
    { id: "batch-received", label: "Batch received", kind: "start" },
    {
      id: "qa-review",
      label: "QA reviews Certificate of Analysis",
      kind: "process",
    },
    { id: "passes-specs", label: "Passes specs?", kind: "decision" },
    { id: "final-review", label: "QA Manager final review", kind: "process" },
    { id: "packaging", label: "Send to packaging", kind: "end" },
    { id: "investigate", label: "Investigate retesting", kind: "process" },
    { id: "reject", label: "Reject batch", kind: "end" },
  ],
  edges: [
    { id: "batch-qa", source: "batch-received", target: "qa-review" },
    { id: "qa-specs", source: "qa-review", target: "passes-specs" },
    {
      id: "specs-pass",
      source: "passes-specs",
      target: "final-review",
      label: "yes",
    },
    {
      id: "specs-investigate",
      source: "passes-specs",
      target: "investigate",
      label: "retest",
    },
    {
      id: "specs-reject",
      source: "passes-specs",
      target: "reject",
      label: "reject",
    },
    { id: "review-packaging", source: "final-review", target: "packaging" },
    { id: "investigate-review", source: "investigate", target: "final-review" },
  ],
  layout: {
    direction: "TB",
    edgeRouting: "orthogonal",
  },
  style: {
    accentColor: "#0f766e",
    backgroundColor: "#ffffff",
  },
});

export const flowchartEvaluationFixtures = [
  flowchartFixture,
  pharmaBatchDispositionFlowchart,
];
