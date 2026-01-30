/**
 * Test scenarios for normalizeArrowBindings():
 * 1. Shape with arrow has arrow ID in boundElements
 * 2. Shape with text + arrow has both in boundElements
 * 3. Self-referencing arrow appears once (deduped)
 */

import { describe, expect, it } from "vitest";
import type { LayoutedDiagram } from "../lib/diagram-layout-types";
import { convertLayoutedToExcalidraw } from "../lib/excalidraw-elements";

describe("normalizeArrowBindings", () => {
  it("shape with arrow has arrow ID in boundElements", () => {
    const layouted: LayoutedDiagram = {
      shapes: [
        {
          id: "shape1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
        },
        {
          id: "shape2",
          type: "rectangle",
          x: 200,
          y: 0,
          width: 100,
          height: 80,
        },
      ],
      arrows: [
        {
          id: "arrow1",
          fromId: "shape1",
          toId: "shape2",
          x: 100,
          y: 40,
          width: 100,
          height: 0,
          points: [
            [0, 0],
            [100, 0],
          ],
          elbowed: false,
        },
      ],
    };

    const elements = convertLayoutedToExcalidraw(layouted);

    const shape1 = elements.find((e) => e.id === "shape1");
    const shape2 = elements.find((e) => e.id === "shape2");

    expect(shape1?.boundElements).toEqual([{ id: "arrow1", type: "arrow" }]);
    expect(shape2?.boundElements).toEqual([{ id: "arrow1", type: "arrow" }]);
  });

  it("shape with text + arrow has both in boundElements", () => {
    const layouted: LayoutedDiagram = {
      shapes: [
        {
          id: "shape1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          label: { text: "Start" },
        },
        {
          id: "shape2",
          type: "rectangle",
          x: 200,
          y: 0,
          width: 100,
          height: 80,
        },
      ],
      arrows: [
        {
          id: "arrow1",
          fromId: "shape1",
          toId: "shape2",
          x: 100,
          y: 40,
          width: 100,
          height: 0,
          points: [
            [0, 0],
            [100, 0],
          ],
          elbowed: false,
        },
      ],
    };

    const elements = convertLayoutedToExcalidraw(layouted);

    const shape1 = elements.find((e) => e.id === "shape1");

    expect(shape1?.boundElements).toEqual([
      { id: "shape1_text", type: "text" },
      { id: "arrow1", type: "arrow" },
    ]);
  });

  it("self-referencing arrow appears once", () => {
    const layouted: LayoutedDiagram = {
      shapes: [
        {
          id: "shape1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 80,
        },
      ],
      arrows: [
        {
          id: "arrow1",
          fromId: "shape1",
          toId: "shape1",
          x: 100,
          y: 40,
          width: 100,
          height: 0,
          points: [
            [0, 0],
            [100, 0],
          ],
          elbowed: false,
        },
      ],
    };

    const elements = convertLayoutedToExcalidraw(layouted);

    const shape1 = elements.find((e) => e.id === "shape1");

    expect(shape1?.boundElements).toEqual([{ id: "arrow1", type: "arrow" }]);
    expect(
      (shape1?.boundElements as Array<{ id: string; type: string }>).length
    ).toBe(1);
  });
});
