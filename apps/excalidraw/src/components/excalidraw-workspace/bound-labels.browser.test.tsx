import { restoreElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  type CanvasSpec,
  getCanvasValidationIssues,
  parseFlowchartDiagram,
} from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import {
  renderIntermediateDiagram,
  renderSequenceDiagram,
} from "@sketchi/diagram-renderer";
import { ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import "@sketchi/diagram-ui/styles.css";
import "../../styles/app.css";

afterEach(cleanup);

/**
 * Flowchart covering each bound-label container (rectangle, diamond, ellipse, arrow) with
 * unwrapped, wrapped, punctuated, long-word, CJK, and emoji labels.
 */
const diagram = parseFlowchartDiagram({
  id: "bound-label-first-paint",
  title: "Bound label first paint",
  type: "flowchart",
  nodes: [
    { id: "start", label: "Start", kind: "start" },
    {
      id: "wrapped",
      label: "Review the Certificate of Analysis and record deviations",
      kind: "process",
    },
    { id: "decision", label: "Passes specs?", kind: "decision" },
    {
      id: "long-word",
      label: "Supercalifragilisticexpialidociousness",
      kind: "process",
    },
    { id: "cjk", label: "品質保証レビュー承認待ち", kind: "process" },
    { id: "caps", label: "QA REVIEW REQUIRED", kind: "process" },
    { id: "emoji", label: "Ship it 🚀 now ✅", kind: "process" },
    { id: "cjk-decision", label: "承認しますか？", kind: "decision" },
    { id: "end", label: "Done — archived (v2.1)!", kind: "end" },
  ],
  edges: [
    { id: "start-wrapped", source: "start", target: "wrapped" },
    { id: "wrapped-decision", source: "wrapped", target: "decision" },
    {
      id: "decision-long-word",
      source: "decision",
      target: "long-word",
      label: "yes",
    },
    {
      id: "decision-cjk",
      source: "decision",
      target: "cjk",
      label: "Escalate to the quality manager for final disposition",
    },
    {
      id: "long-word-emoji",
      source: "long-word",
      target: "emoji",
      label: "超长的边标签",
    },
    { id: "cjk-caps", source: "cjk", target: "caps" },
    {
      id: "caps-cjk-decision",
      source: "caps",
      target: "cjk-decision",
      label: "🔁 retry, then ship!",
    },
    {
      id: "cjk-decision-end",
      source: "cjk-decision",
      target: "end",
      label: "はい",
    },
    {
      id: "cjk-decision-emoji",
      source: "cjk-decision",
      target: "emoji",
      label: "いいえ",
    },
    { id: "emoji-end", source: "emoji", target: "end" },
  ],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
});

/** An agent-authored canvas: fixed node geometry and an unbound line label. */
const agentCanvas: CanvasSpec = {
  kind: "canvas",
  version: 1,
  diagramId: "agent-labels",
  title: "Agent labels",
  width: 720,
  height: 280,
  accentColor: "#111827",
  backgroundColor: "#ffffff",
  elements: [
    {
      type: "node",
      id: "cell",
      nodeId: "cell",
      shape: "rectangle",
      x: 40,
      y: 40,
      width: 80,
      height: 40,
      label: "Cell 100",
    },
    {
      type: "node",
      id: "cjk",
      nodeId: "cjk",
      shape: "rectangle",
      x: 180,
      y: 30,
      width: 200,
      height: 60,
      label: "品質保証レビュー承認待ち",
    },
    {
      type: "node",
      id: "gate",
      nodeId: "gate",
      shape: "ellipse",
      x: 440,
      y: 20,
      width: 200,
      height: 80,
      label: "Release gate ✔",
    },
    {
      type: "line",
      id: "divider",
      points: [
        { x: 40, y: 200 },
        { x: 640, y: 200 },
      ],
      label: "Escalate to the quality manager for final disposition",
    },
  ],
  layers: [],
  layouts: [],
  zOrder: ["cell", "cjk", "gate", "divider"],
};

const sequence = renderSequenceDiagram({
  id: "long-participants",
  title: "Long participants",
  participants: [
    { id: "qa", label: "Quality Assurance Department" },
    { id: "cjk", label: "品質保証レビュー承認待ち部門" },
  ],
  messages: [
    { id: "submit", source: "qa", target: "cjk", label: "Submit batch 🚀" },
  ],
  style: { accentColor: "#111827", backgroundColor: "#ffffff" },
});

type Geometry = Pick<
  ExcalidrawTextElement,
  "height" | "text" | "width" | "x" | "y"
>;

function isText<T extends ExcalidrawElement>(
  element: T,
): element is T & ExcalidrawTextElement {
  return element.type === "text";
}

function geometry(element: ExcalidrawTextElement): Geometry {
  const { height, text, width, x, y } = element;
  return { height, text, width, x, y };
}

function labelGeometry(api: ExcalidrawImperativeAPI) {
  return new Map(
    api
      .getSceneElements()
      .filter(isText)
      .map((element) => [element.id, geometry(element)]),
  );
}

/**
 * Excalidraw's own measurement of each stored label exactly as painted. The
 * labels are detached for measuring only, so Excalidraw sizes the stored lines
 * instead of re-wrapping them to its container text area.
 */
function paintedSize(
  labels: readonly ExcalidrawTextElement[],
): Map<string, { readonly height: number; readonly width: number }> {
  return new Map(
    restoreElements(
      labels.map((label) => ({
        ...label,
        autoResize: true,
        containerId: null,
      })),
      null,
      // Excalidraw only refreshes dimensions on the repair-bindings path.
      { refreshDimensions: true, repairBindings: true },
    ).map((label) => [label.id, { height: label.height, width: label.width }]),
  );
}

/**
 * Where Excalidraw paints a label: arrow labels sit on the arrow's middle point
 * or middle segment (their stored x/y are ignored), other labels at x/y.
 */
function paintedCenter(
  label: Geometry,
  container: ExcalidrawElement | undefined,
): { readonly x: number; readonly y: number } {
  if (container?.type !== "arrow" || !("points" in container)) {
    return { x: label.x + label.width / 2, y: label.y + label.height / 2 };
  }
  const points = container.points;
  const middle = Math.floor(points.length / 2);
  const [x, y] =
    points.length % 2 === 1
      ? (points[middle] ?? [0, 0])
      : [
          ((points[middle - 1]?.[0] ?? 0) + (points[middle]?.[0] ?? 0)) / 2,
          ((points[middle - 1]?.[1] ?? 0) + (points[middle]?.[1] ?? 0)) / 2,
        ];
  return { x: container.x + x, y: container.y + y };
}

async function nextFrames(count = 2) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/**
 * Renders the scene in the real Excalidraw canvas, then checks every label at
 * first paint and again after selecting it with a real pointer click.
 */
async function expectLabelsPaintFully(
  scene: ReturnType<typeof convertSceneToExcalidraw>,
  labelCount: number,
) {
  const emitted = new Map(
    scene.elements
      .filter((element) => element.type === "text")
      .map((element) => [
        element.id,
        geometry(element as unknown as ExcalidrawTextElement),
      ]),
  );
  expect(emitted.size).toBe(labelCount);

  await page.viewport(1280, 960);
  let editorApi: ExcalidrawImperativeAPI | null = null;
  const view = render(
    <div style={{ height: 960, width: 1280 }}>
      <ExcalidrawSceneCanvas
        onApiChange={(api) => {
          editorApi = api;
        }}
        scene={scene}
        title="Label canvas"
        viewModeEnabled={false}
        zenModeEnabled={false}
      />
    </div>,
  );
  const api = await waitFor(
    () => {
      if (!editorApi) {
        throw new Error("Excalidraw API is not ready");
      }
      return editorApi;
    },
    { timeout: 20_000 },
  );
  const labels = [...emitted.values()].map((label) => label.text).join("");
  await Promise.all(
    ["Excalifont", "Xiaolai"].map((family) =>
      document.fonts.load(`16px ${family}`, labels),
    ),
  );
  await document.fonts.ready;
  await nextFrames();
  // A silent fallback font would make every measurement below meaningless.
  expect(document.fonts.check("16px Excalifont", "Release")).toBe(true);
  if (/\p{Script=Han}/u.test(labels)) {
    expect(document.fonts.check("14px Xiaolai", "品")).toBe(true);
  }

  // First paint: Excalidraw keeps the adapter's wrap and geometry untouched.
  const firstPaint = labelGeometry(api);
  expect(firstPaint).toEqual(emitted);

  const elements = api.getSceneElements();
  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );
  const measured = paintedSize(elements.filter(isText));
  for (const [id, label] of firstPaint) {
    const text = elementsById.get(id) as ExcalidrawTextElement;
    const glyphs = measured.get(id);
    expect(glyphs, id).toBeDefined();
    if (!glyphs) continue;

    // No character is dropped by wrapping.
    expect(label.text.replace(/\s+/g, ""), id).toBe(
      text.originalText.replace(/\s+/g, ""),
    );
    // Excalidraw draws each label into a canvas of its stored width padded
    // by half the font size per side; a centered line wider than that clips.
    expect(
      glyphs.width,
      `${id} paints ${glyphs.width}px into a ${label.width}px box`,
    ).toBeLessThanOrEqual(label.width + text.fontSize);
    expect(glyphs.height, id).toBeLessThanOrEqual(label.height + 0.5);
    const container = elementsById.get(text.containerId ?? "");
    if (container && container.type !== "arrow") {
      expect(label.x, id).toBeGreaterThanOrEqual(container.x);
      expect(label.y, id).toBeGreaterThanOrEqual(container.y);
      expect(label.x + label.width, id).toBeLessThanOrEqual(
        container.x + container.width,
      );
      expect(label.y + label.height, id).toBeLessThanOrEqual(
        container.y + container.height,
      );
    }
  }

  // Select each label (or its container) with a real pointer click.
  const canvas = view.container.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  );
  expect(canvas).not.toBeNull();
  if (!canvas) return;
  for (const [id, label] of firstPaint) {
    const text = elementsById.get(id) as ExcalidrawTextElement;
    const target = text.containerId ?? id;
    const center = paintedCenter(label, elementsById.get(target));
    const { scrollX, scrollY, zoom } = api.getAppState();
    await userEvent.click(canvas, {
      position: {
        x: (center.x + scrollX) * zoom.value,
        y: (center.y + scrollY) * zoom.value,
      },
    });
    await nextFrames();
    expect(
      Object.keys(api.getAppState().selectedElementIds),
      `clicking ${id} selects ${target}`,
    ).toContain(target);
    expect(labelGeometry(api), `selecting ${target}`).toEqual(firstPaint);
  }

  await act(async () => {
    api.updateScene({ appState: { selectedElementIds: {} } });
  });
  await nextFrames();
  expect(labelGeometry(api)).toEqual(firstPaint);
}

describe("Excalidraw labels", () => {
  it("paint flowchart labels fully and do not reflow when selected", async () => {
    await expectLabelsPaintFully(
      convertSceneToExcalidraw(renderIntermediateDiagram(diagram)),
      15,
    );
  }, 60_000);

  it("paint agent canvas node and line labels fully", async () => {
    expect(getCanvasValidationIssues(agentCanvas)).toEqual([]);
    await expectLabelsPaintFully(convertSceneToExcalidraw(agentCanvas), 4);
  }, 60_000);

  it("paint long sequence participant headers fully", async () => {
    await expectLabelsPaintFully(convertSceneToExcalidraw(sequence), 3);
  }, 60_000);
});
