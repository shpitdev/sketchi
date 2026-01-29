/**
 * TEST SCENARIO: Arrow optimization (deterministic routing)
 *
 * - IntermediateFormat input -> layouted arrows -> Excalidraw bindings
 * - Arrow endpoints snap to node edges (not centers)
 * - PNG artifacts saved for baseline vs optimized output
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  closeBrowser,
  renderElementsToPng,
} from "../experiments/lib/render-png";
import type { IntermediateFormat } from "../lib/diagram-intermediate";
import { layoutIntermediateDiagram } from "../lib/diagram-layout";
import type {
  LayoutedDiagram,
  PositionedArrow,
  PositionedShape,
} from "../lib/diagram-layout-types";
import { convertLayoutedToExcalidraw } from "../lib/excalidraw-elements";

type Edge = "left" | "right" | "top" | "bottom";

interface Scenario {
  name: string;
  intermediate: IntermediateFormat;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Flowchart LR straight",
    intermediate: {
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
    },
  },
  {
    name: "Architecture TB elbow",
    intermediate: {
      nodes: [
        { id: "client", label: "Client", kind: "external" },
        { id: "lb", label: "Load Balancer", kind: "process" },
        { id: "api", label: "API", kind: "process" },
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
    },
  },
  {
    name: "Diagonal fan-in",
    intermediate: {
      nodes: [
        { id: "north", label: "North", kind: "process" },
        { id: "south", label: "South", kind: "process" },
        { id: "core", label: "Core", kind: "process" },
      ],
      edges: [
        { fromId: "north", toId: "core" },
        { fromId: "south", toId: "core" },
      ],
      graphOptions: {
        diagramType: "flowchart",
        layout: { direction: "LR" },
      },
    },
  },
];
const SCENARIO_NAMES = new Set(SCENARIOS.map((scenario) => scenario.name));

const outputDir = fileURLToPath(new URL("../test-results", import.meta.url));
const summaryJsonPath = join(outputDir, "arrow-optimization.json");
const summaryMdPath = join(outputDir, "arrow-optimization.md");

interface ScenarioSummary {
  scenario: string;
  status: "passed" | "failed";
  durationMs: number;
  arrowCount?: number;
  beforePng?: string;
  afterPng?: string;
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

  const lines: string[] = ["# Arrow Optimization", ""];
  for (const summary of summaries) {
    lines.push(`## ${summary.scenario}`);
    lines.push(`- Status: ${summary.status}`);
    lines.push(`- Duration: ${summary.durationMs}ms`);
    lines.push(`- Arrows: ${summary.arrowCount ?? "n/a"}`);
    lines.push(`- Before PNG: ${summary.beforePng ?? "n/a"}`);
    lines.push(`- After PNG: ${summary.afterPng ?? "n/a"}`);
    lines.push(`- Artifact: ${summary.artifactFile ?? "n/a"}`);
    lines.push(`- Error: ${summary.error ?? "none"}`);
    lines.push(`- Created: ${summary.createdAt}`);
    lines.push("");
  }

  await writeFile(summaryMdPath, lines.join("\n"));
}

function determineEdges(
  startShape: PositionedShape,
  endShape: PositionedShape
): { startEdge: Edge; endEdge: Edge } {
  const startCenter = {
    x: startShape.x + startShape.width / 2,
    y: startShape.y + startShape.height / 2,
  };
  const endCenter = {
    x: endShape.x + endShape.width / 2,
    y: endShape.y + endShape.height / 2,
  };

  const dx = startCenter.x - endCenter.x;
  const dy = startCenter.y - endCenter.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { startEdge: "left", endEdge: "right" }
      : { startEdge: "right", endEdge: "left" };
  }
  return dy > 0
    ? { startEdge: "top", endEdge: "bottom" }
    : { startEdge: "bottom", endEdge: "top" };
}

function getEdgeCenter(
  shape: PositionedShape,
  edge: Edge
): { x: number; y: number } {
  switch (edge) {
    case "left":
      return { x: shape.x, y: shape.y + shape.height / 2 };
    case "right":
      return { x: shape.x + shape.width, y: shape.y + shape.height / 2 };
    case "top":
      return { x: shape.x + shape.width / 2, y: shape.y };
    case "bottom":
      return { x: shape.x + shape.width / 2, y: shape.y + shape.height };
    default:
      return { x: shape.x + shape.width, y: shape.y + shape.height / 2 };
  }
}

function getShapeCenter(shape: PositionedShape): { x: number; y: number } {
  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
  };
}

function buildBaselineElements(
  layouted: LayoutedDiagram,
  optimizedElements: Record<string, unknown>[]
): Record<string, unknown>[] {
  const shapeMap = new Map(layouted.shapes.map((shape) => [shape.id, shape]));

  return optimizedElements.map((element) => {
    if (element.type !== "arrow") {
      return element;
    }

    const startBinding = element.startBinding as
      | { elementId?: string }
      | undefined;
    const endBinding = element.endBinding as { elementId?: string } | undefined;
    const startShape = startBinding?.elementId
      ? shapeMap.get(startBinding.elementId)
      : undefined;
    const endShape = endBinding?.elementId
      ? shapeMap.get(endBinding.elementId)
      : undefined;

    if (!(startShape && endShape)) {
      return element;
    }

    const startCenter = getShapeCenter(startShape);
    const endCenter = getShapeCenter(endShape);
    const deltaX = endCenter.x - startCenter.x;
    const deltaY = endCenter.y - startCenter.y;

    return {
      ...element,
      x: startCenter.x,
      y: startCenter.y,
      width: deltaX,
      height: deltaY,
      points: [
        [0, 0],
        [deltaX, deltaY],
      ],
      elbowed: false,
    };
  });
}

function expectArrowOptimized(
  arrow: PositionedArrow,
  shapeMap: Map<string, PositionedShape>
) {
  const startShape = shapeMap.get(arrow.fromId);
  const endShape = shapeMap.get(arrow.toId);
  if (!(startShape && endShape)) {
    throw new Error("Missing shapes for arrow optimization check");
  }

  const { startEdge, endEdge } = determineEdges(startShape, endShape);
  const startPoint = getEdgeCenter(startShape, startEdge);
  const endPoint = getEdgeCenter(endShape, endEdge);

  // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
  expect(arrow.x).toBe(startPoint.x);
  // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
  expect(arrow.y).toBe(startPoint.y);
  // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
  expect(arrow.width).toBe(endPoint.x - startPoint.x);
  // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
  expect(arrow.height).toBe(endPoint.y - startPoint.y);

  // biome-ignore lint/style/useAtIndex: Array.at not available in Convex tsconfig
  const lastPoint = arrow.points[arrow.points.length - 1];
  // biome-ignore lint/suspicious/noMisplacedAssertion: assertions in helper called from test()
  expect(lastPoint).toEqual([
    endPoint.x - startPoint.x,
    endPoint.y - startPoint.y,
  ]);
}

async function runScenario(scenario: Scenario) {
  const startedAt = Date.now();
  const slug = slugify(scenario.name);
  const beforePng = `arrow-optimization-${slug}-before.png`;
  const afterPng = `arrow-optimization-${slug}-after.png`;
  const artifactFile = `arrow-optimization-${slug}.json`;
  const artifactPath = join(outputDir, artifactFile);

  const existingSummary = (await readJsonIfExists<{
    scenarios: ScenarioSummary[];
  }>(summaryJsonPath)) ?? { scenarios: [] };

  try {
    const { layouted } = layoutIntermediateDiagram(scenario.intermediate);
    const optimizedElements = convertLayoutedToExcalidraw(layouted);
    const baselineElements = buildBaselineElements(layouted, optimizedElements);

    const beforeRender = await renderElementsToPng(baselineElements, {
      scale: 2,
      padding: 24,
      background: true,
    });
    const afterRender = await renderElementsToPng(optimizedElements, {
      scale: 2,
      padding: 24,
      background: true,
    });

    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, beforePng), beforeRender.png);
    await writeFile(join(outputDir, afterPng), afterRender.png);

    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          scenario: scenario.name,
          intermediate: scenario.intermediate,
          layouted,
          baselineElements,
          optimizedElements,
        },
        null,
        2
      )
    );

    const summary: ScenarioSummary = {
      scenario: scenario.name,
      status: "passed",
      durationMs: Date.now() - startedAt,
      arrowCount: layouted.arrows.length,
      beforePng,
      afterPng,
      artifactFile,
      createdAt: new Date().toISOString(),
    };

    const merged = [
      ...existingSummary.scenarios.filter(
        (s) => s.scenario !== scenario.name && SCENARIO_NAMES.has(s.scenario)
      ),
      summary,
    ];
    await writeSummary(merged);

    const shapeMap = new Map(layouted.shapes.map((shape) => [shape.id, shape]));
    for (const arrow of layouted.arrows) {
      expectArrowOptimized(arrow, shapeMap);
    }
  } catch (error) {
    const summary: ScenarioSummary = {
      scenario: scenario.name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      artifactFile,
      error: error instanceof Error ? error.message : String(error),
      createdAt: new Date().toISOString(),
    };

    const merged = [
      ...existingSummary.scenarios.filter(
        (s) => s.scenario !== scenario.name && SCENARIO_NAMES.has(s.scenario)
      ),
      summary,
    ];
    await writeSummary(merged);

    throw error;
  }
}

describe.sequential("arrow optimization", () => {
  test("deterministic routing snaps arrow endpoints to edges", async () => {
    try {
      for (const scenario of SCENARIOS) {
        await runScenario(scenario);
      }
    } finally {
      await closeBrowser();
    }
  }, 120_000);
});
