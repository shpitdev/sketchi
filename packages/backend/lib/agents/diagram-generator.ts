import { generateObjectWithRetry, getModel } from "../ai-utils";
import type { IntermediateFormat } from "../diagram-intermediate";
import { convertIntermediateToDiagram } from "../diagram-layout";
import { type Diagram, DiagramSchema } from "../diagram-structure";
import { CHART_VISUAL_SPECS } from "../prompts/chart-specs";

const DEFAULT_CHART_PROMPT = `Generate a diagram:
- Use rectangles for main components
- Use ellipses for external entities or start/end points
- Use diamonds for decision points
- Connect related elements with arrows
- Apply colors to group related items`;

function getChartPrompt(chartType: string): string {
  return CHART_VISUAL_SPECS[chartType]?.trim() ?? DEFAULT_CHART_PROMPT;
}

export interface DiagramGeneratorOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export interface DiagramGeneratorResult {
  diagram: Diagram;
  tokens?: number;
  durationMs: number;
}

export async function generateDiagram(
  intermediate: IntermediateFormat,
  options: DiagramGeneratorOptions = {}
): Promise<DiagramGeneratorResult> {
  const { timeoutMs = 60_000, maxRetries = 2 } = options;
  const start = Date.now();

  const chartType = intermediate.graphOptions?.diagramType ?? "flowchart";
  const chartPrompt = getChartPrompt(chartType);

  const systemPrompt = `You are a diagram element generator. Convert the provided components and relationships into precise diagram elements.

${chartPrompt}

Rules:
- Every shape needs a unique id
- Arrow fromId/toId must reference valid shape ids
- Preserve all component labels exactly
- Apply colors from the input if provided
- Use appropriate shapes based on component context`;

  const userPrompt = `Convert this to diagram elements:

Chart Type: ${chartType}
Layout: ${intermediate.graphOptions?.layout?.direction || "TB"}

Components:
${intermediate.nodes.map((n) => `- ${n.id}: "${n.label}" (kind: ${n.kind || "default"})`).join("\n")}

Relationships:
${intermediate.edges.map((r) => `- ${r.fromId} -> ${r.toId}${r.label ? ` [${r.label}]` : ""}`).join("\n")}`;

  const result = await generateObjectWithRetry({
    model: getModel(),
    schema: DiagramSchema,
    system: systemPrompt,
    prompt: userPrompt,
    timeoutMs,
    maxRetries,
  });

  return {
    diagram: result.object as Diagram,
    tokens: result.usage?.totalTokens,
    durationMs: Date.now() - start,
  };
}

export function generateDiagramDirect(
  intermediate: IntermediateFormat
): Diagram {
  return convertIntermediateToDiagram(intermediate);
}
