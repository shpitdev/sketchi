import { describe, expect, it } from "vitest";

import {
  CANVAS_SPEC_VERSION,
  compileCanvasSpec,
  getCanvasValidationIssues,
  type CanvasSpec,
} from "./canvas";

function baseCanvas(overrides: Partial<CanvasSpec> = {}): CanvasSpec {
  return {
    kind: "canvas",
    version: CANVAS_SPEC_VERSION,
    diagramId: "canvas-test",
    title: "Canvas test",
    width: 400,
    height: 300,
    accentColor: "#111827",
    backgroundColor: "#ffffff",
    elements: [],
    layers: [],
    layouts: [],
    zOrder: [],
    ...overrides,
  };
}

describe("CanvasSpec", () => {
  it("applies ordered layout primitives and synchronizes bindings deterministically", () => {
    const elements: CanvasSpec["elements"] = [
      {
        type: "node",
        id: "a",
        nodeId: "a",
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        label: "A",
      },
      {
        type: "node",
        id: "b",
        nodeId: "b",
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 140,
        height: 80,
        label: "B",
      },
      {
        type: "text",
        id: "label-a",
        containerId: "a",
        x: 0,
        y: 0,
        text: "A",
        fontSize: 20,
      },
      {
        type: "arrow",
        id: "a-b",
        edgeId: "a-b",
        sourceNodeId: "a",
        targetNodeId: "b",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ];
    const compiled = compileCanvasSpec(
      baseCanvas({
        elements,
        layouts: [
          { type: "row", ids: ["a", "b"], x: 40, y: 60, gap: 30 },
          { type: "align", ids: ["a", "b"], axis: "y", alignment: "center" },
        ],
      }),
    );

    expect(
      compiled.elements.find((element) => element.id === "a"),
    ).toMatchObject({ x: 40, y: 65 });
    expect(
      compiled.elements.find((element) => element.id === "b"),
    ).toMatchObject({ x: 170, y: 55 });
    expect(
      compiled.elements.find((element) => element.id === "label-a"),
    ).toMatchObject({ x: 90, y: 95 });
    expect(
      compiled.elements.find((element) => element.id === "a-b"),
    ).toMatchObject({
      points: [
        { x: 140, y: 95 },
        { x: 170, y: 95 },
      ],
    });
    expect(compiled.zOrder).toEqual(["a", "b", "label-a", "a-b"]);
  });

  it("reports hard structural violations without treating overlap as invalid", () => {
    const issues = getCanvasValidationIssues(
      baseCanvas({
        layers: [{ id: "visible" }],
        elements: [
          {
            type: "node",
            id: "same",
            nodeId: "one",
            shape: "rectangle",
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            label: "One",
          },
          {
            type: "node",
            id: "same",
            nodeId: "two",
            shape: "polygon",
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            label: "Two",
            layerId: "missing",
          },
          {
            type: "line",
            id: "line",
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 20 },
            ],
            endBinding: { elementId: "missing" },
          },
        ],
        zOrder: ["same", "line"],
      }),
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate_element_id",
        "invalid_polygon",
        "invalid_composition",
        "invalid_binding",
      ]),
    );
    expect(issues.every((issue) => !issue.message.includes("overlap"))).toBe(
      true,
    );
  });

  it("lays out columns, grids, stacks, and distributed elements deterministically", () => {
    const elements: CanvasSpec["elements"] = [
      {
        type: "node",
        id: "a",
        nodeId: "a",
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        label: "A",
      },
      {
        type: "node",
        id: "b",
        nodeId: "b",
        shape: "rectangle",
        x: 30,
        y: 20,
        width: 20,
        height: 15,
        label: "B",
      },
      {
        type: "node",
        id: "c",
        nodeId: "c",
        shape: "rectangle",
        x: 80,
        y: 60,
        width: 30,
        height: 12,
        label: "C",
      },
    ];
    const positions = (canvas: CanvasSpec) =>
      Object.fromEntries(
        compileCanvasSpec(canvas).elements.flatMap((element) =>
          "x" in element && "y" in element
            ? [[element.id, { x: element.x, y: element.y }]]
            : [],
        ),
      );

    expect(
      positions(
        baseCanvas({
          elements,
          layouts: [
            { type: "column", ids: ["a", "b", "c"], x: 5, y: 7, gap: 5 },
          ],
        }),
      ),
    ).toMatchObject({
      a: { x: 5, y: 7 },
      b: { x: 5, y: 22 },
      c: { x: 5, y: 42 },
    });
    expect(
      positions(
        baseCanvas({
          elements,
          layouts: [
            {
              type: "grid",
              ids: ["a", "b", "c"],
              columns: 2,
              x: 10,
              y: 20,
              columnGap: 5,
              rowGap: 7,
            },
          ],
        }),
      ),
    ).toMatchObject({
      a: { x: 10, y: 20 },
      b: { x: 45, y: 20 },
      c: { x: 10, y: 42 },
    });
    expect(
      positions(
        baseCanvas({
          elements,
          layouts: [{ type: "stack", ids: ["a", "b", "c"], x: 9, y: 11 }],
        }),
      ),
    ).toMatchObject({
      a: { x: 9, y: 11 },
      b: { x: 9, y: 11 },
      c: { x: 9, y: 11 },
    });
    expect(
      positions(
        baseCanvas({
          elements,
          layouts: [
            { type: "distribute", ids: ["c", "a", "b"], axis: "x", gap: 7 },
          ],
        }),
      ),
    ).toMatchObject({
      a: { x: 0, y: 0 },
      b: { x: 17, y: 20 },
      c: { x: 44, y: 60 },
    });
  });

  it("rejects ambiguous stable IDs, duplicate bound text, and frame cycles", () => {
    const issues = getCanvasValidationIssues(
      baseCanvas({
        elements: [
          {
            type: "frame",
            id: "frame-a",
            frameId: "frame-b",
            x: 0,
            y: 0,
            width: 300,
            height: 200,
          },
          {
            type: "frame",
            id: "frame-b",
            frameId: "frame-a",
            x: 10,
            y: 10,
            width: 200,
            height: 100,
          },
          {
            type: "node",
            id: "one",
            nodeId: "shared",
            shape: "rectangle",
            x: 20,
            y: 20,
            width: 80,
            height: 40,
            label: "One",
          },
          {
            type: "node",
            id: "two",
            nodeId: "shared",
            shape: "rectangle",
            x: 120,
            y: 20,
            width: 80,
            height: 40,
            label: "Two",
          },
          {
            type: "text",
            id: "text-a",
            containerId: "one",
            x: 0,
            y: 0,
            text: "A",
            fontSize: 16,
          },
          {
            type: "text",
            id: "text-b",
            containerId: "one",
            x: 0,
            y: 0,
            text: "B",
            fontSize: 16,
          },
        ],
        zOrder: ["frame-a", "frame-b", "one", "two", "text-a", "text-b"],
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_binding",
          message: expect.stringContaining("Duplicate nodeId"),
        }),
        expect.objectContaining({
          code: "invalid_binding",
          message: expect.stringContaining("more than one bound text"),
        }),
        expect.objectContaining({
          code: "invalid_composition",
          message: expect.stringContaining("nesting cycle"),
        }),
      ]),
    );
  });

  it("centers arrow-bound text after layout and endpoint synchronization", () => {
    const compiled = compileCanvasSpec(
      baseCanvas({
        elements: [
          {
            type: "node",
            id: "a",
            nodeId: "a",
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            label: "A",
          },
          {
            type: "node",
            id: "b",
            nodeId: "b",
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            label: "B",
          },
          {
            type: "text",
            id: "edge-text",
            containerId: "edge",
            x: 0,
            y: 0,
            text: "calls",
            fontSize: 14,
          },
          {
            type: "arrow",
            id: "edge",
            edgeId: "edge",
            sourceNodeId: "a",
            targetNodeId: "b",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
        layouts: [{ type: "row", ids: ["a", "b"], x: 0, y: 0, gap: 50 }],
      }),
    );

    expect(
      compiled.elements.find((element) => element.id === "edge"),
    ).toMatchObject({
      points: [
        { x: 50, y: 25 },
        { x: 100, y: 25 },
      ],
    });
    expect(
      compiled.elements.find((element) => element.id === "edge-text"),
    ).toMatchObject({ x: 75, y: 25 });
  });

  it("synchronizes line bindings when layouts move nodes and frames", () => {
    const compiled = compileCanvasSpec(
      baseCanvas({
        elements: [
          {
            type: "node",
            id: "node",
            nodeId: "node",
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            label: "Node",
          },
          {
            type: "frame",
            id: "frame",
            x: 0,
            y: 0,
            width: 80,
            height: 80,
          },
          {
            type: "line",
            id: "bound-line",
            points: [
              { x: 0, y: 0 },
              { x: 75, y: 10 },
              { x: 1, y: 1 },
            ],
            startBinding: { elementId: "node" },
            endBinding: { elementId: "frame" },
            endArrowhead: "arrow",
          },
        ],
        layouts: [
          {
            type: "row",
            ids: ["node", "frame"],
            x: 40,
            y: 20,
            gap: 100,
          },
        ],
      }),
    );

    expect(
      compiled.elements.find((element) => element.id === "bound-line"),
    ).toMatchObject({
      points: [
        { x: 90, y: 45 },
        { x: 75, y: 10 },
        { x: 190, y: 60 },
      ],
    });
  });

  it("rejects empty canvases before export", () => {
    expect(getCanvasValidationIssues(baseCanvas())).toContainEqual({
      code: "empty_canvas",
      message: "CanvasSpec must contain at least one element.",
      path: "elements",
    });
  });
});
