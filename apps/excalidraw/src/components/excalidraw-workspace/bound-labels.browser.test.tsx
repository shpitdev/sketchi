import { restoreElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { parseFlowchartDiagram } from "@sketchi/diagram-core";
import { convertSceneToExcalidraw } from "@sketchi/diagram-excalidraw";
import { renderIntermediateDiagram } from "@sketchi/diagram-renderer";
import { ExcalidrawSceneCanvas } from "@sketchi/diagram-ui";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import "@sketchi/diagram-ui/styles.css";
import "../../styles/app.css";

afterEach(cleanup);

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Serve Excalidraw's own fonts from the installed package instead of its CDN
// default, so the measurement below never depends on the network. The path is
// a variable so Vite does not rewrite it into an asset import.
const excalidrawAssets =
  "../../../node_modules/@excalidraw/excalidraw/dist/prod/";
window.EXCALIDRAW_ASSET_PATH = `/@fs${new URL(excalidrawAssets, import.meta.url).pathname}`;

/**
 * Covers each bound-label container (rectangle, diamond, ellipse, arrow) with
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

type Geometry = Pick<
  ExcalidrawTextElement,
  "height" | "text" | "width" | "x" | "y"
>;

function isBoundText<T extends ExcalidrawElement>(
  element: T,
): element is T & ExcalidrawTextElement & { containerId: string } {
  return element.type === "text" && element.containerId !== null;
}

function geometry(element: ExcalidrawTextElement): Geometry {
  const { height, text, width, x, y } = element;
  return { height, text, width, x, y };
}

function boundTextGeometry(api: ExcalidrawImperativeAPI) {
  return new Map(
    api
      .getSceneElements()
      .filter(isBoundText)
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
  container: ExcalidrawElement,
): { readonly x: number; readonly y: number } {
  if (container.type !== "arrow" || !("points" in container)) {
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

describe("bound Excalidraw labels", () => {
  it("paint fully on first load and do not reflow when selected", async () => {
    const scene = convertSceneToExcalidraw(renderIntermediateDiagram(diagram));
    const emitted = new Map(
      scene.elements
        .filter((element) => element.type === "text" && element.containerId)
        .map((element) => [
          element.id,
          geometry(element as unknown as ExcalidrawTextElement),
        ]),
    );
    expect(emitted.size).toBe(15);

    await page.viewport(1280, 960);
    let editorApi: ExcalidrawImperativeAPI | null = null;
    const view = render(
      <div style={{ height: 960, width: 1280 }}>
        <ExcalidrawSceneCanvas
          onApiChange={(api) => {
            editorApi = api;
          }}
          scene={scene}
          title="Bound label canvas"
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

    // First paint: Excalidraw keeps the adapter's wrap and geometry untouched.
    const firstPaint = boundTextGeometry(api);
    expect(firstPaint).toEqual(emitted);

    const elements = api.getSceneElements();
    const elementsById = new Map(
      elements.map((element) => [element.id, element]),
    );
    const measured = paintedSize(elements.filter(isBoundText));
    for (const [id, label] of firstPaint) {
      const text = elementsById.get(id) as ExcalidrawTextElement;
      const glyphs = measured.get(id);
      const container = elementsById.get(text.containerId ?? "");
      expect(glyphs, id).toBeDefined();
      expect(container, id).toBeDefined();
      if (!glyphs || !container) continue;

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
      if (container.type !== "arrow") {
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

    // Select each label's container with a real pointer click on the canvas.
    const canvas = view.container.querySelector<HTMLCanvasElement>(
      "canvas.excalidraw__canvas.interactive",
    );
    expect(canvas).not.toBeNull();
    if (!canvas) return;
    for (const [id, label] of firstPaint) {
      const containerId = (elementsById.get(id) as ExcalidrawTextElement)
        .containerId;
      const container = elementsById.get(containerId ?? "");
      if (!container) continue;
      const center = paintedCenter(label, container);
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
        `clicking ${id} selects its container`,
      ).toContain(containerId);
      expect(boundTextGeometry(api), `selecting ${containerId}`).toEqual(
        firstPaint,
      );
    }

    await act(async () => {
      api.updateScene({ appState: { selectedElementIds: {} } });
    });
    await nextFrames();
    expect(boundTextGeometry(api)).toEqual(firstPaint);
  }, 60_000);
});
