import { generateObjectWithRetry, getModel } from "../lib/ai-utils";
import { CHART_TYPE_NAMES } from "../lib/prompts";
import {
  type IntermediateFormat,
  IntermediateFormatSchema,
} from "../lib/schemas";

const chartTypeList = Object.entries(CHART_TYPE_NAMES)
  .filter(([key]) => key !== "auto")
  .map(([key, name]) => `- ${key}: ${name}`)
  .join("\n");

const CONTENT_ANALYZER_PROMPT = `You are a diagram structure analyzer. Your job is to:
1. Identify the best chart type for the user's request
2. Extract all components/nodes that should appear in the diagram
3. Identify relationships/connections between components
4. Suggest layout direction based on content flow

Available chart types:
${chartTypeList}

Chart type selection guidelines:
- flowchart: processes, workflows, decision trees, algorithms
- architecture: system components, services, infrastructure
- orgchart: hierarchies, reporting structures
- mindmap: brainstorming, idea organization, topic breakdown
- sequence: time-ordered interactions, API calls, message flows
- class: object-oriented design, data models
- er: database schemas, entity relationships
- state: state machines, status transitions
- swimlane: cross-functional processes, responsibilities
- tree: hierarchical data, file structures
- network: connected systems, topologies
- dataflow: data pipelines, ETL processes
- timeline: chronological events, project phases
- concept: abstract ideas, knowledge maps
- fishbone: cause-effect analysis, root cause
- swot: strategic analysis (strengths/weaknesses/opportunities/threats)
- pyramid: hierarchical levels, priorities
- funnel: conversion stages, filtering processes
- venn: overlapping categories, set relationships
- matrix: 2D categorization, comparison grids
- gantt: project schedules, task timelines
- infographic: mixed visual data presentation

Shape guidelines:
- rectangle: default for most components
- ellipse: start/end points, actors, external systems
- diamond: decision points, conditions

Color guidelines (use hex colors):
- Blue (#a5d8ff): primary elements, main flow
- Green (#b2f2bb): success states, data stores
- Purple (#d0bfff): services, external systems
- Orange (#ffc078): warnings, decision points
- Red (#ffa8a8): errors, critical paths
- Yellow (#fff3bf): highlights, notes

Layout direction:
- TB (top-to-bottom): hierarchies, org charts, flowcharts
- LR (left-to-right): timelines, sequences, data flows
- BT (bottom-to-top): pyramid structures
- RL (right-to-left): rare, specific cultural contexts`;

export interface ContentAnalyzerOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ContentAnalyzerResult {
  intermediate: IntermediateFormat;
  tokens?: number;
  durationMs: number;
}

export async function analyzeContent(
  userPrompt: string,
  options: ContentAnalyzerOptions = {}
): Promise<ContentAnalyzerResult> {
  const { timeoutMs = 60_000, maxRetries = 2 } = options;
  const start = Date.now();

  const result = await generateObjectWithRetry({
    model: getModel(),
    schema: IntermediateFormatSchema,
    system: CONTENT_ANALYZER_PROMPT,
    prompt: userPrompt,
    timeoutMs,
    maxRetries,
  });

  return {
    intermediate: result.object as IntermediateFormat,
    tokens: result.usage?.totalTokens,
    durationMs: Date.now() - start,
  };
}
