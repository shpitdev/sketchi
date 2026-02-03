/**
 * E2E Test: Prompt → Intermediate → Diagram → Share Link → PNG
 *
 * Tests the full pipeline from natural language prompt to rendered PNG:
 * 1. generateIntermediateFromPrompt - converts prompt to IntermediateFormat
 * 2. generateDiagramFromIntermediate - converts intermediate to Excalidraw elements
 * 3. createExcalidrawShareLink - creates shareable link
 * 4. renderDiagramToPng - renders to PNG via Playwright
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { config as loadEnv } from "dotenv";
import { describe, expect, test } from "vitest";
import { closeBrowser, renderDiagramToPng } from "../lib/render-png";
import { api } from "./_generated/api";
import { createExcalidrawShareLink } from "./lib/excalidrawShareLinks";
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
  slug: string;
  prompt: string;
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
  scenario: string;
  slug: string;
  status: "passed" | "failed";
  durationMs: number;
  stepDurationsMs?: {
    generateIntermediate?: number;
    generateDiagram?: number;
    createShareLink?: number;
    renderPng?: number;
  };
  tokens?: number;
  nodeCount?: number;
  edgeCount?: number;
  shareUrl?: string;
  pngSizeBytes?: number;
  jsonFile?: string;
  pngFile?: string;
  error?: string;
  createdAt: string;
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
    const generateIntermediateStart = Date.now();
    // Step 1: Generate intermediate from prompt
    const genResult = await t.action(
      api.diagramGenerateIntermediateFromPrompt.generateIntermediateFromPrompt,
      { prompt: scenario.prompt }
    );
    stepDurationsMs.generateIntermediate =
      Date.now() - generateIntermediateStart;

    // Validate intermediate has nodes and edges
    if (
      !genResult.intermediate.nodes ||
      genResult.intermediate.nodes.length === 0
    ) {
      throw new Error("Intermediate has no nodes");
    }

    const generateDiagramStart = Date.now();
    // Step 2: Generate diagram from intermediate
    const diagResult = await t.action(
      api.diagramGenerateFromIntermediate.generateDiagramFromIntermediate,
      { intermediate: genResult.intermediate }
    );
    stepDurationsMs.generateDiagram = Date.now() - generateDiagramStart;

    const shareLinkStart = Date.now();
    // Step 3: Create share link
    const shareResult = await createExcalidrawShareLink(
      diagResult.elements,
      {}
    );
    stepDurationsMs.createShareLink = Date.now() - shareLinkStart;

    // Validate share URL format
    if (!shareResult.url.startsWith("https://excalidraw.com/#json=")) {
      throw new Error(`Invalid share URL format: ${shareResult.url}`);
    }

    const renderPngStart = Date.now();
    // Step 4: Render PNG
    const chartType =
      genResult.intermediate.graphOptions?.diagramType ?? "flowchart";
    const pngResult = await renderDiagramToPng(diagResult.diagram, {
      chartType: chartType as "flowchart" | "architecture" | "decision-tree",
    });
    stepDurationsMs.renderPng = Date.now() - renderPngStart;

    console.log(
      `[${scenario.slug}] timings(ms): intermediate=${stepDurationsMs.generateIntermediate}, diagram=${stepDurationsMs.generateDiagram}, share=${stepDurationsMs.createShareLink}, png=${stepDurationsMs.renderPng}`
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
      shareUrl: shareResult.url,
      intermediate: genResult.intermediate,
      tokens: genResult.tokens,
      durationMs: genResult.durationMs,
      stepDurationsMs,
      traceId: genResult.traceId,
    });

    await writePng(pngPath, pngResult.png);

    return {
      scenario: scenario.name,
      slug: scenario.slug,
      status: "passed",
      durationMs: Date.now() - startedAt,
      stepDurationsMs,
      tokens: genResult.tokens,
      nodeCount: genResult.intermediate.nodes.length,
      edgeCount: genResult.intermediate.edges.length,
      shareUrl: shareResult.url,
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
    "# Prompt to Intermediate E2E Test Results",
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
        `- Step durations: intermediate=${result.stepDurationsMs.generateIntermediate ?? "n/a"}ms, diagram=${result.stepDurationsMs.generateDiagram ?? "n/a"}ms, share=${result.stepDurationsMs.createShareLink ?? "n/a"}ms, png=${result.stepDurationsMs.renderPng ?? "n/a"}ms`
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

describe.sequential("prompt to intermediate E2E", () => {
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
