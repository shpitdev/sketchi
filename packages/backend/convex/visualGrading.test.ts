/**
 * TEST SCENARIO: Visual grading (Convex)
 *
 * - Simple flowchart: Start -> Process -> End
 * - Architecture diagram: Frontend -> API Gateway -> Backend -> Database
 * - Decision tree: Login -> Check credentials -> valid/invalid branches
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { config as loadEnv } from "dotenv";
import { describe, expect, test } from "vitest";
import { analyzeContent } from "../experiments/agents/content-analyzer";
import { gradeByChartType } from "../experiments/lib/grading";
import {
  closeBrowser,
  renderDiagramToPng,
} from "../experiments/lib/render-png";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnv({ path: join(repoRoot, ".env.e2e") });

const t = convexTest(schema, modules);
const diagramsApi = api.diagramGenerateFromIntermediate;

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryJsonPath = join(outputDir, "visual-grading.json");
const summaryMdPath = join(outputDir, "visual-grading.md");

const requiredEnv = ["AI_GATEWAY_API_KEY"] as const;

type ChartType = "flowchart" | "architecture" | "decision-tree";

interface Scenario {
  name: string;
  prompt: string;
  chartType: ChartType;
  minScore: number;
  layoutDirection: "TB" | "LR";
}

const SCENARIOS: Scenario[] = [
  {
    name: "Simple flowchart",
    prompt:
      "Create a flowchart with three steps: Start, Process, End. Connect them with arrows.",
    chartType: "flowchart",
    minScore: 70,
    layoutDirection: "LR",
  },
  {
    name: "Architecture diagram",
    prompt:
      "Draw an architecture with: Frontend, API Gateway, Backend Service, Database. Show connections between each layer.",
    chartType: "architecture",
    minScore: 70,
    layoutDirection: "TB",
  },
  {
    name: "Decision tree",
    prompt:
      "Create a decision flowchart: User logs in -> Check credentials -> If valid: Show dashboard, If invalid: Show error",
    chartType: "decision-tree",
    minScore: 60,
    layoutDirection: "TB",
  },
];

interface ScenarioResult {
  scenario: string;
  status: "passed" | "failed";
  durationMs: number;
  chartType: ChartType;
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
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function ensureOutputDir() {
  await mkdir(outputDir, { recursive: true });
}

async function writeJson(path: string, data: unknown) {
  await ensureOutputDir();
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function writePng(path: string, data: Buffer) {
  await ensureOutputDir();
  await writeFile(path, data);
}

function normalizeIntermediate(
  intermediate: IntermediateFormat,
  scenario: Scenario
): IntermediateFormat {
  const layout = intermediate.graphOptions?.layout ?? {};
  const graphOptions = {
    ...intermediate.graphOptions,
    diagramType: scenario.chartType,
    layout: {
      ...layout,
      direction: scenario.layoutDirection ?? layout.direction ?? "TB",
    },
  };

  return ensureEdgeNodes({ ...intermediate, graphOptions });
}

function ensureEdgeNodes(intermediate: IntermediateFormat): IntermediateFormat {
  const nodeIds = new Set(intermediate.nodes.map((node) => node.id));
  const missingIds = new Set<string>();
  const blankEdges: Array<{
    index: number;
    fromId: string;
    toId: string;
  }> = [];

  for (const [index, edge] of intermediate.edges.entries()) {
    const fromId = edge.fromId ?? "";
    const toId = edge.toId ?? "";
    if (fromId.trim().length === 0 || toId.trim().length === 0) {
      blankEdges.push({ index, fromId, toId });
      continue;
    }
    if (!nodeIds.has(fromId)) {
      missingIds.add(fromId);
    }
    if (!nodeIds.has(toId)) {
      missingIds.add(toId);
    }
  }

  if (blankEdges.length > 0) {
    throw new Error(
      `Invalid edge ids in ensureEdgeNodes: ${blankEdges
        .map(
          (edge) =>
            `edges[${edge.index}] fromId=${JSON.stringify(edge.fromId)} toId=${JSON.stringify(edge.toId)}`
        )
        .join(", ")}`
    );
  }

  if (missingIds.size === 0) {
    return intermediate;
  }

  const addedNodes = [...missingIds]
    .filter((id) => id.trim().length > 0)
    .map((id) => ({
      id,
      label: id
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
      kind: "process" as const,
    }));

  return {
    ...intermediate,
    nodes: [...intermediate.nodes, ...addedNodes],
  };
}

function readScore(grading: Record<string, unknown>): number | undefined {
  const score = grading.score;
  if (typeof score === "number") {
    return score;
  }
  if (typeof score === "string") {
    const parsed = Number(score);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const slug = slugify(scenario.name);

  const intermediateFile = `visual-grading-${slug}-intermediate.json`;
  const diagramFile = `visual-grading-${slug}-diagram.json`;
  const pngFile = `visual-grading-${slug}.png`;
  const gradingFile = `visual-grading-${slug}-grading.json`;

  try {
    const analysis = await analyzeContent(scenario.prompt);
    const intermediate = normalizeIntermediate(analysis.intermediate, scenario);

    const result = await t.action(diagramsApi.generateDiagramFromIntermediate, {
      intermediate,
    });

    const renderResult = await renderDiagramToPng(result.diagram, {
      chartType: scenario.chartType,
    });

    const pngPath = join(outputDir, pngFile);
    await writePng(pngPath, renderResult.png);

    const gradingResult = await gradeByChartType(
      scenario.chartType,
      scenario.prompt,
      pngPath
    );

    const grading = gradingResult.grading as Record<string, unknown>;
    const score = readScore(grading);
    const passed = typeof score === "number" && score >= scenario.minScore;

    await writeJson(join(outputDir, intermediateFile), {
      scenario: scenario.name,
      prompt: scenario.prompt,
      intermediate,
      analysisTokens: analysis.tokens,
      durationMs: analysis.durationMs,
    });

    await writeJson(join(outputDir, diagramFile), {
      scenario: scenario.name,
      prompt: scenario.prompt,
      diagram: result.diagram,
      stats: result.stats,
    });

    await writeJson(join(outputDir, gradingFile), {
      scenario: scenario.name,
      prompt: scenario.prompt,
      chartType: scenario.chartType,
      grading,
      tokens: gradingResult.tokens,
    });

    return {
      scenario: scenario.name,
      status: passed ? "passed" : "failed",
      durationMs: Date.now() - startedAt,
      chartType: scenario.chartType,
      minScore: scenario.minScore,
      score,
      issues: Array.isArray(grading.issues)
        ? (grading.issues as string[])
        : undefined,
      strengths: Array.isArray(grading.strengths)
        ? (grading.strengths as string[])
        : undefined,
      analysisTokens: analysis.tokens,
      gradingTokens: gradingResult.tokens,
      renderDurationMs: renderResult.durationMs,
      intermediateFile,
      diagramFile,
      pngFile,
      gradingFile,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await writeJson(join(outputDir, `visual-grading-${slug}-error.json`), {
      scenario: scenario.name,
      chartType: scenario.chartType,
      error: message,
      createdAt: new Date().toISOString(),
    });

    return {
      scenario: scenario.name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      chartType: scenario.chartType,
      minScore: scenario.minScore,
      error: message,
      createdAt: new Date().toISOString(),
    };
  }
}

async function writeSummary(results: ScenarioResult[]) {
  await ensureOutputDir();
  const passed = results.filter((result) => result.status === "passed").length;
  const total = results.length;
  const createdAt = new Date().toISOString();

  await writeJson(summaryJsonPath, {
    createdAt,
    passRate: `${passed}/${total}`,
    scenarios: results,
  });

  const lines: string[] = [
    "# Visual Grading (Convex)",
    "",
    `- Pass rate: ${passed}/${total}`,
    `- Created: ${createdAt}`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.scenario}`);
    lines.push(`- Status: ${result.status}`);
    lines.push(`- Chart type: ${result.chartType}`);
    lines.push(`- Score: ${result.score ?? "n/a"} (min ${result.minScore})`);
    lines.push(`- Render duration: ${result.renderDurationMs ?? "n/a"}ms`);
    lines.push(`- Analysis tokens: ${result.analysisTokens ?? "n/a"}`);
    lines.push(`- Grading tokens: ${result.gradingTokens ?? "n/a"}`);
    lines.push(`- Intermediate: ${result.intermediateFile ?? "n/a"}`);
    lines.push(`- Diagram: ${result.diagramFile ?? "n/a"}`);
    lines.push(`- PNG: ${result.pngFile ?? "n/a"}`);
    lines.push(`- Grading: ${result.gradingFile ?? "n/a"}`);
    lines.push(`- Issues: ${result.issues?.join("; ") ?? "none"}`);
    lines.push(`- Strengths: ${result.strengths?.join("; ") ?? "none"}`);
    lines.push(`- Error: ${result.error ?? "none"}`);
    lines.push(`- Created: ${result.createdAt}`);
    lines.push("");
  }

  await writeFile(summaryMdPath, lines.join("\n"));
}

describe.sequential("visual grading", () => {
  test("vision grading across prompts", async () => {
    const missingEnv = requiredEnv.filter((key) => !process.env[key]);

    if (missingEnv.length > 0) {
      const message = `Missing required env: ${missingEnv.join(", ")}`;
      const failureResults = SCENARIOS.map((scenario) => ({
        scenario: scenario.name,
        status: "failed" as const,
        durationMs: 0,
        chartType: scenario.chartType,
        minScore: scenario.minScore,
        error: message,
        createdAt: new Date().toISOString(),
      }));
      await writeSummary(failureResults);
      return;
    }

    try {
      const results = await Promise.all(
        SCENARIOS.map((scenario) => runScenario(scenario))
      );

      await writeSummary(results);

      const failures = results.filter((result) => result.status !== "passed");
      expect(failures.length).toBe(0);
    } finally {
      await closeBrowser();
    }
  }, 240_000);
});
