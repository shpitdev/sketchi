/**
 * TEST SCENARIO: Convex diagramGenerateFromIntermediate
 *
 * - Simple flowchart IntermediateFormat renders to diagram + Excalidraw elements
 * - Architecture IntermediateFormat honors graphOptions style overrides
 * - Harder architecture IntermediateFormat renders without missing refs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const t = convexTest(schema, modules);
const diagramsApi = api.diagramGenerateFromIntermediate;

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryJsonPath = join(
  outputDir,
  "diagram-generate-from-intermediate.json"
);
const summaryMdPath = join(outputDir, "diagram-generate-from-intermediate.md");

interface ScenarioSummary {
  arrowCount?: number;
  artifactFile?: string;
  createdAt: string;
  durationMs: number;
  edgeCount?: number;
  elementCount?: number;
  error?: string;
  nodeCount?: number;
  scenario: string;
  shapeCount?: number;
  status: "passed" | "failed";
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  return JSON.parse(raw) as T;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function writeSummary(summaries: ScenarioSummary[]) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    summaryJsonPath,
    JSON.stringify({ scenarios: summaries }, null, 2)
  );

  const lines: string[] = ["# Diagram Generate From Intermediate", ""];
  for (const summary of summaries) {
    lines.push(`## ${summary.scenario}`);
    lines.push(`- Status: ${summary.status}`);
    lines.push(`- Duration: ${summary.durationMs}ms`);
    lines.push(`- Nodes: ${summary.nodeCount ?? "n/a"}`);
    lines.push(`- Edges: ${summary.edgeCount ?? "n/a"}`);
    lines.push(`- Shapes: ${summary.shapeCount ?? "n/a"}`);
    lines.push(`- Arrows: ${summary.arrowCount ?? "n/a"}`);
    lines.push(`- Elements: ${summary.elementCount ?? "n/a"}`);
    lines.push(`- Artifact: ${summary.artifactFile ?? "n/a"}`);
    lines.push(`- Error: ${summary.error ?? "none"}`);
    lines.push(`- Created: ${summary.createdAt}`);
    lines.push("");
  }

  await writeFile(summaryMdPath, lines.join("\n"));
}

async function runScenario(
  scenario: string,
  intermediate: IntermediateFormat,
  validate: (result: {
    diagram: {
      shapes: { id: string }[];
      arrows: { fromId: string; toId: string }[];
    };
    elements: Record<string, unknown>[];
    stats: {
      nodeCount: number;
      edgeCount: number;
      shapeCount: number;
      arrowCount: number;
    };
  }) => void
) {
  const startedAt = Date.now();
  const artifactSlug = slugify(scenario);
  const artifactFile = `diagram-generate-from-intermediate-${artifactSlug}.json`;
  const artifactPath = join(outputDir, artifactFile);
  const existingSummary = (await readJsonIfExists<{
    scenarios: ScenarioSummary[];
  }>(summaryJsonPath)) ?? { scenarios: [] };

  try {
    const result = await t.action(diagramsApi.generateDiagramFromIntermediate, {
      intermediate,
    });

    validate(result);

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          scenario,
          durationMs: Date.now() - startedAt,
          intermediate,
          diagram: result.diagram,
          stats: result.stats,
          elementCount: result.elements.length,
        },
        null,
        2
      )
    );

    const summary: ScenarioSummary = {
      scenario,
      status: "passed",
      durationMs: Date.now() - startedAt,
      artifactFile,
      nodeCount: result.stats.nodeCount,
      edgeCount: result.stats.edgeCount,
      shapeCount: result.stats.shapeCount,
      arrowCount: result.stats.arrowCount,
      elementCount: result.elements.length,
      createdAt: new Date().toISOString(),
    };

    const merged = [
      ...existingSummary.scenarios.filter((s) => s.scenario !== scenario),
      summary,
    ];
    await writeSummary(merged);
  } catch (error) {
    const summary: ScenarioSummary = {
      scenario,
      status: "failed",
      durationMs: Date.now() - startedAt,
      artifactFile,
      error: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString(),
    };

    const merged = [
      ...existingSummary.scenarios.filter((s) => s.scenario !== scenario),
      summary,
    ];
    await writeSummary(merged);

    throw error;
  }
}

describe.sequential("diagramGenerateFromIntermediate", () => {
  test("simple flowchart", async () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "start", label: "Start", kind: "start" },
        { id: "process", label: "Process", kind: "process" },
        { id: "end", label: "End", kind: "end" },
      ],
      edges: [
        { fromId: "start", toId: "process" },
        { fromId: "process", toId: "end" },
      ],
      graphOptions: {
        diagramType: "flowchart",
        layout: { direction: "LR" },
      },
    };

    await runScenario(
      "Simple flowchart IntermediateFormat",
      intermediate,
      (result) => {
        expect(result.stats.nodeCount).toBeGreaterThanOrEqual(3);
        expect(result.stats.edgeCount).toBeGreaterThanOrEqual(2);
        expect(result.diagram.shapes.length).toBeGreaterThanOrEqual(3);
        expect(result.diagram.arrows.length).toBeGreaterThanOrEqual(2);

        const shapeIds = new Set(
          result.diagram.shapes.map((shape) => shape.id)
        );
        for (const arrow of result.diagram.arrows) {
          expect(shapeIds.has(arrow.fromId)).toBe(true);
          expect(shapeIds.has(arrow.toId)).toBe(true);
        }
      }
    );
  });

  test("architecture with style overrides", async () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "lb", label: "Load Balancer", kind: "process" },
        { id: "api-1", label: "API Server 1", kind: "process" },
        { id: "api-2", label: "API Server 2", kind: "process" },
        { id: "api-3", label: "API Server 3", kind: "process" },
        { id: "db", label: "Database", kind: "database" },
      ],
      edges: [
        { fromId: "lb", toId: "api-1" },
        { fromId: "lb", toId: "api-2" },
        { fromId: "lb", toId: "api-3" },
        { fromId: "api-1", toId: "db" },
        { fromId: "api-2", toId: "db" },
        { fromId: "api-3", toId: "db" },
      ],
      graphOptions: {
        diagramType: "architecture",
        layout: { direction: "TB" },
        style: {
          shapeFill: "#e7f5ff",
          shapeStroke: "#1c7ed6",
          arrowStroke: "#1864ab",
          textColor: "#0b2e4b",
          fontSize: 14,
          fontFamily: 5,
        },
      },
    };

    await runScenario(
      "Architecture IntermediateFormat",
      intermediate,
      (result) => {
        expect(result.stats.nodeCount).toBeGreaterThanOrEqual(5);
        expect(result.stats.edgeCount).toBeGreaterThanOrEqual(6);

        const shapeElements = result.elements.filter(
          (element) =>
            element.type === "rectangle" ||
            element.type === "ellipse" ||
            element.type === "diamond"
        );
        const arrowElements = result.elements.filter(
          (element) => element.type === "arrow"
        );

        expect(shapeElements.length).toBeGreaterThanOrEqual(5);
        expect(arrowElements.length).toBeGreaterThanOrEqual(6);

        const shapeFillApplied = shapeElements.some(
          (element) => element.backgroundColor === "#e7f5ff"
        );
        const arrowStrokeApplied = arrowElements.every(
          (element) => element.strokeColor === "#1864ab"
        );

        expect(shapeFillApplied).toBe(true);
        expect(arrowStrokeApplied).toBe(true);
      }
    );
  });

  test("harder architecture scenario", async () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "clients", label: "Clients", kind: "actor" },
        { id: "cdn", label: "CDN", kind: "external" },
        { id: "lb", label: "Load Balancer", kind: "process" },
        { id: "api", label: "API Gateway", kind: "process" },
        { id: "auth", label: "Auth Service", kind: "service" },
        { id: "catalog", label: "Catalog Service", kind: "service" },
        { id: "orders", label: "Order Service", kind: "service" },
        { id: "payments", label: "Payment Service", kind: "service" },
        { id: "db", label: "Postgres", kind: "database" },
        { id: "cache", label: "Redis", kind: "cache" },
        { id: "queue", label: "Event Queue", kind: "infrastructure" },
      ],
      edges: [
        { fromId: "clients", toId: "cdn" },
        { fromId: "cdn", toId: "lb" },
        { fromId: "lb", toId: "api" },
        { fromId: "api", toId: "auth" },
        { fromId: "api", toId: "catalog" },
        { fromId: "api", toId: "orders" },
        { fromId: "orders", toId: "payments" },
        { fromId: "auth", toId: "db" },
        { fromId: "catalog", toId: "db" },
        { fromId: "orders", toId: "db" },
        { fromId: "api", toId: "cache" },
        { fromId: "orders", toId: "queue" },
      ],
      graphOptions: {
        diagramType: "architecture",
        layout: { direction: "TB", nodesep: 140, ranksep: 180 },
        style: {
          shapeFill: "#f1f3f5",
          shapeStroke: "#343a40",
          arrowStroke: "#495057",
          textColor: "#212529",
          fontSize: 14,
          fontFamily: 5,
        },
      },
    };

    await runScenario(
      "Harder architecture IntermediateFormat",
      intermediate,
      (result) => {
        expect(result.stats.nodeCount).toBeGreaterThanOrEqual(10);
        expect(result.stats.edgeCount).toBeGreaterThanOrEqual(12);

        const shapeIds = new Set(
          result.diagram.shapes.map((shape) => shape.id)
        );
        for (const arrow of result.diagram.arrows) {
          expect(shapeIds.has(arrow.fromId)).toBe(true);
          expect(shapeIds.has(arrow.toId)).toBe(true);
        }

        const shapeElements = result.elements.filter(
          (element) =>
            element.type === "rectangle" ||
            element.type === "ellipse" ||
            element.type === "diamond"
        );
        expect(shapeElements.length).toBeGreaterThanOrEqual(10);
      }
    );
  });
});
