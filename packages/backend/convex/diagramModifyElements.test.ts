// Why: exercise element-diff validation, share-link round trips, and failure handling.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { config as loadEnv } from "dotenv";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { generateObjectWithRetry, getModel } from "../experiments/lib/ai-utils";
import {
  closeBrowser,
  renderElementsToPng,
} from "../experiments/lib/render-png";
import { validateElements } from "../lib/diagram-modification";
import { api } from "./_generated/api";
import {
  createExcalidrawShareLink,
  parseExcalidrawShareLink,
} from "./lib/excalidrawShareLinks";
import schema from "./schema";
import { modules } from "./test.setup";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnv({ path: join(repoRoot, ".env.e2e") });

const requiredEnv = ["AI_GATEWAY_API_KEY"] as const;
const hasRequiredEnv = requiredEnv.every((key) => process.env[key]);

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryJsonPath = join(outputDir, "diagram-modify.json");
const summaryMdPath = join(outputDir, "diagram-modify.md");

const t = convexTest(schema, modules);

interface ScenarioSummary {
  scenario: string;
  status: "passed" | "failed";
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
}

const scenarioSummaries: ScenarioSummary[] = [];

async function ensureOutputDir() {
  await mkdir(outputDir, { recursive: true });
}

async function writeScenarioArtifact(slug: string, data: unknown) {
  await ensureOutputDir();
  await writeFile(
    join(outputDir, `${slug}.json`),
    JSON.stringify(data, null, 2)
  );
  return `${slug}.json`;
}

async function writePng(name: string, png: Buffer) {
  await ensureOutputDir();
  const fileName = `${name}.png`;
  await writeFile(join(outputDir, fileName), png);
  return fileName;
}

async function writeSummary() {
  if (scenarioSummaries.length === 0) {
    return;
  }
  await ensureOutputDir();
  await writeFile(
    summaryJsonPath,
    JSON.stringify({ scenarios: scenarioSummaries }, null, 2)
  );

  const lines: string[] = ["# Diagram Modification", ""];
  for (const summary of scenarioSummaries) {
    lines.push(`## ${summary.scenario}`);
    lines.push(`- Status: ${summary.status}`);
    lines.push(`- Duration: ${summary.durationMs}ms`);
    lines.push(`- Elements: ${summary.elementCount ?? "n/a"}`);
    lines.push(`- Iterations: ${summary.iterations ?? "n/a"}`);
    lines.push(`- Tokens: ${summary.tokens ?? "n/a"}`);
    lines.push(`- Request: ${summary.request}`);
    lines.push(`- Share URL: ${summary.shareUrl ?? "n/a"}`);
    lines.push(`- Before PNG: ${summary.beforePng ?? "n/a"}`);
    lines.push(`- After PNG: ${summary.afterPng ?? "n/a"}`);
    lines.push(`- Vision: ${summary.visionStatus ?? "n/a"}`);
    lines.push(`- Artifact: ${summary.artifactFile ?? "n/a"}`);
    lines.push(`- Issues: ${summary.issues?.join("; ") ?? "none"}`);
    lines.push(`- Error: ${summary.error ?? "none"}`);
    lines.push(`- Created: ${summary.createdAt}`);
    lines.push("");
  }

  await writeFile(summaryMdPath, lines.join("\n"));
}

function buildBaseElements() {
  const updated = 1_725_000_100_000;
  const api = {
    id: "api",
    type: "rectangle",
    x: 80,
    y: 80,
    width: 200,
    height: 120,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: { type: 3 },
    seed: 10_201,
    version: 1,
    versionNonce: 30_201,
    isDeleted: false,
    boundElements: [
      { id: "api-text", type: "text" },
      { id: "arrow-1", type: "arrow" },
    ],
    updated,
    link: null,
    locked: false,
  };

  const apiText = {
    id: "api-text",
    type: "text",
    x: 100,
    y: 130,
    width: 160,
    height: 30,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a1",
    roundness: null,
    seed: 10_202,
    version: 1,
    versionNonce: 30_202,
    isDeleted: false,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    text: "API Server",
    fontSize: 16,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "api",
    originalText: "API Server",
    autoResize: true,
    lineHeight: 1.25,
  };

  const db = {
    id: "db",
    type: "rectangle",
    x: 400,
    y: 80,
    width: 200,
    height: 120,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a2",
    roundness: { type: 3 },
    seed: 10_203,
    version: 1,
    versionNonce: 30_203,
    isDeleted: false,
    boundElements: [
      { id: "db-text", type: "text" },
      { id: "arrow-1", type: "arrow" },
    ],
    updated,
    link: null,
    locked: false,
  };

  const dbText = {
    id: "db-text",
    type: "text",
    x: 420,
    y: 130,
    width: 160,
    height: 30,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a3",
    roundness: null,
    seed: 10_205,
    version: 1,
    versionNonce: 30_205,
    isDeleted: false,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    text: "Database",
    fontSize: 16,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: "db",
    originalText: "Database",
    autoResize: true,
    lineHeight: 1.25,
  };

  const arrow = {
    id: "arrow-1",
    type: "arrow",
    x: 280,
    y: 140,
    width: 120,
    height: 40,
    angle: 0,
    strokeColor: "#1971c2",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a4",
    roundness: { type: 2 },
    seed: 10_204,
    version: 1,
    versionNonce: 30_204,
    isDeleted: false,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [120, 40],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: "api", focus: 0, gap: 6 },
    endBinding: { elementId: "db", focus: 0, gap: 6 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };

  return [api, apiText, db, dbText, arrow];
}

function findElement(elements: Array<{ id: string }>, id: string) {
  return elements.find((element) => element.id === id);
}

const ModificationVisionSchema = z.object({
  apiLabelPresent: z.boolean(),
  apiIsYellow: z.boolean(),
  arrowPointsToApi: z.boolean(),
  notes: z.string().optional(),
});

async function gradeModificationPng(png: Buffer) {
  const base64 = png.toString("base64");
  const modelName =
    process.env.VISION_MODEL_NAME?.trim() || "google/gemini-2.5-flash";

  const result = await generateObjectWithRetry({
    model: getModel(modelName),
    schema: ModificationVisionSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Inspect the diagram image and answer these checks:
1) There is a rectangle labeled "API Gateway".
2) The API Gateway rectangle is yellow/gold (approx #ffd43b).
3) There is an arrow pointing from the Database box to the API Gateway box (arrowhead at API Gateway).

Return booleans only.`,
          },
          { type: "image", image: base64 },
        ],
      },
    ],
    timeoutMs: 60_000,
    maxRetries: 2,
  });

  return {
    grading: result.object,
    tokens: result.usage?.totalTokens,
  };
}

describe.sequential("diagramModifyElements scenarios", () => {
  test.skipIf(!hasRequiredEnv)(
    "Targeted tweaks (elements input)",
    async () => {
      const startedAt = Date.now();
      const elements = buildBaseElements();
      const request =
        "Modify only these ids: arrow-1, api, api-text. Do NOT change any ids and do not set changes.id. Set arrow-1 startBinding.elementId='db'. Set arrow-1 endBinding.elementId='api'. Set api backgroundColor='#ffd43b'. Set api strokeColor='#ffd43b'. Set api-text text='API Gateway'. Set api-text originalText='API Gateway'.";
      let beforePng = "n/a";

      try {
        const beforeRender = await renderElementsToPng(
          elements as Record<string, unknown>[]
        );
        beforePng = await writePng(
          "diagram-modify-targeted-fixes-before",
          beforeRender.png
        );

        let result = await t.action(
          api.diagramModifyElements.diagramModifyElements,
          {
            elements,
            request,
            options: { maxSteps: 3, preferExplicitEdits: true },
          }
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const gatewayError =
            result.status === "failed" &&
            result.reason === "error" &&
            result.issues?.some((issue: { message: string }) =>
              issue.message.includes("Gateway request failed")
            );
          if (!gatewayError) {
            break;
          }
          result = await t.action(
            api.diagramModifyElements.diagramModifyElements,
            {
              elements,
              request,
              options: { maxSteps: 3, preferExplicitEdits: true },
            }
          );
        }

        const createdAt = new Date().toISOString();
        const durationMs = Date.now() - startedAt;

        if (result.status !== "success" || !Array.isArray(result.elements)) {
          const artifactFile = await writeScenarioArtifact(
            "diagram-modify-targeted-fixes",
            {
              scenario: "Targeted tweaks (elements input)",
              status: "failed",
              request,
              result,
              createdAt,
            }
          );
          scenarioSummaries.push({
            scenario: "Targeted tweaks (elements input)",
            status: "failed",
            durationMs,
            request,
            artifactFile,
            beforePng,
            issues: result.issues?.map(
              (issue: { message: string }) => issue.message
            ),
            tokens: result.stats?.tokens,
            iterations: result.stats?.iterations,
            error: "Modification failed",
            createdAt,
          });
          await writeSummary();
          throw new Error("Modification failed");
        }

        const updatedElements = result.elements as Record<string, unknown>[];
        const afterRender = await renderElementsToPng(updatedElements);
        const afterPng = await writePng(
          "diagram-modify-targeted-fixes-after",
          afterRender.png
        );
        const vision = await gradeModificationPng(afterRender.png);
        const artifactFile = await writeScenarioArtifact(
          "diagram-modify-targeted-fixes",
          {
            scenario: "Targeted tweaks (elements input)",
            status: "passed",
            request,
            changes: result.changes,
            elementCount: updatedElements.length,
            elements: updatedElements,
            beforePng,
            afterPng,
            vision: vision.grading,
            createdAt,
          }
        );
        const arrow = findElement(
          updatedElements as Array<{ id: string }>,
          "arrow-1"
        ) as Record<string, unknown> | undefined;
        const apiRect = findElement(
          updatedElements as Array<{ id: string }>,
          "api"
        ) as Record<string, unknown> | undefined;
        const apiText = updatedElements.find(
          (element) => element.type === "text" && element.containerId === "api"
        ) as Record<string, unknown> | undefined;

        expect(arrow).toBeTruthy();
        expect(apiRect).toBeTruthy();
        expect(apiText).toBeTruthy();

        expect((arrow?.startBinding as { elementId?: string })?.elementId).toBe(
          "db"
        );
        expect((arrow?.endBinding as { elementId?: string })?.elementId).toBe(
          "api"
        );
        const apiFill = apiRect?.backgroundColor;
        const apiStroke = apiRect?.strokeColor;
        expect(apiFill === "#ffd43b" || apiStroke === "#ffd43b").toBe(true);
        expect(apiText?.text).toBe("API Gateway");
        expect(vision.grading.apiLabelPresent).toBe(true);
        expect(vision.grading.apiIsYellow).toBe(true);
        expect(vision.grading.arrowPointsToApi).toBe(true);

        const issues = validateElements(
          updatedElements as unknown as Parameters<typeof validateElements>[0]
        );
        expect(issues).toHaveLength(0);

        scenarioSummaries.push({
          scenario: "Targeted tweaks (elements input)",
          status: "passed",
          durationMs,
          request,
          artifactFile,
          beforePng,
          afterPng,
          visionStatus: vision.grading.notes ?? "passed",
          visionTokens: vision.tokens,
          elementCount: updatedElements.length,
          tokens: result.stats?.tokens,
          iterations: result.stats?.iterations,
          createdAt,
        });

        await writeSummary();
      } finally {
        await closeBrowser();
      }
    },
    240_000
  );

  test.skipIf(!hasRequiredEnv)(
    "Share link round-trip modify",
    async () => {
      const startedAt = Date.now();
      const elements = buildBaseElements();
      const request =
        "Update the Database label text to 'Postgres DB' by editing the bound text element. Do not change any other element.";

      const shareLink = await createExcalidrawShareLink(elements, {
        viewBackgroundColor: "#ffffff",
      });

      const result = await t.action(
        api.diagramModifyFromShareLink.diagramModifyFromShareLink,
        {
          url: shareLink.url,
          request,
          output: "both",
        }
      );

      const createdAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;

      if (result.status !== "success" || !Array.isArray(result.elements)) {
        const artifactFile = await writeScenarioArtifact(
          "diagram-modify-sharelink",
          {
            scenario: "Share link round-trip modify",
            status: "failed",
            request,
            result,
            createdAt,
          }
        );
        scenarioSummaries.push({
          scenario: "Share link round-trip modify",
          status: "failed",
          durationMs,
          request,
          artifactFile,
          issues: result.issues?.map(
            (issue: { message: string }) => issue.message
          ),
          tokens: result.stats?.tokens,
          iterations: result.stats?.iterations,
          error: "Modification failed",
          createdAt,
        });
        await writeSummary();
        throw new Error("Modification failed");
      }

      const shareLinkResult = result as typeof result & {
        shareLink?: { url?: string };
      };
      expect(shareLinkResult.shareLink?.url).toBeTruthy();

      const parsed = await parseExcalidrawShareLink(
        shareLinkResult.shareLink?.url ?? shareLink.url
      );
      expect(parsed.elements.length).toBe(result.elements.length);

      const dbText = (
        parsed.elements as Array<{
          type?: string;
          containerId?: string;
          text?: string;
        }>
      ).find(
        (element) => element.type === "text" && element.containerId === "db"
      );
      expect(dbText?.text).toBe("Postgres DB");

      const issues = validateElements(
        parsed.elements as unknown as Parameters<typeof validateElements>[0]
      );
      expect(issues).toHaveLength(0);

      const artifactFile = await writeScenarioArtifact(
        "diagram-modify-sharelink",
        {
          scenario: "Share link round-trip modify",
          status: "passed",
          request,
          shareUrl: shareLinkResult.shareLink?.url,
          elementCount: parsed.elements.length,
          changes: result.changes,
          createdAt,
        }
      );

      scenarioSummaries.push({
        scenario: "Share link round-trip modify",
        status: "passed",
        durationMs,
        request,
        artifactFile,
        shareUrl: shareLinkResult.shareLink?.url,
        elementCount: parsed.elements.length,
        tokens: result.stats?.tokens,
        iterations: result.stats?.iterations,
        createdAt,
      });

      await writeSummary();
    },
    240_000
  );

  test.skipIf(!hasRequiredEnv)(
    "Invalid output handling",
    async () => {
      const startedAt = Date.now();
      const elements = buildBaseElements();
      const request =
        "Remove element id 'missing-element' and do not modify any other element. This is a compliance test; do not skip the removal.";

      const result = await t.action(
        api.diagramModifyElements.diagramModifyElements,
        {
          elements,
          request,
          options: {
            maxSteps: 1,
            timeoutMs: 60_000,
          },
        }
      );

      const createdAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;

      const status = result.status === "failed" ? "passed" : "failed";
      const artifactFile = await writeScenarioArtifact(
        "diagram-modify-timeout",
        {
          scenario: "Invalid output handling",
          status,
          request,
          result,
          createdAt,
        }
      );

      scenarioSummaries.push({
        scenario: "Invalid output handling",
        status,
        durationMs,
        request,
        artifactFile,
        issues: result.issues?.map(
          (issue: { message: string }) => issue.message
        ),
        tokens: result.stats?.tokens,
        iterations: result.stats?.iterations,
        error:
          status === "failed" ? "Expected failure did not occur" : undefined,
        createdAt,
      });

      await writeSummary();

      expect(result.status).toBe("failed");
      expect(result.reason).toBe("invalid-diff");
      expect(result.issues?.length ?? 0).toBeGreaterThan(0);
    },
    240_000
  );
});
