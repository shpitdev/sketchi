import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnv({ path: join(repoRoot, ".env.e2e") });

const t = convexTest(schema, modules);
const exportApi = api.export;

const scenario = "browserbase exportDiagramPng returns valid PNG";
const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const outputSlug = scenario
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");
const outputPngName = `${outputSlug}.png`;
const outputPngPath = join(outputDir, outputPngName);
const reportJsonPath = join(outputDir, "browserbase-export.json");
const reportMdPath = join(outputDir, "browserbase-export.md");

async function writeReport(report: Record<string, unknown>) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(reportJsonPath, JSON.stringify(report, null, 2));
  await writeFile(
    reportMdPath,
    [
      "# Browserbase Export Test",
      "",
      `- Scenario: ${report.scenario}`,
      `- Status: ${report.status}`,
      `- Output file: ${report.outputFile ?? "n/a"}`,
      `- Dimensions: ${report.dimensions ?? "n/a"}`,
      `- Format: ${report.format ?? "n/a"}`,
      `- Duration: ${report.durationMs ?? "n/a"}ms`,
      `- Error: ${report.error ?? "none"}`,
      `- Created: ${report.createdAt}`,
      "",
    ].join("\n")
  );
}

test("browserbase exportDiagramPng returns valid PNG", async () => {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!(apiKey && projectId)) {
    const report = {
      scenario,
      status: "failed",
      outputFile: outputPngName,
      error: "Missing Browserbase credentials (BROWSERBASE_API_KEY/PROJECT_ID)",
      createdAt: new Date().toISOString(),
    };
    await writeReport(report);
    throw new Error(report.error);
  }

  const testDiagram = {
    shapes: [
      {
        id: "start",
        type: "rectangle",
        label: { text: "Start" },
        width: 150,
        height: 60,
      },
      {
        id: "end",
        type: "rectangle",
        label: { text: "End" },
        width: 150,
        height: 60,
      },
    ],
    arrows: [
      {
        id: "arrow1",
        fromId: "start",
        toId: "end",
      },
    ],
  };

  try {
    const result = await t.action(exportApi.exportDiagramPng, {
      diagram: testDiagram,
      options: { chartType: "flowchart" },
    });

    expect(result.pngBase64.length).toBeGreaterThan(100);

    const pngBuffer = Buffer.from(result.pngBase64, "base64");
    const metadata = await sharp(pngBuffer).metadata();

    if (!(metadata.width && metadata.height)) {
      throw new Error("PNG metadata missing width or height");
    }

    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error(
        `Invalid PNG dimensions: ${metadata.width}x${metadata.height} (minimum 100x100)`
      );
    }

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPngPath, pngBuffer);

    const report = {
      scenario,
      status: "passed",
      outputFile: outputPngName,
      dimensions: `${metadata.width}x${metadata.height}`,
      format: metadata.format ?? "unknown",
      durationMs: result.durationMs,
      createdAt: new Date().toISOString(),
    };
    await writeReport(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = {
      scenario,
      status: "failed",
      outputFile: outputPngName,
      error: message,
      createdAt: new Date().toISOString(),
    };
    await writeReport(report);
    throw error;
  }
}, 120_000);
