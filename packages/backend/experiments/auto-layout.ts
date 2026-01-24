// Experiment 0.4: Auto-Layout with Dagre
// Run: bun run packages/backend/experiments/auto-layout.ts

import dagre from "dagre";

interface ExcalidrawElement {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: { text: string };
  start?: { id: string };
  end?: { id: string };
}

interface LayoutOptions {
  rankdir?: "TB" | "BT" | "LR" | "RL";
  nodesep?: number;
  ranksep?: number;
}

function applyLayout(
  elements: ExcalidrawElement[],
  options: LayoutOptions = {}
): ExcalidrawElement[] {
  const { rankdir = "LR", nodesep = 100, ranksep = 150 } = options;

  const nodes = elements.filter((e) => e.type !== "arrow" && e.type !== "line");
  const edges = elements.filter((e) => e.type === "arrow" || e.type === "line");

  if (nodes.length === 0) {
    return elements;
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.width ?? 150,
      height: node.height ?? 80,
    });
  }

  for (const edge of edges) {
    if (edge.start?.id && edge.end?.id) {
      g.setEdge(edge.start.id, edge.end.id);
    }
  }

  dagre.layout(g);

  const positionedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) {
      return node;
    }
    return {
      ...node,
      x: pos.x - (node.width ?? 150) / 2,
      y: pos.y - (node.height ?? 80) / 2,
    };
  });

  return [...positionedNodes, ...edges];
}

function checkNoOverlap(elements: ExcalidrawElement[]): boolean {
  const nodes = elements.filter((e) => e.type !== "arrow" && e.type !== "line");

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a || a.x === undefined || a.y === undefined) {
      continue;
    }

    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (!b || b.x === undefined || b.y === undefined) {
        continue;
      }

      const aRight = a.x + (a.width ?? 150);
      const aBottom = a.y + (a.height ?? 80);
      const bRight = b.x + (b.width ?? 150);
      const bBottom = b.y + (b.height ?? 80);

      const overlapsX = a.x < bRight && aRight > b.x;
      const overlapsY = a.y < bBottom && aBottom > b.y;

      if (overlapsX && overlapsY) {
        return false;
      }
    }
  }
  return true;
}

function checkLogicalFlow(
  elements: ExcalidrawElement[],
  direction: "LR" | "TB"
): boolean {
  const nodeMap = new Map(elements.map((e) => [e.id, e]));
  const edges = elements.filter((e) => e.type === "arrow" || e.type === "line");

  for (const edge of edges) {
    const startNode = edge.start?.id ? nodeMap.get(edge.start.id) : null;
    const endNode = edge.end?.id ? nodeMap.get(edge.end.id) : null;

    if (!(startNode && endNode)) {
      continue;
    }
    if (
      startNode.x === undefined ||
      startNode.y === undefined ||
      endNode.x === undefined ||
      endNode.y === undefined
    ) {
      continue;
    }

    if (direction === "LR") {
      if (startNode.x >= endNode.x) {
        return false;
      }
    } else if (startNode.y >= endNode.y) {
      return false;
    }
  }
  return true;
}

interface TestCase {
  name: string;
  elements: ExcalidrawElement[];
  direction: "LR" | "TB";
}

const testCases: TestCase[] = [
  {
    name: "Simple chain (LR)",
    direction: "LR",
    elements: [
      { id: "a", type: "rectangle", label: { text: "Start" } },
      { id: "b", type: "rectangle", label: { text: "Process" } },
      { id: "c", type: "rectangle", label: { text: "End" } },
      { id: "e1", type: "arrow", start: { id: "a" }, end: { id: "b" } },
      { id: "e2", type: "arrow", start: { id: "b" }, end: { id: "c" } },
    ],
  },
  {
    name: "Fan-out (one to many)",
    direction: "LR",
    elements: [
      { id: "lb", type: "rectangle", label: { text: "Load Balancer" } },
      { id: "s1", type: "rectangle", label: { text: "Server 1" } },
      { id: "s2", type: "rectangle", label: { text: "Server 2" } },
      { id: "s3", type: "rectangle", label: { text: "Server 3" } },
      { id: "e1", type: "arrow", start: { id: "lb" }, end: { id: "s1" } },
      { id: "e2", type: "arrow", start: { id: "lb" }, end: { id: "s2" } },
      { id: "e3", type: "arrow", start: { id: "lb" }, end: { id: "s3" } },
    ],
  },
  {
    name: "Diamond (converge and diverge)",
    direction: "TB",
    elements: [
      { id: "top", type: "rectangle", label: { text: "Decision" } },
      { id: "left", type: "rectangle", label: { text: "Option A" } },
      { id: "right", type: "rectangle", label: { text: "Option B" } },
      { id: "bottom", type: "rectangle", label: { text: "Merge" } },
      { id: "e1", type: "arrow", start: { id: "top" }, end: { id: "left" } },
      { id: "e2", type: "arrow", start: { id: "top" }, end: { id: "right" } },
      { id: "e3", type: "arrow", start: { id: "left" }, end: { id: "bottom" } },
      {
        id: "e4",
        type: "arrow",
        start: { id: "right" },
        end: { id: "bottom" },
      },
    ],
  },
];

function testAutoLayout() {
  console.log("=== Experiment 0.4: Auto-Layout with Dagre ===\n");

  let passed = 0;
  const total = testCases.length;

  for (const tc of testCases) {
    console.log(`Test: ${tc.name}`);

    const layouted = applyLayout(tc.elements, {
      rankdir: tc.direction === "LR" ? "LR" : "TB",
    });

    const noOverlap = checkNoOverlap(layouted);
    const logicalFlow = checkLogicalFlow(layouted, tc.direction);
    const success = noOverlap && logicalFlow;

    console.log(`  - No overlapping nodes: ${noOverlap ? "YES" : "NO"}`);
    console.log(
      `  - Logical flow (${tc.direction}): ${logicalFlow ? "YES" : "NO"}`
    );

    const nodes = layouted.filter(
      (e) => e.type !== "arrow" && e.type !== "line"
    );
    console.log("  - Node positions:");
    for (const n of nodes) {
      console.log(`    ${n.id}: (${n.x?.toFixed(0)}, ${n.y?.toFixed(0)})`);
    }

    console.log(`  Result: ${success ? "PASS" : "FAIL"}\n`);

    if (success) {
      passed++;
    }
  }

  console.log("=".repeat(50));
  console.log(`SUMMARY: ${passed}/${total} tests passed`);
  console.log(`\n=== RESULT: ${passed === total ? "PASS" : "FAIL"} ===`);

  return { success: passed === total };
}

const result = testAutoLayout();
process.exit(result.success ? 0 : 1);
