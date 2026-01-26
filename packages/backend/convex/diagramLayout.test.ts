/**
 * TEST SCENARIO: Deterministic diagram layout
 *
 * - Flowchart layout with LR direction
 * - Architecture layout defaults to elbow routing
 * - Architecture layout override forces straight routing
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import {
  getLayoutDirection,
  layoutIntermediateDiagram,
} from "../lib/diagram-layout";
import { convertLayoutedToExcalidraw } from "../lib/excalidraw-elements";

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryJsonPath = join(outputDir, "diagram-layout.json");
const summaryMdPath = join(outputDir, "diagram-layout.md");

interface ScenarioSummary {
  scenario: string;
  status: "passed" | "failed";
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

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw error;
  }
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

  const lines: string[] = ["# Diagram Layout", ""];
  for (const summary of summaries) {
    lines.push(`## ${summary.scenario}`);
    lines.push(`- Status: ${summary.status}`);
    lines.push(`- Duration: ${summary.durationMs}ms`);
    lines.push(`- Diagram type: ${summary.diagramType ?? "n/a"}`);
    lines.push(`- Layout direction: ${summary.layoutDirection ?? "n/a"}`);
    lines.push(`- Edge routing: ${summary.edgeRouting ?? "n/a"}`);
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
      arrows: { fromId: string; toId: string; elbowed?: boolean }[];
    };
    layouted: {
      shapes: { id: string; x: number; y: number }[];
      arrows: { elbowed: boolean }[];
    };
    elements: Record<string, unknown>[];
  }) => void
) {
  const startedAt = Date.now();
  const artifactSlug = slugify(scenario);
  const artifactFile = `diagram-layout-${artifactSlug}.json`;
  const artifactPath = join(outputDir, artifactFile);
  const existingSummary = (await readJsonIfExists<{
    scenarios: ScenarioSummary[];
  }>(summaryJsonPath)) ?? { scenarios: [] };

  try {
    const { diagram, layouted, diagramType, layoutOverrides } =
      layoutIntermediateDiagram(intermediate);
    const elements = convertLayoutedToExcalidraw(layouted);
    const resolvedDirection =
      layoutOverrides?.direction ?? getLayoutDirection(diagramType);
    const resolvedEdgeRouting =
      layoutOverrides?.edgeRouting ??
      (layouted.arrows.some((arrow) => arrow.elbowed) ? "elbow" : "straight");

    validate({ diagram, layouted, elements });

    await mkdir(outputDir, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          scenario,
          durationMs: Date.now() - startedAt,
          intermediate,
          diagram,
          layouted,
          diagramType,
          layoutOverrides,
          elementCount: elements.length,
        },
        null,
        2
      )
    );

    const summary: ScenarioSummary = {
      scenario,
      status: "passed",
      durationMs: Date.now() - startedAt,
      diagramType,
      layoutDirection: resolvedDirection,
      edgeRouting: resolvedEdgeRouting,
      artifactFile,
      nodeCount: intermediate.nodes.length,
      edgeCount: intermediate.edges.length,
      shapeCount: diagram.shapes.length,
      arrowCount: diagram.arrows.length,
      elementCount: elements.length,
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

describe.sequential("diagramLayout", () => {
  test("flowchart LR straight", async () => {
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

    await runScenario("Flowchart LR straight", intermediate, (result) => {
      expect(result.layouted.shapes.length).toBeGreaterThanOrEqual(3);
      expect(result.layouted.arrows.length).toBeGreaterThanOrEqual(2);
      expect(result.layouted.arrows.every((arrow) => !arrow.elbowed)).toBe(
        true
      );
      expect(result.elements.length).toBeGreaterThanOrEqual(5);
    });
  });

  test("architecture elbow by default", async () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "client", label: "Client", kind: "external" },
        { id: "lb", label: "Load Balancer", kind: "process" },
        { id: "api", label: "API Service", kind: "process" },
        { id: "db", label: "Database", kind: "database" },
      ],
      edges: [
        { fromId: "client", toId: "lb" },
        { fromId: "lb", toId: "api" },
        { fromId: "api", toId: "db" },
      ],
      graphOptions: {
        diagramType: "architecture",
        layout: { direction: "TB" },
      },
    };

    await runScenario("Architecture default elbow", intermediate, (result) => {
      expect(result.layouted.arrows.length).toBeGreaterThanOrEqual(3);
      expect(result.layouted.arrows.some((arrow) => arrow.elbowed)).toBe(true);
      expect(result.elements.length).toBeGreaterThanOrEqual(7);
    });
  });

  test("architecture override straight", async () => {
    const intermediate: IntermediateFormat = {
      nodes: [
        { id: "client", label: "Client", kind: "external" },
        { id: "lb", label: "Load Balancer", kind: "process" },
        { id: "api", label: "API Service", kind: "process" },
        { id: "db", label: "Database", kind: "database" },
      ],
      edges: [
        { fromId: "client", toId: "lb" },
        { fromId: "lb", toId: "api" },
        { fromId: "api", toId: "db" },
      ],
      graphOptions: {
        diagramType: "architecture",
        layout: { direction: "TB", edgeRouting: "straight" },
      },
    };

    await runScenario(
      "Architecture override straight",
      intermediate,
      (result) => {
        expect(result.layouted.arrows.length).toBeGreaterThanOrEqual(3);
        expect(result.layouted.arrows.every((arrow) => !arrow.elbowed)).toBe(
          true
        );
        expect(result.elements.length).toBeGreaterThanOrEqual(7);
      }
    );
  });
});
