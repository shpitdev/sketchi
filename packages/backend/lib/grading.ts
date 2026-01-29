import { readFile } from "node:fs/promises";
import { z } from "zod";
import { generateObjectWithRetry, getModel } from "./ai-utils";

const BaseGradingSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
  strengths: z.array(z.string()),
});

const FlowchartGradingSchema = BaseGradingSchema.extend({
  hasStartEnd: z.boolean().describe("Start/end nodes use oval/ellipse shapes"),
  hasDecisionDiamonds: z
    .boolean()
    .describe("Decision points use diamond shapes"),
  flowDirection: z.enum(["top-to-bottom", "left-to-right", "mixed", "unclear"]),
  arrowsConnectEdges: z
    .boolean()
    .describe("Arrows connect to node edges, not centers"),
  noOverlappingNodes: z.boolean().describe("No nodes overlap each other"),
  labelsReadable: z
    .boolean()
    .describe("All labels are readable and not cut off"),
});

const ArchitectureGradingSchema = BaseGradingSchema.extend({
  hasLayeredStructure: z
    .boolean()
    .describe("Components are organized in logical layers/tiers"),
  usesElbowConnectors: z
    .boolean()
    .describe("Connections use elbow/right-angle paths"),
  groupingClear: z
    .boolean()
    .describe("Related components are visually grouped"),
  flowDirection: z.enum([
    "top-to-bottom",
    "left-to-right",
    "bidirectional",
    "unclear",
  ]),
  arrowsConnectEdges: z
    .boolean()
    .describe("Arrows connect to node edges, not centers"),
  noOverlappingNodes: z.boolean().describe("No nodes overlap each other"),
  labelsReadable: z.boolean().describe("All labels are readable"),
});

const DecisionTreeGradingSchema = BaseGradingSchema.extend({
  flowsTopToBottom: z.boolean().describe("Tree flows from top to bottom"),
  decisionsDiamond: z.boolean().describe("Decision points use diamond shapes"),
  branchesLabeled: z
    .boolean()
    .describe("Decision branches have Yes/No or condition labels"),
  symmetricBranching: z
    .boolean()
    .describe("Left/right branches are reasonably symmetric"),
  depthConsistent: z
    .boolean()
    .describe("Same-level nodes are at similar vertical positions"),
  noOverlappingNodes: z.boolean().describe("No nodes overlap each other"),
  arrowsConnectEdges: z.boolean().describe("Arrows connect to node edges"),
});

const MindMapGradingSchema = BaseGradingSchema.extend({
  hasCentralTopic: z
    .boolean()
    .describe("Central topic is clearly identifiable in center"),
  radialLayout: z.boolean().describe("Branches radiate outward from center"),
  branchesDistinct: z
    .boolean()
    .describe("Each main branch has distinct color/style"),
  hierarchyClear: z
    .boolean()
    .describe("Parent-child relationships are visually clear"),
  noOverlappingNodes: z.boolean().describe("No nodes overlap each other"),
  labelsReadable: z.boolean().describe("All labels are readable"),
});

export type FlowchartGrading = z.infer<typeof FlowchartGradingSchema>;
export type ArchitectureGrading = z.infer<typeof ArchitectureGradingSchema>;
export type DecisionTreeGrading = z.infer<typeof DecisionTreeGradingSchema>;
export type MindMapGrading = z.infer<typeof MindMapGradingSchema>;

type ChartType = "flowchart" | "architecture" | "decision-tree" | "mindmap";

const GRADING_PROMPTS: Record<ChartType, string> = {
  flowchart: `You are evaluating a FLOWCHART diagram. Grade it on these specific criteria:

LAYOUT REQUIREMENTS:
- Flow should be either top-to-bottom OR left-to-right (not mixed/diagonal)
- Start/End nodes should use oval/ellipse shapes
- Decision points should use diamond shapes  
- Arrows should connect to node EDGES (top/bottom/left/right), NOT to centers
- Nodes should NOT overlap each other
- All labels must be fully readable (not truncated)

SCORING GUIDE:
- 90-100: Perfect or near-perfect adherence to all conventions
- 70-89: Good structure with minor issues (e.g., 1-2 arrows misaligned)
- 50-69: Recognizable but has significant layout problems
- Below 50: Major issues - overlapping, unreadable, wrong flow direction`,

  architecture: `You are evaluating an ARCHITECTURE diagram. Grade it on these specific criteria:

LAYOUT REQUIREMENTS:
- Components should be organized in logical LAYERS (e.g., presentation→business→data)
- Connections should use ELBOW/RIGHT-ANGLE paths (not straight diagonal lines)
- Related components should be visually grouped together
- Arrows should connect to node EDGES, not centers
- Nodes should NOT overlap
- Data flow direction should be clear (typically top-to-bottom or left-to-right)

SCORING GUIDE:
- 90-100: Clean layered architecture with elbow connectors and clear grouping
- 70-89: Good layers but straight-line connectors or minor grouping issues
- 50-69: Components present but poor layout or confusing connections
- Below 50: No clear structure, overlapping, or unreadable`,

  "decision-tree": `You are evaluating a DECISION TREE diagram. Grade it on these specific criteria:

LAYOUT REQUIREMENTS:
- Tree MUST flow TOP-TO-BOTTOM (root at top, leaves at bottom)
- Decision points MUST use diamond shapes
- Each decision branch MUST be labeled (Yes/No, True/False, or condition text)
- Left/right branches should be reasonably symmetric
- Nodes at the same depth should be at similar vertical positions
- No overlapping nodes
- Arrows connect to edges, not centers

SCORING GUIDE:
- 90-100: Perfect tree structure with labeled branches and symmetric layout
- 70-89: Good structure but missing some labels or slight asymmetry
- 50-69: Tree structure recognizable but flows sideways or has unlabeled branches
- Below 50: Not a proper tree layout, major overlaps, or unreadable`,

  mindmap: `You are evaluating a MIND MAP diagram. Grade it on these specific criteria:

LAYOUT REQUIREMENTS:
- Central topic must be clearly in the CENTER
- Branches must RADIATE OUTWARD from the center (not all to one side)
- Each main branch should have a DISTINCT color or style
- Parent-child hierarchy must be visually clear
- No overlapping nodes
- All labels readable

SCORING GUIDE:
- 90-100: Beautiful radial layout with distinct branch colors and clear hierarchy
- 70-89: Good radial structure but colors not distinct or some overlap
- 50-69: Central topic present but branches don't radiate properly
- Below 50: No clear center, or looks like a tree/flowchart instead of mind map`,
};

function getSchemaForType(chartType: ChartType) {
  switch (chartType) {
    case "flowchart":
      return FlowchartGradingSchema;
    case "architecture":
      return ArchitectureGradingSchema;
    case "decision-tree":
      return DecisionTreeGradingSchema;
    case "mindmap":
      return MindMapGradingSchema;
    default:
      return FlowchartGradingSchema;
  }
}

const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";

export async function gradeByChartType(
  chartType: ChartType,
  prompt: string,
  pngPath: string
): Promise<{ grading: Record<string, unknown>; tokens?: number }> {
  const envModel = process.env.VISION_MODEL_NAME?.trim();
  const visionModel =
    envModel && envModel.length > 0 ? envModel : DEFAULT_VISION_MODEL;
  const pngBuffer = await readFile(pngPath);
  const base64Png = pngBuffer.toString("base64");

  const schema = getSchemaForType(chartType);
  const gradingPrompt = GRADING_PROMPTS[chartType];

  const result = await generateObjectWithRetry({
    model: getModel(visionModel),
    schema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${gradingPrompt}

ORIGINAL PROMPT: "${prompt}"

Evaluate the diagram image and provide:
1. A score from 0-100 based on the scoring guide above
2. Specific boolean checks for each requirement
3. List of issues found
4. List of strengths`,
          },
          {
            type: "image",
            image: base64Png,
          },
        ],
      },
    ],
    timeoutMs: 60_000,
    maxRetries: 2,
  });

  return {
    grading: result.object as Record<string, unknown>,
    tokens: result.usage?.totalTokens,
  };
}
