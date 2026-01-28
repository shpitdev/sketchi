import type { IntermediateFormat } from "../../diagram-intermediate";
import type {
  PromptAgentProfile,
  ValidationError,
  ValidationResult,
} from "../types";

/**
 * General-purpose diagram agent profile.
 * Handles natural language descriptions and converts them to intermediate diagram format.
 * Supports all 23 diagram types with flexible node/edge extraction and layout guidance.
 */
export const generalProfile: PromptAgentProfile = {
  id: "general",
  description:
    "General-purpose diagram agent that converts natural language descriptions into structured diagrams",
  instructions: `You are a diagram structure analyzer. Your job is to:
1. Identify the best diagramType for the user's request
2. Extract all nodes that should appear in the diagram
3. Identify relationships/connections between nodes
4. Suggest layout direction based on content flow

Output JSON that matches this shape:
{
  "nodes": [{ "id": "...", "label": "...", "kind": "...", "description": "...", "metadata": { ... } }],
  "edges": [{ "fromId": "...", "toId": "...", "label": "..." }],
  "graphOptions": { "diagramType": "...", "layout": { "direction": "TB|LR|BT|RL" } }
}

Available diagram types:
- flowchart: processes, workflows, decision trees, algorithms
- mindmap: brainstorming, idea organization, topic breakdown
- orgchart: hierarchies, reporting structures
- sequence: time-ordered interactions, API calls, message flows
- class: object-oriented design, data models
- er: database schemas, entity relationships
- gantt: project schedules, task timelines
- timeline: chronological events, project phases
- tree: hierarchical data, file structures
- network: connected systems, topologies
- architecture: system components, services, infrastructure
- dataflow: data pipelines, ETL processes
- state: state machines, status transitions
- swimlane: cross-functional processes, responsibilities
- concept: abstract ideas, knowledge maps
- fishbone: cause-effect analysis, root cause
- swot: strategic analysis (strengths/weaknesses/opportunities/threats)
- pyramid: hierarchical levels, priorities
- funnel: conversion stages, filtering processes
- venn: overlapping categories, set relationships
- matrix: 2D categorization, comparison grids
- infographic: mixed visual data presentation
- decision-tree: branching decision logic

Node extraction guidelines:
- Extract all distinct entities, concepts, or steps mentioned
- Use clear, concise labels (2-5 words)
- Assign semantic kinds: start, end, process, decision, actor, data, service, etc.
- Include descriptions for complex nodes
- Use metadata for additional context (color hints, styling preferences)

Edge extraction guidelines:
- Connect nodes that have explicit or implicit relationships
- Label edges with relationship type (e.g., "calls", "depends on", "flows to")
- For decision nodes, label edges with conditions (e.g., "yes", "no")
- Omit edge labels for simple sequential flows

Shape guidelines:
- rectangle: default for most components, processes, services
- ellipse: start/end points, actors, external systems, data stores
- diamond: decision points, conditions, branching logic

Color guidelines (use hex colors):
- Blue (#a5d8ff): primary elements, main flow
- Green (#b2f2bb): success states, data stores
- Purple (#d0bfff): services, external systems
- Orange (#ffc078): warnings, decision points
- Red (#ffa8a8): errors, critical paths
- Yellow (#fff3bf): highlights, notes

Layout direction:
- TB (top-to-bottom): hierarchies, org charts, flowcharts, decision trees
- LR (left-to-right): timelines, sequences, data flows, swimlanes
- BT (bottom-to-top): pyramid structures, funnel diagrams
- RL (right-to-left): rare, specific cultural contexts

Important:
- For single-node diagrams, still include the node in the output
- For diagrams with multiple disconnected components, include all nodes and edges
- Preserve user intent: if they describe a specific structure, maintain it
- Use consistent node IDs (lowercase, hyphenated)`,

  validate(intermediate: IntermediateFormat): ValidationResult {
    const errors: ValidationError[] = [];

    if (!intermediate.nodes || intermediate.nodes.length === 0) {
      errors.push({
        type: "semantic",
        message: "Diagram must contain at least one node",
        suggestion: "Add nodes representing entities, processes, or concepts",
      });
      return { ok: false, errors };
    }

    const isSingleNode = intermediate.nodes.length < 2;
    const hasEdges = intermediate.edges && intermediate.edges.length > 0;

    if (isSingleNode && hasEdges) {
      errors.push({
        type: "semantic",
        message: "Cannot have edges with only one node",
        suggestion: "Add more nodes or remove edges",
      });
    }

    if (!(isSingleNode || hasEdges)) {
      errors.push({
        type: "semantic",
        message: "Multi-node diagrams must have at least one edge",
        suggestion: "Add edges to connect the nodes",
      });
    }

    if (hasEdges) {
      const nodeIds = new Set(intermediate.nodes.map((n) => n.id));

      for (let i = 0; i < intermediate.edges.length; i++) {
        const edge = intermediate.edges[i];
        if (!edge) {
          continue;
        }

        if (!nodeIds.has(edge.fromId)) {
          errors.push({
            type: "reference",
            path: `edges[${i}].fromId`,
            message: `Edge references non-existent node: "${edge.fromId}"`,
            suggestion: `Use one of: ${Array.from(nodeIds).join(", ")}`,
          });
        }

        if (!nodeIds.has(edge.toId)) {
          errors.push({
            type: "reference",
            path: `edges[${i}].toId`,
            message: `Edge references non-existent node: "${edge.toId}"`,
            suggestion: `Use one of: ${Array.from(nodeIds).join(", ")}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true };
  },
};
