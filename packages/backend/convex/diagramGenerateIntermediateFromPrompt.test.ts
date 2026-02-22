/**
 * E2E Test: Prompt → Diagram → Share Link → PNG
 *
 * Tests the full pipeline from natural language prompt to rendered PNG:
 * 1. diagrams.generateDiagram - converts prompt to diagram + share link
 * 2. renderDiagramToPng - renders to PNG via Playwright
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { config as loadEnv } from "dotenv";
import { describe, expect, test } from "vitest";
import { closeBrowser, renderDiagramToPng } from "../lib/render-png";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnv({ path: join(repoRoot, ".env.e2e") });

const t = convexTest(schema, modules);

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryMdPath = join(outputDir, "prompt-intermediate-summary.md");

const requiredEnv = ["OPENROUTER_API_KEY"] as const;

interface Scenario {
  name: string;
  prompt: string;
  slug: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "SME interview transcript (pharma batch disposition)",
    slug: "pharma-interview",
    prompt: `I'm interviewing a pharma manufacturing SME about their batch disposition process. 
SME: First, we receive the batch from production with all the test data. 
Then QA reviews the Certificate of Analysis. 
If it passes specs, we move to final review. 
If it fails, we either investigate for retesting or reject the batch outright. 
Final review is done by QA Manager who makes the disposition decision. 
After approval, it goes to packaging.`,
  },
  {
    name: "Rambling technical narration with mid-course correction",
    slug: "rambling-tech",
    prompt: `So I want to build a microservices architecture, starting with a user service 
that handles authentication... actually, let's make that an API gateway first 
that routes to different services. Then we have user service, product service, 
and... wait, we should also have an order service. All of these connect to 
separate databases. Oh, and add a caching layer between services and databases 
using Redis.`,
  },
  {
    name: "Adversarial edge case (very short prompt)",
    slug: "short-prompt",
    prompt: "user login flow",
  },
];

interface ScenarioResult {
  createdAt: string;
  durationMs: number;
  edgeCount?: number;
  error?: string;
  jsonFile?: string;
  nodeCount?: number;
  pngFile?: string;
  pngSizeBytes?: number;
  scenario: string;
  shareUrl?: string;
  slug: string;
  status: "passed" | "failed";
  stepDurationsMs?: {
    generateDiagram?: number;
    renderPng?: number;
  };
  tokens?: number;
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

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const startedAt = Date.now();
  const slug = `prompt-intermediate-${scenario.slug}`;

  const jsonFile = `${slug}.json`;
  const pngFile = `${slug}.png`;
  const stepDurationsMs: NonNullable<ScenarioResult["stepDurationsMs"]> = {};

  try {
    const generateDiagramStart = Date.now();
    // Step 1: Generate diagram (includes intermediate + share link)
    const diagResult = await t.action(api.diagrams.generateDiagram, {
      prompt: scenario.prompt,
    });
    stepDurationsMs.generateDiagram = Date.now() - generateDiagramStart;

    // Validate intermediate has nodes and edges
    if (
      !diagResult.intermediate.nodes ||
      diagResult.intermediate.nodes.length === 0
    ) {
      throw new Error("Intermediate has no nodes");
    }

    // Validate share URL format
    if (!diagResult.shareLink.url.startsWith("https://excalidraw.com/#json=")) {
      throw new Error(`Invalid share URL format: ${diagResult.shareLink.url}`);
    }

    const renderPngStart = Date.now();
    // Step 2: Render PNG
    const chartType =
      diagResult.intermediate.graphOptions?.diagramType ?? "flowchart";
    const pngResult = await renderDiagramToPng(diagResult.diagram, {
      chartType: chartType as "flowchart" | "architecture" | "decision-tree",
    });
    stepDurationsMs.renderPng = Date.now() - renderPngStart;

    console.log(
      `[${scenario.slug}] timings(ms): diagram=${stepDurationsMs.generateDiagram}, png=${stepDurationsMs.renderPng}`
    );

    // Validate PNG size
    if (pngResult.png.length < 1024) {
      throw new Error(`PNG too small: ${pngResult.png.length} bytes`);
    }

    // Step 5: Save artifacts
    const jsonPath = join(outputDir, jsonFile);
    const pngPath = join(outputDir, pngFile);

    await writeJson(jsonPath, {
      scenario: scenario.name,
      prompt: scenario.prompt,
      shareUrl: diagResult.shareLink.url,
      intermediate: diagResult.intermediate,
      tokens: diagResult.stats.tokens,
      durationMs: diagResult.stats.durationMs,
      stepDurationsMs,
      traceId: diagResult.stats.traceId,
    });

    await writePng(pngPath, pngResult.png);

    return {
      scenario: scenario.name,
      slug: scenario.slug,
      status: "passed",
      durationMs: Date.now() - startedAt,
      stepDurationsMs,
      tokens: diagResult.stats.tokens,
      nodeCount: diagResult.intermediate.nodes.length,
      edgeCount: diagResult.intermediate.edges.length,
      shareUrl: diagResult.shareLink.url,
      pngSizeBytes: pngResult.png.length,
      jsonFile,
      pngFile,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await writeJson(join(outputDir, `${slug}-error.json`), {
      scenario: scenario.name,
      prompt: scenario.prompt,
      error: message,
      createdAt: new Date().toISOString(),
    });

    return {
      scenario: scenario.name,
      slug: scenario.slug,
      status: "failed",
      durationMs: Date.now() - startedAt,
      stepDurationsMs,
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

  const lines: string[] = [
    "# Prompt to Diagram E2E Test Results",
    "",
    `- Pass rate: ${passed}/${total}`,
    `- Created: ${createdAt}`,
    "",
    "## Summary Table",
    "",
    "| Scenario | Status | Tokens | Duration | Nodes | Edges | PNG Size | Share URL |",
    "|----------|--------|--------|----------|-------|-------|----------|-----------|",
  ];

  for (const result of results) {
    const status = result.status === "passed" ? "PASS" : "FAIL";
    const tokens = result.tokens ?? "n/a";
    const duration = `${result.durationMs}ms`;
    const nodes = result.nodeCount ?? "n/a";
    const edges = result.edgeCount ?? "n/a";
    const pngSize = result.pngSizeBytes
      ? `${Math.round(result.pngSizeBytes / 1024)}KB`
      : "n/a";
    const shareUrl = result.shareUrl
      ? `[${result.scenario} diagram](${result.shareUrl})`
      : "n/a";

    lines.push(
      `| ${result.scenario} | ${status} | ${tokens} | ${duration} | ${nodes} | ${edges} | ${pngSize} | ${shareUrl} |`
    );
  }

  lines.push("");
  lines.push("## Scenario Details");
  lines.push("");

  for (const result of results) {
    lines.push(`### ${result.scenario}`);
    lines.push(`- Status: ${result.status}`);
    lines.push(`- Duration: ${result.durationMs}ms`);
    if (result.stepDurationsMs) {
      lines.push(
        `- Step durations: diagram=${result.stepDurationsMs.generateDiagram ?? "n/a"}ms, png=${result.stepDurationsMs.renderPng ?? "n/a"}ms`
      );
    }
    lines.push(`- Tokens: ${result.tokens ?? "n/a"}`);
    lines.push(`- Nodes: ${result.nodeCount ?? "n/a"}`);
    lines.push(`- Edges: ${result.edgeCount ?? "n/a"}`);
    lines.push(
      `- PNG Size: ${result.pngSizeBytes ? `${result.pngSizeBytes} bytes` : "n/a"}`
    );
    lines.push(`- JSON: ${result.jsonFile ?? "n/a"}`);
    lines.push(`- PNG: ${result.pngFile ?? "n/a"}`);
    lines.push(
      `- Share URL: ${
        result.shareUrl
          ? `[${result.scenario} diagram](${result.shareUrl})`
          : "n/a"
      }`
    );
    lines.push(`- Error: ${result.error ?? "none"}`);
    lines.push(`- Created: ${result.createdAt}`);
    lines.push("");
  }

  await writeFile(summaryMdPath, lines.join("\n"));
}

const hasRequiredEnv = requiredEnv.every((key) => process.env[key]);

describe.sequential("prompt to diagram E2E", () => {
  test.skipIf(!hasRequiredEnv)(
    "full pipeline across prompts",
    async () => {
      try {
        const results: ScenarioResult[] = [];
        for (const scenario of SCENARIOS) {
          results.push(await runScenario(scenario));
        }

        await writeSummary(results);

        const failures = results.filter((result) => result.status !== "passed");
        // Allow up to 1 failure - LLM-based generation has inherent variance
        expect(failures.length).toBeLessThanOrEqual(1);
      } finally {
        await closeBrowser();
      }
    },
    300_000
  );
});
