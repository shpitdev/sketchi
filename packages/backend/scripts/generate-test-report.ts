import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface VitestSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: Array<{
    assertionResults: Array<{
      fullName: string;
      status: string;
      duration?: number;
    }>;
    name: string;
  }>;
  startTime?: number;
  success?: boolean;
}

const outputDir = join(process.cwd(), "test-results");
const vitestPath = join(outputDir, "vitest.json");
const shareLinksPath = join(outputDir, "excalidraw-share-links.json");
const browserbasePath = join(outputDir, "browserbase-export.json");
const diagramGeneratePath = join(
  outputDir,
  "diagram-generate-from-intermediate.json"
);
const diagramLayoutPath = join(outputDir, "diagram-layout.json");
const arrowOptimizationPath = join(outputDir, "arrow-optimization.json");
const visualGradingPath = join(outputDir, "visual-grading.json");
const diagramModifyPath = join(outputDir, "diagram-modify.json");
const summaryPath = join(outputDir, "summary.md");

function formatDuration(ms?: number) {
  if (!ms || Number.isNaN(ms)) {
    return "-";
  }
  return `${ms.toFixed(0)}ms`;
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const vitest = await readJsonIfExists<VitestSummary>(vitestPath);
const shareLinks = await readJsonIfExists<{
  scenario: string;
  shareId: string;
  url: string;
  elementsCount: number;
  elementTypes?: string[];
  appStateKeys: string[];
  createdAt: string;
}>(shareLinksPath);

const browserbase = await readJsonIfExists<{
  scenario: string;
  status: string;
  outputFile?: string;
  dimensions?: string;
  format?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
}>(browserbasePath);
const diagramGenerate = await readJsonIfExists<{
  scenarios: Array<{
    scenario: string;
    status: string;
    durationMs: number;
    artifactFile?: string;
    nodeCount?: number;
    edgeCount?: number;
    shapeCount?: number;
    arrowCount?: number;
    elementCount?: number;
    error?: string;
    createdAt: string;
  }>;
}>(diagramGeneratePath);
const diagramLayout = await readJsonIfExists<{
  scenarios: Array<{
    scenario: string;
    status: string;
    durationMs: number;
    diagramType?: string;
    layoutDirection?: string;
    edgeRouting?: string;
    nodeCount?: number;
    edgeCount?: number;
    shapeCount?: number;
    arrowCount?: number;
    elementCount?: number;
    artifactFile?: string;
    error?: string;
    createdAt: string;
  }>;
}>(diagramLayoutPath);
const arrowOptimization = await readJsonIfExists<{
  scenarios: Array<{
    scenario: string;
    status: string;
    durationMs: number;
    startEdge?: string;
    endEdge?: string;
    beforePng?: string;
    afterPng?: string;
    artifactFile?: string;
    error?: string;
    createdAt: string;
  }>;
}>(arrowOptimizationPath);
const visualGrading = await readJsonIfExists<{
  createdAt: string;
  passRate: string;
  scenarios: Array<{
    scenario: string;
    status: string;
    durationMs: number;
    chartType: string;
    minScore: number;
    score?: number;
    issues?: string[];
    strengths?: string[];
    analysisTokens?: number;
    gradingTokens?: number;
    renderDurationMs?: number;
    intermediateFile?: string;
    diagramFile?: string;
    pngFile?: string;
    gradingFile?: string;
    error?: string;
    createdAt: string;
  }>;
}>(visualGradingPath);

const diagramModify = await readJsonIfExists<{
  scenarios: Array<{
    scenario: string;
    status: string;
    durationMs: number;
    request: string;
    artifactFile?: string;
    beforePng?: string;
    afterPng?: string;
    visionStatus?: string;
    visionTokens?: number;
    shareUrl?: string;
    elementCount?: number;
    issues?: string[];
    tokens?: number;
    iterations?: number;
    error?: string;
    createdAt: string;
  }>;
}>(diagramModifyPath);

await mkdir(outputDir, { recursive: true });

const lines: string[] = [];
lines.push("# Test Summary");
lines.push("");

if (vitest) {
  lines.push("## Vitest Results");
  lines.push("");
  lines.push(
    `- Total: ${vitest.numTotalTests} | Passed: ${vitest.numPassedTests} | Failed: ${vitest.numFailedTests} | Pending: ${vitest.numPendingTests}`
  );
  lines.push("");
  lines.push("| Test | Status | Duration |");
  lines.push("| --- | --- | --- |");

  for (const file of vitest.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      lines.push(
        `| ${test.fullName} | ${test.status} | ${formatDuration(test.duration)} |`
      );
    }
  }
  lines.push("");
}

if (shareLinks) {
  lines.push("## Excalidraw Share Link");
  lines.push("");
  lines.push(`- Scenario: ${shareLinks.scenario}`);
  lines.push(`- Share ID: ${shareLinks.shareId}`);
  lines.push(`- URL: ${shareLinks.url}`);
  lines.push(`- Elements: ${shareLinks.elementsCount}`);
  if (shareLinks.elementTypes?.length) {
    lines.push(`- Element types: ${shareLinks.elementTypes.join(", ")}`);
  }
  lines.push(
    `- AppState keys: ${shareLinks.appStateKeys.join(", ") || "none"}`
  );
  lines.push(`- Created: ${shareLinks.createdAt}`);
  lines.push("");
}

if (browserbase) {
  lines.push("## Browserbase Export");
  lines.push("");
  lines.push(`- Scenario: ${browserbase.scenario}`);
  lines.push(`- Status: ${browserbase.status}`);
  lines.push(`- Output file: ${browserbase.outputFile ?? "n/a"}`);
  lines.push(`- Dimensions: ${browserbase.dimensions ?? "n/a"}`);
  lines.push(`- Format: ${browserbase.format ?? "n/a"}`);
  lines.push(`- Duration: ${browserbase.durationMs ?? "n/a"}ms`);
  lines.push(`- Error: ${browserbase.error ?? "none"}`);
  lines.push(`- Created: ${browserbase.createdAt}`);
  lines.push("");
}

if (diagramGenerate) {
  lines.push("## Diagram Generate From Intermediate");
  lines.push("");

  for (const scenario of diagramGenerate.scenarios ?? []) {
    lines.push(`- Scenario: ${scenario.scenario}`);
    lines.push(`  - Status: ${scenario.status}`);
    lines.push(`  - Duration: ${scenario.durationMs}ms`);
    lines.push(`  - Nodes: ${scenario.nodeCount ?? "n/a"}`);
    lines.push(`  - Edges: ${scenario.edgeCount ?? "n/a"}`);
    lines.push(`  - Shapes: ${scenario.shapeCount ?? "n/a"}`);
    lines.push(`  - Arrows: ${scenario.arrowCount ?? "n/a"}`);
    lines.push(`  - Elements: ${scenario.elementCount ?? "n/a"}`);
    lines.push(`  - Artifact: ${scenario.artifactFile ?? "n/a"}`);
    lines.push(`  - Error: ${scenario.error ?? "none"}`);
    lines.push(`  - Created: ${scenario.createdAt}`);
  }

  lines.push("");
}

if (diagramLayout) {
  lines.push("## Diagram Layout");
  lines.push("");

  for (const scenario of diagramLayout.scenarios ?? []) {
    lines.push(`- Scenario: ${scenario.scenario}`);
    lines.push(`  - Status: ${scenario.status}`);
    lines.push(`  - Duration: ${scenario.durationMs}ms`);
    lines.push(`  - Diagram type: ${scenario.diagramType ?? "n/a"}`);
    lines.push(`  - Layout direction: ${scenario.layoutDirection ?? "n/a"}`);
    lines.push(`  - Edge routing: ${scenario.edgeRouting ?? "n/a"}`);
    lines.push(`  - Nodes: ${scenario.nodeCount ?? "n/a"}`);
    lines.push(`  - Edges: ${scenario.edgeCount ?? "n/a"}`);
    lines.push(`  - Shapes: ${scenario.shapeCount ?? "n/a"}`);
    lines.push(`  - Arrows: ${scenario.arrowCount ?? "n/a"}`);
    lines.push(`  - Elements: ${scenario.elementCount ?? "n/a"}`);
    lines.push(`  - Artifact: ${scenario.artifactFile ?? "n/a"}`);
    lines.push(`  - Error: ${scenario.error ?? "none"}`);
    lines.push(`  - Created: ${scenario.createdAt}`);
  }

  lines.push("");
}

if (arrowOptimization) {
  lines.push("## Arrow Optimization");
  lines.push("");

  for (const scenario of arrowOptimization.scenarios ?? []) {
    lines.push(`- Scenario: ${scenario.scenario}`);
    lines.push(`  - Status: ${scenario.status}`);
    lines.push(`  - Duration: ${scenario.durationMs}ms`);
    lines.push(`  - Start edge: ${scenario.startEdge ?? "n/a"}`);
    lines.push(`  - End edge: ${scenario.endEdge ?? "n/a"}`);
    lines.push(`  - Before PNG: ${scenario.beforePng ?? "n/a"}`);
    lines.push(`  - After PNG: ${scenario.afterPng ?? "n/a"}`);
    lines.push(`  - Artifact: ${scenario.artifactFile ?? "n/a"}`);
    lines.push(`  - Error: ${scenario.error ?? "none"}`);
    lines.push(`  - Created: ${scenario.createdAt}`);
  }

  lines.push("");
}

if (visualGrading) {
  lines.push("## Visual Grading");
  lines.push("");
  lines.push(`- Pass rate: ${visualGrading.passRate}`);
  lines.push(`- Created: ${visualGrading.createdAt}`);
  lines.push("");

  for (const scenario of visualGrading.scenarios ?? []) {
    lines.push(`- Scenario: ${scenario.scenario}`);
    lines.push(`  - Status: ${scenario.status}`);
    lines.push(`  - Chart type: ${scenario.chartType}`);
    lines.push(
      `  - Score: ${scenario.score ?? "n/a"} (min ${scenario.minScore})`
    );
    lines.push(`  - Duration: ${scenario.durationMs}ms`);
    lines.push(`  - Render: ${scenario.renderDurationMs ?? "n/a"}ms`);
    lines.push(`  - Analysis tokens: ${scenario.analysisTokens ?? "n/a"}`);
    lines.push(`  - Grading tokens: ${scenario.gradingTokens ?? "n/a"}`);
    lines.push(`  - PNG: ${scenario.pngFile ?? "n/a"}`);
    lines.push(`  - Grading: ${scenario.gradingFile ?? "n/a"}`);
    lines.push(
      `  - Issues: ${scenario.issues?.length ? scenario.issues.join("; ") : "none"}`
    );
    lines.push(
      `  - Strengths: ${scenario.strengths?.length ? scenario.strengths.join("; ") : "none"}`
    );
    lines.push(`  - Error: ${scenario.error ?? "none"}`);
    lines.push(`  - Created: ${scenario.createdAt}`);
  }

  lines.push("");
}

if (diagramModify) {
  lines.push("## Diagram Modification");
  lines.push("");

  for (const scenario of diagramModify.scenarios ?? []) {
    lines.push(`- Scenario: ${scenario.scenario}`);
    lines.push(`  - Status: ${scenario.status}`);
    lines.push(`  - Duration: ${scenario.durationMs}ms`);
    lines.push(`  - Elements: ${scenario.elementCount ?? "n/a"}`);
    lines.push(`  - Iterations: ${scenario.iterations ?? "n/a"}`);
    lines.push(`  - Tokens: ${scenario.tokens ?? "n/a"}`);
    lines.push(`  - Request: ${scenario.request}`);
    lines.push(`  - Share URL: ${scenario.shareUrl ?? "n/a"}`);
    lines.push(`  - Before PNG: ${scenario.beforePng ?? "n/a"}`);
    lines.push(`  - After PNG: ${scenario.afterPng ?? "n/a"}`);
    lines.push(`  - Vision: ${scenario.visionStatus ?? "n/a"}`);
    lines.push(`  - Vision tokens: ${scenario.visionTokens ?? "n/a"}`);
    lines.push(`  - Artifact: ${scenario.artifactFile ?? "n/a"}`);
    lines.push(`  - Issues: ${scenario.issues?.join("; ") ?? "none"}`);
    lines.push(`  - Error: ${scenario.error ?? "none"}`);
    lines.push(`  - Created: ${scenario.createdAt}`);
  }

  lines.push("");
}

if (
  !(
    vitest ||
    shareLinks ||
    browserbase ||
    diagramGenerate ||
    diagramLayout ||
    visualGrading
  )
) {
  lines.push("No test results found.");
  lines.push("");
}

await writeFile(summaryPath, lines.join("\n"));
