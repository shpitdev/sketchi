// Experiment 0.5: Arrow Optimization
// Run: bun run packages/backend/experiments/arrow-optimization.ts

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  start?: { id: string };
  end?: { id: string };
}

type Edge = "left" | "right" | "top" | "bottom";

function determineEdges(
  startEle: ExcalidrawElement,
  endEle: ExcalidrawElement
): { startEdge: Edge; endEdge: Edge } {
  const startCenter = {
    x: startEle.x + (startEle.width ?? 100) / 2,
    y: startEle.y + (startEle.height ?? 100) / 2,
  };
  const endCenter = {
    x: endEle.x + (endEle.width ?? 100) / 2,
    y: endEle.y + (endEle.height ?? 100) / 2,
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
  element: ExcalidrawElement,
  edge: Edge
): { x: number; y: number } {
  const x = element.x;
  const y = element.y;
  const w = element.width ?? 100;
  const h = element.height ?? 100;

  switch (edge) {
    case "left":
      return { x, y: y + h / 2 };
    case "right":
      return { x: x + w, y: y + h / 2 };
    case "top":
      return { x: x + w / 2, y };
    case "bottom":
      return { x: x + w / 2, y: y + h };
    default:
      return { x: x + w, y: y + h / 2 };
  }
}

function optimizeArrows(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  const elementMap = new Map(
    elements.filter((e) => e.id).map((e) => [e.id, e])
  );

  return elements.map((element) => {
    if (element.type !== "arrow") {
      return element;
    }

    const startEle = element.start?.id
      ? elementMap.get(element.start.id)
      : undefined;
    const endEle = element.end?.id ? elementMap.get(element.end.id) : undefined;

    if (!(startEle && endEle)) {
      return element;
    }

    const { startEdge, endEdge } = determineEdges(startEle, endEle);
    const startPoint = getEdgeCenter(startEle, startEdge);
    const endPoint = getEdgeCenter(endEle, endEdge);

    return {
      ...element,
      x: startPoint.x,
      y: startPoint.y,
      width: Math.max(1, endPoint.x - startPoint.x),
      height: endPoint.y - startPoint.y,
    };
  });
}

interface TestCase {
  name: string;
  elements: ExcalidrawElement[];
  expectedEdges: { startEdge: Edge; endEdge: Edge };
}

const testCases: TestCase[] = [
  {
    name: "Horizontal: A left of B",
    expectedEdges: { startEdge: "right", endEdge: "left" },
    elements: [
      { id: "a", type: "rectangle", x: 0, y: 100, width: 100, height: 50 },
      { id: "b", type: "rectangle", x: 300, y: 100, width: 100, height: 50 },
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        start: { id: "a" },
        end: { id: "b" },
      },
    ],
  },
  {
    name: "Vertical: A above B",
    expectedEdges: { startEdge: "bottom", endEdge: "top" },
    elements: [
      { id: "a", type: "rectangle", x: 100, y: 0, width: 100, height: 50 },
      { id: "b", type: "rectangle", x: 100, y: 200, width: 100, height: 50 },
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        start: { id: "a" },
        end: { id: "b" },
      },
    ],
  },
  {
    name: "Diagonal: A top-left of B (horizontal dominant)",
    expectedEdges: { startEdge: "right", endEdge: "left" },
    elements: [
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
      { id: "b", type: "rectangle", x: 400, y: 100, width: 100, height: 50 },
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        start: { id: "a" },
        end: { id: "b" },
      },
    ],
  },
  {
    name: "Reverse horizontal: B left of A",
    expectedEdges: { startEdge: "left", endEdge: "right" },
    elements: [
      { id: "a", type: "rectangle", x: 300, y: 100, width: 100, height: 50 },
      { id: "b", type: "rectangle", x: 0, y: 100, width: 100, height: 50 },
      {
        id: "arrow",
        type: "arrow",
        x: 0,
        y: 0,
        start: { id: "a" },
        end: { id: "b" },
      },
    ],
  },
];

function testArrowOptimization() {
  console.log("=== Experiment 0.5: Arrow Optimization ===\n");

  let passed = 0;
  const total = testCases.length;

  for (const tc of testCases) {
    console.log(`Test: ${tc.name}`);

    const optimized = optimizeArrows(tc.elements);
    const arrow = optimized.find((e) => e.type === "arrow");
    const a = tc.elements.find((e) => e.id === "a");
    const b = tc.elements.find((e) => e.id === "b");

    if (!(arrow && a && b)) {
      console.log("  Error: Missing elements");
      console.log("  Result: FAIL\n");
      continue;
    }

    const { startEdge, endEdge } = determineEdges(a, b);
    const edgesMatch =
      startEdge === tc.expectedEdges.startEdge &&
      endEdge === tc.expectedEdges.endEdge;

    const startPoint = getEdgeCenter(a, startEdge);
    const endPoint = getEdgeCenter(b, endEdge);
    const positionMatch = arrow.x === startPoint.x && arrow.y === startPoint.y;

    const success = edgesMatch && positionMatch;

    console.log(
      `  - Expected edges: ${tc.expectedEdges.startEdge} -> ${tc.expectedEdges.endEdge}`
    );
    console.log(`  - Actual edges: ${startEdge} -> ${endEdge}`);
    console.log(`  - Edges match: ${edgesMatch ? "YES" : "NO"}`);
    console.log(
      `  - Arrow position: (${arrow.x}, ${arrow.y}) -> (${arrow.x + (arrow.width ?? 0)}, ${arrow.y + (arrow.height ?? 0)})`
    );
    console.log(
      `  - Expected: (${startPoint.x}, ${startPoint.y}) -> (${endPoint.x}, ${endPoint.y})`
    );
    console.log(`  - Position match: ${positionMatch ? "YES" : "NO"}`);
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

const result = testArrowOptimization();
process.exit(result.success ? 0 : 1);
