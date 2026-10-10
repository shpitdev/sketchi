import { describe, expect, it } from "vitest";

import {
  CANVAS_NODE_ICON,
  CANVAS_SPEC_VERSION,
  canvasBoundTextInset,
  canvasNodeIconBand,
  canvasNodeIconBox,
  embedCanvasIcons,
  getCanvasValidationIssues,
  type CanvasIconAsset,
  type CanvasShapeElement,
  type CanvasSpec,
} from "./canvas";

const DOCKER: CanvasIconAsset = {
  name: "Docker",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
};

function node(
  id: string,
  overrides: Partial<CanvasShapeElement> = {},
): CanvasShapeElement {
  return {
    type: "node",
    id,
    nodeId: id,
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 184,
    height: 80,
    label: "Build",
    ...overrides,
  };
}

function canvas(
  elements: CanvasShapeElement[],
  overrides: Partial<CanvasSpec> = {},
): CanvasSpec {
  return {
    kind: "canvas",
    version: CANVAS_SPEC_VERSION,
    diagramId: "icons",
    title: "Icons",
    width: 400,
    height: 300,
    accentColor: "#111827",
    backgroundColor: "#ffffff",
    elements,
    layers: [],
    layouts: [],
    zOrder: elements.map((element) => element.id),
    ...overrides,
  };
}

describe("node icon geometry", () => {
  it("centers the icon at the top of each shape's bound-text box", () => {
    const icon = { slug: "docker", size: 28 };
    expect(
      canvasNodeIconBox(node("r", { icon, x: 10, y: 20, height: 80 })),
    ).toEqual({ x: 88, y: 29, width: 28, height: 28 });

    const ellipse = node("e", {
      icon: { slug: "docker", size: 24 },
      shape: "ellipse",
      height: 100,
    });
    expect(canvasBoundTextInset(ellipse).y).toBeCloseTo(
      5 + 50 * (1 - Math.SQRT1_2),
    );
    expect(canvasNodeIconBox(ellipse)?.y).toBeCloseTo(
      canvasBoundTextInset(ellipse).y + CANVAS_NODE_ICON.gap,
    );

    const diamond = node("d", {
      icon: { slug: "docker", size: 20 },
      shape: "diamond",
      width: 200,
      height: 120,
    });
    expect(canvasBoundTextInset(diamond)).toEqual({ x: 55, y: 35 });
    expect(canvasNodeIconBox(diamond)).toEqual({
      x: 90,
      y: 39,
      width: 20,
      height: 20,
    });
    expect(canvasNodeIconBox(node("plain"))).toBeUndefined();
  });

  it("reserves the icon plus a gap above and below it", () => {
    expect(canvasNodeIconBand(undefined)).toBe(0);
    expect(canvasNodeIconBand({ slug: "docker", size: 28 })).toBe(
      28 + CANVAS_NODE_ICON.gap * 2,
    );
  });
});

describe("embedCanvasIcons", () => {
  it("embeds one asset per slug, drops unknown icons, and replaces authored assets", () => {
    const icon = { slug: "docker", size: 28 };
    const result = embedCanvasIcons(
      canvas(
        [
          node("a", { icon }),
          node("b", { icon }),
          node("c", { icon: { slug: "made-up", size: 28 } }),
          node("d", { icon: { slug: "Not A Slug", size: 28 } }),
        ],
        { icons: { docker: { name: "Forged", svg: "<svg onload=x>" } } },
      ),
      (slug) => (slug === "docker" ? DOCKER : undefined),
    );

    expect(result.scene.icons).toEqual({ docker: DOCKER });
    expect(
      result.scene.elements.map((element) =>
        element.type === "node" ? element.icon?.slug : undefined,
      ),
    ).toEqual(["docker", "docker", undefined, undefined]);
    expect(result.dropped).toEqual([
      { elementId: "c", index: 2, reason: "unavailable", slug: "made-up" },
      { elementId: "d", index: 3, reason: "unavailable", slug: "Not A Slug" },
    ]);
    expect(getCanvasValidationIssues(result.scene)).toEqual([]);
  });

  it("omits the icons map when nothing is embedded", () => {
    const result = embedCanvasIcons(canvas([node("a")]), () => DOCKER);
    expect("icons" in result.scene).toBe(false);
    expect(result.dropped).toEqual([]);
  });

  it("drops oversized assets and icons past the scene budget in element order", () => {
    const large = (name: string): CanvasIconAsset => ({
      name,
      svg: `<svg>${"x".repeat(CANVAS_NODE_ICON.maxAssetBytes - 11)}</svg>`,
    });
    const slugs = Array.from({ length: 14 }, (_, index) => `mark-${index}`);
    const result = embedCanvasIcons(
      canvas([
        node("huge", { icon: { slug: "huge", size: 28 } }),
        ...slugs.map((slug) => node(slug, { icon: { slug, size: 28 } })),
      ]),
      (slug) =>
        slug === "huge"
          ? {
              name: "Huge",
              svg: "x".repeat(CANVAS_NODE_ICON.maxAssetBytes + 1),
            }
          : large(slug),
    );

    expect(Object.keys(result.scene.icons ?? {})).toEqual(slugs.slice(0, 12));
    expect(result.dropped.map(({ slug, reason }) => [slug, reason])).toEqual([
      ["huge", "unavailable"],
      ["mark-12", "budget"],
      ["mark-13", "budget"],
    ]);
    expect(getCanvasValidationIssues(result.scene)).toEqual([]);
  });
});

describe("embedCanvasIcons safety", () => {
  const prototypeSlugs = [
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
  ];

  it("never resolves prototype members as icon assets", () => {
    const result = embedCanvasIcons(
      canvas(
        prototypeSlugs.map((slug, index) =>
          node(`n${index}`, { icon: { slug, size: 28 } }),
        ),
      ),
      () => undefined,
    );

    expect(result.dropped.map(({ slug, reason }) => [slug, reason])).toEqual(
      prototypeSlugs.map((slug) => [slug, "unavailable"]),
    );
    expect(result.scene.icons).toBeUndefined();
    expect(getCanvasValidationIssues(result.scene)).toEqual([]);
  });

  it("embeds a real asset keyed by a prototype-member name as its own entry", () => {
    const result = embedCanvasIcons(
      canvas([node("a", { icon: { slug: "constructor", size: 28 } })]),
      (slug) => (slug === "constructor" ? DOCKER : undefined),
    );

    expect(Object.hasOwn(result.scene.icons ?? {}, "constructor")).toBe(true);
    expect(getCanvasValidationIssues(result.scene)).toEqual([]);
  });

  it("flags prototype-member slugs without an own embedded asset", () => {
    for (const slug of prototypeSlugs) {
      const issues = getCanvasValidationIssues(
        canvas([node("a", { icon: { slug, size: 28 } })], { icons: {} }),
      );
      expect(issues, slug).toEqual([
        expect.objectContaining({ code: "invalid_icon", elementId: "a" }),
      ]);
    }
  });

  it("drops icons that would push a label out of its node", () => {
    const icon = { slug: "docker", size: 28 };
    const result = embedCanvasIcons(
      canvas([
        // Fallback label: 16px text needs 40px alone and 76px under a logo.
        node("roomy", { height: 76, icon }),
        node("tight", { height: 60, icon }),
        node("already-overflowing", { height: 30, icon }),
      ]),
      () => DOCKER,
    );

    expect(result.dropped).toEqual([
      { elementId: "tight", index: 1, reason: "no_room", slug: "docker" },
    ]);
    expect(
      result.scene.elements.map((element) =>
        element.type === "node" ? Boolean(element.icon) : undefined,
      ),
    ).toEqual([true, false, true]);
  });

  it("drops icons on sequence lifelines", () => {
    const result = embedCanvasIcons(
      canvas([
        node("line", {
          icon: { slug: "docker", size: 28 },
          rendererRole: "sequence-lifeline",
          width: 2,
          height: 200,
        }),
      ]),
      () => DOCKER,
    );

    expect(result.dropped).toEqual([
      { elementId: "line", index: 0, reason: "lifeline", slug: "docker" },
    ]);
    expect(result.scene.icons).toBeUndefined();
  });
});

describe("node icon validation", () => {
  it("requires an embedded asset, a valid slug and size, and no lifeline icons", () => {
    const issues = getCanvasValidationIssues(
      canvas(
        [
          node("missing", { icon: { slug: "github", size: 28 } }),
          node("bad-slug", { icon: { slug: "GitHub", size: 28 } }),
          node("tiny", { icon: { slug: "docker", size: 8 } }),
          node("line", {
            icon: { slug: "docker", size: 28 },
            label: "Line",
            rendererRole: "sequence-lifeline",
            width: 2,
            height: 200,
          }),
        ],
        { icons: { docker: DOCKER } },
      ),
    );

    expect(issues).toEqual([
      expect.objectContaining({
        code: "invalid_icon",
        elementId: "missing",
        path: "elements[0].icon.slug",
      }),
      expect.objectContaining({
        code: "invalid_icon",
        elementId: "bad-slug",
        path: "elements[1].icon.slug",
      }),
      expect.objectContaining({
        code: "invalid_icon",
        elementId: "tiny",
        path: "elements[2].icon.size",
      }),
      expect.objectContaining({
        code: "invalid_icon",
        elementId: "line",
        path: "elements[3].icon",
      }),
    ]);
  });

  it("limits embedded asset bytes", () => {
    expect(
      getCanvasValidationIssues(
        canvas([node("a")], {
          icons: {
            huge: {
              name: "Huge",
              svg: "x".repeat(CANVAS_NODE_ICON.maxAssetBytes + 1),
            },
          },
        }),
      ),
    ).toEqual([
      expect.objectContaining({ code: "limit_exceeded", path: "icons.huge" }),
    ]);
  });

  it("counts the icon band when checking whether a label fits", () => {
    const icon = { slug: "docker", size: 28 };
    // Fallback label: 16px text (22px tall) + 18px padding + 36px icon band.
    const fits = node("fits", { height: 76, icon });
    const overflows = node("overflows", { height: 75, icon });

    expect(
      getCanvasValidationIssues(canvas([fits], { icons: { docker: DOCKER } })),
    ).toEqual([]);
    expect(
      getCanvasValidationIssues(
        canvas([overflows], { icons: { docker: DOCKER } }),
      ),
    ).toEqual([expect.objectContaining({ code: "label_overflow" })]);
    expect(
      getCanvasValidationIssues(canvas([node("plain", { height: 50 })])),
    ).toEqual([]);
  });
});
