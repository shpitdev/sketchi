// @vitest-environment node

import { describe, expect, it } from "vitest";

import { corpusFixtures } from "../../tests/corpus-fixtures";
import {
  adaptiveDeterminismChecksums,
  adaptiveDeterminismFixture,
  diagnosticDeterminismChecksum,
  diagnosticDeterminismFixture,
} from "../../tests/determinism-fixtures";
import { inspectSvgCapabilities } from "./capabilities";
import { convertSvgToExcalidraw } from "./convert";
import { filledRegionsForShape } from "./native";
import {
  constructNativeTrace,
  deterministicTraceJson,
  deterministicTraceChecksum,
  PROVISIONAL_POINT_BUDGET,
} from "./native";
import { deterministicDocumentChecksum, parseSvg } from "./parse";
import type { CanonicalShape, CanonicalSvgDocument } from "./types";

const defaultTraceOptions = {
  fillStyle: "solid",
  roughness: 1,
  strategy: "keyhole",
} as const;

function mustParse(
  source: string,
  sourceName = "inline.svg",
  flattening?: { readonly maxDepth?: number; readonly tolerance?: number },
  useExpansion?: {
    readonly maxDepth?: number;
    readonly maxExpansions?: number;
    readonly maxShapes?: number;
  },
): CanonicalSvgDocument {
  const result = parseSvg(
    source,
    flattening || useExpansion
      ? {
          ...(flattening ? { flattening } : {}),
          sourceName,
          ...(useExpansion ? { useExpansion } : {}),
        }
      : { sourceName },
  );
  expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
  if (!result.ok) {
    throw new Error("Expected SVG to parse");
  }
  return result.document;
}

function firstShape(document: CanonicalSvgDocument): CanonicalShape {
  const shape = document.shapes[0];
  if (!shape) {
    throw new Error("Expected parsed shape");
  }
  return shape;
}

describe("canonical SVG parser", () => {
  it("returns a typed fatal result for malformed XML and non-SVG roots", () => {
    const malformed = parseSvg("<svg><path></svg>");
    const wrongRoot = parseSvg("<html></html>");

    expect(malformed).toMatchObject({ ok: false, document: null });
    expect(malformed.diagnostics[0]?.code).toBe("invalid-svg");
    expect(wrongRoot).toMatchObject({ ok: false, document: null });
  });

  it("normalizes every supported primitive into absolute canonical subpaths", () => {
    const document = mustParse(`
      <svg viewBox="0 0 100 100">
        <rect x="1" y="2" width="10" height="20"/>
        <rect x="20" y="2" width="10" height="20" rx="2"/>
        <circle cx="10" cy="50" r="5"/>
        <ellipse cx="30" cy="50" rx="8" ry="4"/>
        <line x1="1" y1="80" x2="9" y2="90" stroke="#000"/>
        <polyline points="20,80 25,90 30,80" fill="none" stroke="#000"/>
        <polygon points="40,80 45,90 50,80"/>
        <path d="M60 80q5 10 10 0a5 5 0 0 1 10 0z"/>
      </svg>
    `);

    expect(document.shapes.map((shape) => shape.sourceElement)).toEqual([
      "rect",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "path",
    ]);
    expect(document.metrics.shapes).toBe(8);
    expect(document.metrics.cubicSegments).toBe(1);
    expect(document.metrics.arcSegments).toBeGreaterThanOrEqual(7);
    expect(document.shapes.every((shape) => shape.subpaths.length > 0)).toBe(
      true,
    );
    expect(document.shapes[0]?.subpaths[0]).toMatchObject({ closed: true });
    expect(document.shapes[4]?.subpaths[0]).toMatchObject({ closed: false });
  });

  it("skips absent and blank point lists without blocking rendered geometry", () => {
    const document = mustParse(`<svg viewBox="0 0 100 100">
      <polyline/><polygon points=""/>
      <polygon/><polyline points=""/>
      <polyline points="  "/><polygon points="  "/>
      <rect width="10" height="10"/>
    </svg>`);
    expect(document.diagnostics).toEqual([]);
    expect(document.shapes.map((shape) => shape.sourceElement)).toEqual([
      "rect",
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("supported");
    const result = convertSvgToExcalidraw(document);
    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(1);
  });

  it.each([
    '<polyline points=","/>',
    '<polygon points="0,0 10"/>',
  ])("still blocks genuinely malformed point lists: %s", (element) => {
    const document = mustParse(
      `<svg>${element}<rect width="10" height="10"/></svg>`,
    );
    expect(document.diagnostics.map((entry) => entry.code)).toContain(
      "invalid-geometry",
    );
    expect(convertSvgToExcalidraw(document)).toMatchObject({
      ok: false,
      elements: [],
    });
  });

  it.each([
    '<svg viewBox="0 0 100 100"><svg x="50" y="50" width="50" height="50" viewBox="0 0 10 10"><rect width="10" height="10"/></svg></svg>',
    '<svg viewBox="0 0 100 100"><defs><svg id="nested" viewBox="0 0 10 10"><rect width="10" height="10"/></svg></defs><use href="#nested" width="50" height="50"/></svg>',
  ])("blocks unrepresented nested SVG viewports: %s", (source) => {
    const document = mustParse(source);
    expect(document.shapes).toEqual([]);
    expect(document.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported-element" }),
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
    expect(convertSvgToExcalidraw(document)).toMatchObject({
      ok: false,
      elements: [],
    });
  });

  it("does not erase a clip containing an unrepresented nested SVG viewport", () => {
    const document = mustParse(`<svg viewBox="0 0 100 100"><defs>
      <clipPath id="c"><svg x="50" y="50" width="50" height="50" viewBox="0 0 100 100">
        <rect width="100" height="100"/>
      </svg></clipPath></defs><rect width="100" height="100" clip-path="url(#c)"/></svg>`);
    expect(document.diagnostics.map((entry) => entry.code)).toContain(
      "native-unsupported-clip",
    );
    expect(convertSvgToExcalidraw(document)).toMatchObject({
      ok: false,
      elements: [],
    });
  });

  it.each([
    [200, 100],
    [100, 200],
  ])(
    "keeps a percentage clip constraining in a %s root / %s symbol viewport",
    (rootSize, symbolSize) => {
      const document =
        mustParse(`<svg viewBox="0 0 ${rootSize} ${rootSize}"><defs>
      <clipPath id="quarter"><rect width="50%" height="50%"/></clipPath>
      <symbol id="s" overflow="visible" viewBox="0 0 ${symbolSize} ${symbolSize}">
        <rect width="100%" height="100%" clip-path="url(#quarter)"/>
      </symbol></defs><use href="#s" width="100" height="100"/></svg>`);
      expect(firstShape(document).clipPathIds).toEqual(["quarter"]);
      expect(document.diagnostics.map((entry) => entry.code)).not.toContain(
        "trivial-clip-removed",
      );
      expect(document.diagnostics.map((entry) => entry.code)).toContain(
        "native-unsupported-clip",
      );
      expect(convertSvgToExcalidraw(document)).toMatchObject({
        ok: false,
        elements: [],
      });
    },
  );

  it("classifies a percentage clip separately for each referencing viewport", () => {
    const document = mustParse(`<svg viewBox="0 0 200 200"><defs>
      <clipPath id="full"><rect x="10" y="20" width="100%" height="100%"/></clipPath>
      <symbol id="s" overflow="visible" viewBox="10 20 100 100">
        <rect x="10" y="20" width="100" height="100" clip-path="url(#full)"/>
      </symbol></defs><use href="#s" width="100" height="100"/>
      <rect width="200" height="200" clip-path="url(#full)"/>
    </svg>`);
    expect(document.shapes[0]?.clipPathIds).toEqual([]);
    expect(document.shapes[1]?.clipPathIds).toEqual(["full"]);
    expect(
      document.diagnostics.filter(
        (entry) => entry.code === "trivial-clip-removed",
      ),
    ).toHaveLength(1);
    expect(
      document.diagnostics.filter(
        (entry) => entry.code === "native-unsupported-clip",
      ),
    ).toHaveLength(1);
    expect(convertSvgToExcalidraw(document)).toMatchObject({
      ok: false,
      elements: [],
    });
  });

  it("retains the clip application viewport across a use-to-symbol viewport change", () => {
    const document = mustParse(`<svg viewBox="0 0 200 200"><defs>
      <clipPath id="root-full"><rect width="100%" height="100%"/></clipPath>
      <symbol id="s" overflow="visible" viewBox="10 20 100 100">
        <rect x="10" y="20" width="100" height="100"/>
      </symbol></defs><use href="#s" width="100" height="100" clip-path="url(#root-full)"/></svg>`);
    expect(firstShape(document).clipPathIds).toEqual([]);
    expect(document.diagnostics.map((entry) => entry.code)).toEqual([
      "trivial-clip-removed",
    ]);
    expect(convertSvgToExcalidraw(document).ok).toBe(true);
  });

  it("uses a valid viewBox without parsing unused physical root dimensions", () => {
    const document = mustParse(
      '<svg viewBox="0 0 200 100" width="12cm" height="4cm"><rect width="100%" height="100%"/></svg>',
    );
    expect(document.viewBox).toEqual([0, 0, 200, 100]);
    expect(document.diagnostics).toEqual([]);
    expect(firstShape(document).subpaths[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]);
    expect(convertSvgToExcalidraw(document).ok).toBe(true);
  });

  it("resolves a rectangle's percentage corner radius against its own width", () => {
    const document = mustParse(
      '<svg viewBox="0 0 200 200"><rect width="100" height="100" rx="10%"/></svg>',
    );
    const points = firstShape(document).subpaths[0]?.points;
    expect(points?.slice(0, 2)).toEqual([
      { x: 10, y: 0 },
      { x: 90, y: 0 },
    ]);
    expect(points).toContainEqual({ x: 100, y: 10 });
    expect(document.diagnostics).toEqual([]);
    expect(convertSvgToExcalidraw(document).ok).toBe(true);
  });

  it("resolves rx and ry independently against the rectangle's used percentage dimensions", () => {
    const document = mustParse(
      '<svg viewBox="0 0 200 200"><rect width="50%" height="25%" rx="10%" ry="20%"/></svg>',
    );
    const points = firstShape(document).subpaths[0]?.points;
    expect(points?.slice(0, 2)).toEqual([
      { x: 10, y: 0 },
      { x: 90, y: 0 },
    ]);
    expect(points).toContainEqual({ x: 100, y: 10 });
    expect(points).toContainEqual({ x: 100, y: 40 });
    expect(document.diagnostics).toEqual([]);
    expect(convertSvgToExcalidraw(document).ok).toBe(true);
  });

  it("resolves px and percentage lengths against the current viewport", () => {
    const document =
      mustParse(`<svg width="100%" height="100%" viewBox="0 0 200 100">
      <defs><rect id="tile" width="10" height="10"/></defs>
      <rect width="100%" height="50%" stroke="#000" stroke-width="4px"/>
      <use href="#tile" x="10px" y="10%" style="stroke:#000;stroke-width:3px"/>
      <line x1="25%" y1="25%" x2="75%" y2="75%" stroke="#000" stroke-width="10%"/>
    </svg>`);
    expect(document.diagnostics).toEqual([]);
    expect(document.viewBox).toEqual([0, 0, 200, 100]);
    expect(document.shapes[0]?.strokeWidth).toBe(4);
    expect(document.shapes[0]?.subpaths[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 },
    ]);
    expect(document.shapes[1]?.strokeWidth).toBe(3);
    expect(document.shapes[1]?.subpaths[0]?.points[0]).toEqual({
      x: 10,
      y: 10,
    });
    expect(document.shapes[2]?.subpaths[0]?.points).toEqual([
      { x: 50, y: 25 },
      { x: 150, y: 75 },
    ]);
    expect(document.shapes[2]?.strokeWidth).toBeCloseTo(
      Math.hypot(200, 100) / Math.SQRT2 / 10,
    );
    expect(
      mustParse(
        '<svg width="200px" height="100px"><rect width="100%" height="100%"/></svg>',
      ).viewBox,
    ).toEqual([0, 0, 200, 100]);
  });

  it.each([
    [
      '<svg viewBox="0 0 100 100"><rect width="50 %" height="10"/></svg>',
      "invalid-geometry",
    ],
    [
      '<svg><rect width="50" height="10" stroke="#000" stroke-width="10 px"/></svg>',
      "unsupported-presentation-property",
    ],
  ])("blocks whitespace between a length and its unit: %s", (source, code) => {
    const document = mustParse(source);
    expect(document.diagnostics.map((entry) => entry.code)).toContain(code);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
    expect(convertSvgToExcalidraw(document)).toMatchObject({
      ok: false,
      elements: [],
    });
  });

  it("accepts case-insensitive px units and surrounding length whitespace", () => {
    const document = mustParse(
      '<svg width=" 20Px " height=" 30pX "><rect x=" 0 " width=" 10PX " height=" 50% " stroke="#000" stroke-width=" 2PX "/></svg>',
    );
    expect(document.viewBox).toEqual([0, 0, 20, 30]);
    expect(document.diagnostics).toEqual([]);
    expect(firstShape(document).subpaths[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 15 },
      { x: 0, y: 15 },
      { x: 0, y: 0 },
    ]);
    expect(firstShape(document).strokeWidth).toBe(2);
    expect(convertSvgToExcalidraw(document).ok).toBe(true);
  });

  it.each([
    '<svg width="2em"><rect width="10" height="10"/></svg>',
    '<svg><rect width="10em" height="10"/></svg>',
    '<svg><rect width="10" height="10" stroke-width="4pt"/></svg>',
    '<svg><defs><rect id="r" width="10" height="10"/></defs><use href="#r" x="10em"/></svg>',
    '<svg viewBox="0 0 10px 10"><rect width="10" height="10"/></svg>',
    '<svg><polygon points="0,0 10px,0 10,10"/></svg>',
  ])(
    "diagnoses unsupported lengths and malformed numeric lists: %s",
    (source) => {
      const document = mustParse(source);
      expect(document.diagnostics.length).toBeGreaterThan(0);
      expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
    },
  );

  it.each(["c5 0 10 5 15 5", "a5 5 0 0 1 10 0", "l10 0"])(
    "starts continued %s commands at the transformed close point",
    (continuation) => {
      const document = mustParse(
        `<svg><path transform="translate(2 3)" d="M10 10l5 0l0 5zz ${continuation}" fill="none" stroke="#000"/></svg>`,
      );
      const subpaths = firstShape(document).subpaths;
      expect(subpaths).toHaveLength(2);
      expect(subpaths[0]?.closed).toBe(true);
      expect(subpaths[1]?.closed).toBe(false);
      expect(subpaths[1]?.points[0]).toEqual({ x: 12, y: 13 });
    },
  );

  it("opens a new subpath at the start point after close without a move", () => {
    const document = mustParse(
      '<svg><path d="M0 0 L10 0 L10 10 Z L20 20 L30 20" fill="none" stroke="#000"/></svg>',
    );
    expect(firstShape(document).subpaths).toEqual([
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 0 },
        ],
        signedArea: 50,
      },
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
          { x: 30, y: 20 },
        ],
        signedArea: -100,
      },
    ]);
  });

  it("composes complete nested transform lists in SVG order", () => {
    const document = mustParse(`
      <svg viewBox="0 0 100 100">
        <g transform="translate(10 20)">
          <g transform="scale(2)">
            <line x1="1" y1="1" x2="2" y2="2" stroke="#000"/>
          </g>
        </g>
        <line transform="translate(5) rotate(90) skewX(45) skewY(0) matrix(1 0 0 1 0 0)"
          x1="1" y1="0" x2="2" y2="0" stroke="#000"/>
      </svg>
    `);

    expect(document.shapes[0]?.subpaths[0]?.points).toEqual([
      { x: 12, y: 22 },
      { x: 14, y: 24 },
    ]);
    const transformed = document.shapes[1]?.subpaths[0]?.points;
    expect(transformed?.[0]?.x).toBeCloseTo(5);
    expect(transformed?.[0]?.y).toBeCloseTo(1);
    expect(document.diagnostics).toEqual([]);
  });

  it("applies CSS specificity, inline style, currentColor, and inherited paint", () => {
    const document = mustParse(`
      <svg viewBox="0 0 20 20">
        <style>
          path { fill: #111111; }
          .icon { fill: #222222; }
          g .icon { stroke: currentColor; stroke-width: 2; }
        </style>
        <g fill="#333333" color="#abcdef" opacity=".5">
          <path class="icon" style="fill:#444444" fill-opacity=".5" d="M0 0h5v5H0z"/>
          <path d="M10 0h5v5h-5z"/>
          <polygon points="0,10 5,15 0,15"/>
        </g>
      </svg>
    `);
    const first = document.shapes[0];
    const second = document.shapes[1];
    const inherited = document.shapes[2];

    expect(first?.fill).toMatchObject({
      color: "#444444",
      inherited: false,
      opacity: 0.25,
      source: "inline",
    });
    expect(first?.stroke).toMatchObject({
      color: "#abcdef",
      inherited: false,
      opacity: 0.5,
      source: "stylesheet",
    });
    expect(first?.strokeWidth).toBe(2);
    expect(second?.fill).toMatchObject({
      color: "#111111",
      inherited: false,
      opacity: 0.5,
      source: "stylesheet",
    });
    expect(inherited?.fill).toMatchObject({
      color: "#333333",
      inherited: true,
      opacity: 0.5,
      source: "presentation",
    });
  });

  it("resolves use instances with inherited paint, x/y, transforms, and stable identity", () => {
    const source = `
      <svg viewBox="0 0 100 100">
        <defs><path id="tile" d="M0 0h10v10H0z"/></defs>
        <use href="#tile" x="5" y="7" fill="#ff0000"/>
        <use href="#tile" xlink:href="#tile" transform="translate(20)" fill="#00ff00"/>
      </svg>
    `;
    const first = mustParse(source);
    const second = mustParse(source);

    expect(first.metrics.usesResolved).toBe(2);
    expect(first.useExpansion).toEqual({
      maxDepth: 64,
      maxExpansions: 10_000,
      maxShapes: 20_000,
    });
    expect(first.shapes).toHaveLength(2);
    expect(first.shapes.map((shape) => shape.fill?.color)).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
    expect(first.shapes[0]?.subpaths[0]?.points[0]).toEqual({ x: 5, y: 7 });
    expect(first.shapes[1]?.subpaths[0]?.points[0]).toEqual({ x: 20, y: 0 });
    expect(first.shapes.map((shape) => shape.sourcePath)).toEqual(
      second.shapes.map((shape) => shape.sourcePath),
    );
  });

  it("diagnoses missing and cyclic use references without throwing", () => {
    const document = mustParse(`
      <svg viewBox="0 0 10 10">
        <defs><g id="cycle"><use href="#cycle"/></g></defs>
        <use href="#missing"/><use href="#cycle"/>
      </svg>
    `);
    expect(document.diagnostics.map((entry) => entry.code)).toEqual([
      "use-cycle",
      "use-reference-missing",
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
  });

  it("resolves the corpus path-use fixture without rendering its mask definition", () => {
    const document = mustParse(
      corpusFixtures.usePath.source,
      corpusFixtures.usePath.sourceName,
    );
    const capabilities = inspectSvgCapabilities(document);

    expect(document.shapes).toHaveLength(1);
    expect(document.metrics.usesResolved).toBe(1);
    expect(document.shapes[0]?.fill?.color).toBe("#4285f4");
    expect(capabilities.features.use).toBe(2);
    expect(capabilities.features.mask).toBe(1);
  });

  it("blocks non-cyclic use expansion at deterministic depth, expansion, and shape budgets", () => {
    const branching = mustParse(
      `<svg>
        <defs>
          <path id="leaf" d="M0 0h1v1H0z"/>
          <g id="a"><use href="#leaf"/><use href="#leaf"/></g>
          <g id="b"><use href="#a"/><use href="#a"/></g>
          <g id="c"><use href="#b"/><use href="#b"/></g>
          <g id="d"><use href="#c"/><use href="#c"/></g>
        </defs>
        <use href="#d"/>
      </svg>`,
      "branching-use.svg",
      undefined,
      { maxDepth: 16, maxExpansions: 10, maxShapes: 100 },
    );
    const deep = mustParse(
      `<svg><defs>
        <path id="leaf" d="M0 0h1v1H0z"/>
        <g id="a"><use href="#leaf"/></g>
        <g id="b"><use href="#a"/></g>
        <g id="c"><use href="#b"/></g>
      </defs><use href="#c"/></svg>`,
      "deep-use.svg",
      undefined,
      { maxDepth: 2, maxExpansions: 100, maxShapes: 100 },
    );
    const shapeHeavy = mustParse(
      '<svg><path d="M0 0h1v1H0z"/><path d="M2 0h1v1H2z"/><path d="M4 0h1v1H4z"/></svg>',
      "shape-heavy.svg",
      undefined,
      { maxDepth: 16, maxExpansions: 100, maxShapes: 2 },
    );

    expect(branching.metrics.usesResolved).toBeLessThanOrEqual(10);
    expect(branching.diagnostics[0]?.code).toBe("use-expansion-limit-exceeded");
    expect(deep.diagnostics[0]?.code).toBe("use-expansion-limit-exceeded");
    expect(shapeHeavy.shapes).toHaveLength(2);
    expect(shapeHeavy.diagnostics[0]?.code).toBe(
      "use-expansion-limit-exceeded",
    );
    expect(inspectSvgCapabilities(branching).nativeTrace).toBe("unsupported");
  });

  it("maps symbol viewports for use width, height, and preserveAspectRatio", () => {
    const document = mustParse(`
      <svg viewBox="0 0 300 300">
        <defs>
          <symbol id="meet" overflow="visible" viewBox="0 0 10 20"><rect width="10" height="20"/></symbol>
          <symbol id="none" overflow="visible" viewBox="0 0 10 20" preserveAspectRatio="none"><rect width="10" height="20"/></symbol>
          <symbol id="slice" overflow="visible" viewBox="0 0 20 10" preserveAspectRatio="xMaxYMin slice"><rect width="20" height="10"/></symbol>
        </defs>
        <use href="#meet" x="10" y="5" width="100" height="100"/>
        <use href="#none" y="110" width="100" height="100"/>
        <use href="#slice" x="200" y="110" width="100" height="100"/>
      </svg>
    `);

    expect(document.shapes[0]?.subpaths[0]?.points).toEqual([
      { x: 35, y: 5 },
      { x: 85, y: 5 },
      { x: 85, y: 105 },
      { x: 35, y: 105 },
      { x: 35, y: 5 },
    ]);
    expect(document.shapes[1]?.subpaths[0]?.points).toEqual([
      { x: 0, y: 110 },
      { x: 100, y: 110 },
      { x: 100, y: 210 },
      { x: 0, y: 210 },
      { x: 0, y: 110 },
    ]);
    expect(document.shapes[2]?.subpaths[0]?.points).toEqual([
      { x: 100, y: 110 },
      { x: 300, y: 110 },
      { x: 300, y: 210 },
      { x: 100, y: 210 },
      { x: 100, y: 110 },
    ]);
  });

  it("resolves symbol percentages in its own user viewport", () => {
    const document = mustParse(`<svg viewBox="0 0 200 100"><defs>
      <symbol id="s" overflow="visible" viewBox="0 0 10 20" preserveAspectRatio="none">
        <rect width="100%" height="50%"/>
      </symbol></defs><use href="#s" width="50%" height="100%"/></svg>`);
    expect(document.diagnostics).toEqual([]);
    expect(firstShape(document).subpaths[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 },
    ]);
  });

  it("blocks symbol viewport forms it cannot map safely", () => {
    const document = mustParse(`
      <svg><defs>
        <symbol id="clipped" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
        <symbol id="units" overflow="visible" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
        <symbol id="negative" overflow="visible" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol>
      </defs>
      <use href="#clipped" width="100" height="100"/>
      <use href="#units" width="100em" height="100"/>
      <use href="#negative" width="-1" height="100"/>
      </svg>
    `);
    expect(document.shapes).toEqual([]);
    expect(document.diagnostics.map((entry) => entry.code)).toEqual([
      "symbol-viewport-unsupported",
      "symbol-viewport-unsupported",
      "symbol-viewport-unsupported",
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");
  });

  it("blocks ignored stroke and related presentation semantics", () => {
    const document = mustParse(`
      <svg><style>.advanced { stroke-linejoin: round; paint-order: stroke; }</style>
        <path class="advanced" stroke="#000" stroke-dasharray="2 3" stroke-dashoffset="1"
          stroke-linecap="round" stroke-miterlimit="10" vector-effect="non-scaling-stroke"
          marker-start="url(#m)" d="M0 0L10 10"/>
      </svg>
    `);
    const properties = document.diagnostics
      .filter((entry) => entry.code === "unsupported-presentation-property")
      .map((entry) => entry.message.split(": ").at(-1));

    expect(properties).toEqual([
      "marker-start",
      "paint-order",
      "stroke-dasharray",
      "stroke-dashoffset",
      "stroke-linecap",
      "stroke-linejoin",
      "stroke-miterlimit",
      "vector-effect",
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("unsupported");

    const corpus = mustParse(
      corpusFixtures.strokeDasharray.source,
      corpusFixtures.strokeDasharray.sourceName,
    );
    expect(corpus.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-presentation-property",
          message: expect.stringContaining("stroke-dasharray"),
        }),
      ]),
    );
  });

  it("skips presentation diagnostics for display-suppressed subtrees", () => {
    const document = mustParse(`<svg viewBox="0 0 100 100">
      <g display="none" stroke-width="4pt" stroke-dasharray="2 2">
        <rect display="inline" width="20" height="20" stroke-width="10em"/>
      </g>
      <rect id="visible" width="10" height="10"/>
    </svg>`);
    expect(document.diagnostics).toEqual([]);
    expect(document.shapes.map((shape) => shape.elementId)).toEqual([
      "visible",
    ]);
    expect(inspectSvgCapabilities(document).nativeTrace).toBe("supported");
    const result = convertSvgToExcalidraw(document);
    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(1);
  });

  it("keeps display suppression irreversible but allows visibility overrides", () => {
    const document = mustParse(`
      <svg>
        <g visibility="hidden">
          <rect id="hidden" width="1" height="1"/>
          <rect id="restored" visibility="visible" x="2" width="1" height="1"/>
        </g>
        <g display="none">
          <rect id="still-suppressed" display="inline" visibility="visible" x="4" width="1" height="1"/>
        </g>
      </svg>
    `);
    expect(document.shapes.map((shape) => shape.elementId)).toEqual([
      "restored",
    ]);
  });

  it.each([
    "translate(1 2 3)",
    "rotate(10 5)",
    "translate(1 junk)",
    "scale(1,,2)",
    "matrix(1 0 0 1 0)",
  ])("strictly rejects malformed transform %s", (transform) => {
    const document = mustParse(
      `<svg><line transform="${transform}" x1="1" y1="2" x2="3" y2="4" stroke="#000"/></svg>`,
    );
    expect(document.diagnostics[0]?.code).toBe("invalid-transform");
    expect(firstShape(document).subpaths[0]?.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it("accepts sign-separated transform numbers from the SVG grammar", () => {
    const document = mustParse(
      '<svg><line transform="translate(10-2)" x2="1" stroke="#000"/></svg>',
    );
    expect(document.diagnostics).toEqual([]);
    expect(firstShape(document).subpaths[0]?.points).toEqual([
      { x: 10, y: -2 },
      { x: 11, y: -2 },
    ]);
  });

  it("bounds exact SVG arc flattening against source geometry after transforms", () => {
    const radius = 10_000;
    const scale = 100;
    const tolerance = 0.5;
    const document = mustParse(
      `<svg><path transform="scale(${scale})" d="M${radius} 0A${radius} ${radius} 0 0 1 0 ${radius}" fill="none" stroke="#000"/></svg>`,
      "large-arc.svg",
      { tolerance },
    );
    const points = firstShape(document).subpaths[0]?.points ?? [];
    const outputRadius = radius * scale;
    const maximumChordError = points
      .slice(1)
      .reduce((maximum, point, index) => {
        const previous = points[index];
        if (!previous) {
          return maximum;
        }
        const midpointRadius = Math.hypot(
          (previous.x + point.x) / 2,
          (previous.y + point.y) / 2,
        );
        return Math.max(maximum, outputRadius - midpointRadius);
      }, 0);

    expect(document.metrics.arcSegments).toBe(1);
    expect(points.length).toBeGreaterThan(100);
    expect(maximumChordError).toBeLessThanOrEqual(tolerance + 1e-6);
  });

  it("bounds circle and ellipse primitives without cubic approximation error", () => {
    const radius = 10_000;
    const scale = 100;
    const tolerance = 0.5;
    const document = mustParse(
      `<svg><circle transform="scale(${scale})" cx="0" cy="0" r="${radius}"/></svg>`,
      "large-circle.svg",
      { tolerance },
    );
    const points = firstShape(document).subpaths[0]?.points ?? [];
    const outputRadius = radius * scale;
    const maximumChordError = points
      .slice(1)
      .reduce((maximum, point, index) => {
        const previous = points[index];
        if (!previous) {
          return maximum;
        }
        return Math.max(
          maximum,
          outputRadius -
            Math.hypot((previous.x + point.x) / 2, (previous.y + point.y) / 2),
        );
      }, 0);

    expect(document.metrics.arcSegments).toBe(1);
    expect(document.metrics.cubicSegments).toBe(0);
    expect(maximumChordError).toBeLessThanOrEqual(tolerance + 1e-6);
  });

  it("sorts non-ASCII diagnostics by explicit UTF-16 code units", () => {
    const document = mustParse(
      diagnosticDeterminismFixture,
      "non-ascii-diagnostics.svg",
    );
    expect(document.diagnostics.map((entry) => entry.sourcePath)).toEqual([
      "svg/unsupported#z[1]",
      "svg/unsupported#ä[0]",
    ]);
    expect(deterministicDocumentChecksum(document)).toBe(
      diagnosticDeterminismChecksum,
    );
  });

  it("does not strip hidden or self-intersecting canvas-corner clips", () => {
    const hidden = mustParse(`
      <svg><style>.off { display: none; }</style><defs>
        <clipPath id="hidden"><path class="off" d="M0 0H100V100H0Z"/></clipPath>
      </defs><rect clip-path="url(#hidden)" width="10" height="10"/></svg>
    `);
    const bowTie = mustParse(`
      <svg><defs><clipPath id="bowtie"><path d="M0 0L100 100L0 100L100 0Z"/></clipPath></defs>
        <rect clip-path="url(#bowtie)" width="10" height="10"/>
      </svg>
    `);
    const restoredVisibility = mustParse(`
      <svg><defs><clipPath id="restored"><g visibility="hidden">
        <rect visibility="visible" width="100" height="100"/>
      </g></clipPath></defs>
      <rect clip-path="url(#restored)" width="10" height="10"/></svg>
    `);
    const suppressedDisplay = mustParse(`
      <svg><defs><clipPath id="suppressed"><g display="none">
        <rect display="inline" width="100" height="100"/>
      </g></clipPath></defs>
      <rect clip-path="url(#suppressed)" width="10" height="10"/></svg>
    `);

    expect(firstShape(hidden).clipPathIds).toEqual(["hidden"]);
    expect(firstShape(bowTie).clipPathIds).toEqual(["bowtie"]);
    expect(firstShape(restoredVisibility).clipPathIds).toEqual([]);
    expect(firstShape(suppressedDisplay).clipPathIds).toEqual(["suppressed"]);
    expect(inspectSvgCapabilities(hidden).nativeTrace).toBe("unsupported");
    expect(inspectSvgCapabilities(bowTie).nativeTrace).toBe("unsupported");
  });

  it("blocks applied external or missing mask and filter references", () => {
    const applied = mustParse(`
      <svg><rect width="10" height="10" mask="url(https://example.com/m.svg#m)" filter="url(#missing)"/></svg>
    `);
    const none = mustParse(
      '<svg><rect width="10" height="10" mask="none" filter="none"/></svg>',
    );

    expect(
      applied.diagnostics
        .filter((entry) => entry.code === "native-unsupported-feature")
        .map((entry) => entry.feature),
    ).toEqual(["filter", "mask"]);
    expect(inspectSvgCapabilities(applied).nativeTrace).toBe("unsupported");
    expect(inspectSvgCapabilities(none).nativeTrace).toBe("supported");

    const stylesheetApplied = mustParse(`
      <svg><style>.effect { mask: url(#missing); filter: url(https://example.com/f.svg#f); }</style>
        <rect class="effect" width="10" height="10"/>
      </svg>
    `);
    expect(
      stylesheetApplied.diagnostics
        .filter((entry) => entry.code === "unsupported-presentation-property")
        .map((entry) => entry.message),
    ).toEqual([
      "Unsupported presentation property: filter",
      "Unsupported presentation property: mask",
    ]);
    expect(inspectSvgCapabilities(stylesheetApplied).nativeTrace).toBe(
      "unsupported",
    );
  });

  it("retains near-equal arc endpoints instead of collapsing almost-full arcs", () => {
    const document = mustParse(
      '<svg><path transform="scale(1000000)" d="M1 0A1 1 0 1 1 1 0.000001"/></svg>',
      "near-equal-arc.svg",
    );
    const points = firstShape(document).subpaths[0]?.points ?? [];

    expect(document.metrics.arcSegments).toBe(1);
    expect(points.length).toBeGreaterThan(100);
    expect(Math.max(...points.map((point) => point.x))).toBeGreaterThan(
      1_900_000,
    );
  });

  it("rejects CSS at-rules and nesting instead of applying inner rules", () => {
    const atRule = mustParse(`
      <svg><style>@media (min-width: 1px) { .icon { fill: #ff0000; } }</style>
        <rect class="icon" width="10" height="10"/>
      </svg>
    `);
    const nested = mustParse(`
      <svg><style>.outer { .icon { fill: #00ff00; } }</style>
        <rect class="icon" width="10" height="10"/>
      </svg>
    `);

    expect(firstShape(atRule).fill?.color).toBe("#000000");
    expect(firstShape(nested).fill?.color).toBe("#000000");
    expect(atRule.diagnostics[0]?.code).toBe("css-at-rule-unsupported");
    expect(nested.diagnostics[0]?.code).toBe("css-nesting-unsupported");
    expect(inspectSvgCapabilities(atRule).nativeTrace).toBe("unsupported");
    expect(inspectSvgCapabilities(nested).nativeTrace).toBe("unsupported");
  });

  it("removes only non-constraining rectangular clips and diagnoses real clips", () => {
    const trivial = mustParse(`
      <svg viewBox="0 0 100 100">
        <defs><clipPath id="canvas"><path d="M0 0h100v100H0z"/></clipPath></defs>
        <g clip-path="url(#canvas)"><circle cx="50" cy="50" r="10"/></g>
      </svg>
    `);
    const real = mustParse(`
      <svg viewBox="0 0 100 100">
        <defs><clipPath id="left"><rect width="40" height="100"/></clipPath></defs>
        <circle clip-path="url(#left)" cx="50" cy="50" r="20"/>
      </svg>
    `);

    expect(firstShape(trivial).clipPathIds).toEqual([]);
    expect(inspectSvgCapabilities(trivial)).toMatchObject({
      nativeTrace: "supported",
      summary: { realClip: false, trivialClipsRemoved: 1 },
    });
    expect(firstShape(real).clipPathIds).toEqual(["left"]);
    expect(inspectSvgCapabilities(real)).toMatchObject({
      nativeTrace: "unsupported",
      summary: { realClip: true },
    });
  });

  it("adapts curve subdivision to output-space scale and tolerance", () => {
    const path = '<path d="M0 0C0 10 10 10 10 0" fill="none" stroke="#000"/>';
    const small = mustParse(`<svg>${path}</svg>`, "small.svg", {
      tolerance: 0.5,
    });
    const scaled = mustParse(
      `<svg><g transform="scale(100)">${path}</g></svg>`,
      "scaled.svg",
      { tolerance: 0.5 },
    );
    const precise = mustParse(`<svg>${path}</svg>`, "precise.svg", {
      tolerance: 0.05,
    });
    const depthLimited = mustParse(`<svg>${path}</svg>`, "limited.svg", {
      maxDepth: 1,
      tolerance: 0.000001,
    });
    const collinearOvershoot = mustParse(
      '<svg><path d="M0 0C20 0 -10 0 10 0" fill="none" stroke="#000"/></svg>',
      "collinear-overshoot.svg",
    );

    expect(scaled.metrics.points).toBeGreaterThan(small.metrics.points);
    expect(precise.metrics.points).toBeGreaterThan(small.metrics.points);
    expect(small.flattening).toEqual({ maxDepth: 18, tolerance: 0.5 });
    expect(depthLimited.diagnostics[0]?.code).toBe(
      "adaptive-flattening-depth-exceeded",
    );
    expect(firstShape(depthLimited).subpaths[0]?.points.at(-1)).toEqual({
      x: 10,
      y: 0,
    });
    expect(collinearOvershoot.metrics.points).toBeGreaterThan(2);
  });

  it("preserves hole topology, disjoint subpaths, and native closed-line decisions", () => {
    const counter = mustParse(
      corpusFixtures.counter.source,
      corpusFixtures.counter.sourceName,
    );
    const multipath = mustParse(
      corpusFixtures.v1DisjointMultipath.source,
      corpusFixtures.v1DisjointMultipath.sourceName,
    );
    const regions = counter.shapes.flatMap(
      (shape) => filledRegionsForShape(shape) ?? [],
    );
    const trace = constructNativeTrace(multipath, defaultTraceOptions);

    expect(regions.some((region) => region.holes.length > 0)).toBe(true);
    expect(inspectSvgCapabilities(multipath).summary.disjointMultipath).toBe(
      true,
    );
    expect(trace.elements).toHaveLength(4);
    expect(
      trace.elements.every(
        (element) => element.points.at(-1)?.[0] === element.points[0]?.[0],
      ),
    ).toBe(true);
  });

  it("retains triangulation as a comparison oracle", () => {
    const document = mustParse(
      corpusFixtures.counter.source,
      corpusFixtures.counter.sourceName,
    );
    const keyhole = constructNativeTrace(document, {
      ...defaultTraceOptions,
      strategy: "keyhole",
    });
    const triangulation = constructNativeTrace(document, {
      ...defaultTraceOptions,
      strategy: "triangulation",
    });

    expect(keyhole.metrics.elements).toBeLessThan(
      triangulation.metrics.elements,
    );
    expect(keyhole.metrics.points).toBeLessThan(triangulation.metrics.points);
  });

  it("is byte-deterministic and preserves provisional budget diagnostics", () => {
    const firstDocument = mustParse(
      corpusFixtures.linuxStress.source,
      corpusFixtures.linuxStress.sourceName,
    );
    const secondDocument = mustParse(
      corpusFixtures.linuxStress.source,
      corpusFixtures.linuxStress.sourceName,
    );
    const first = constructNativeTrace(firstDocument, defaultTraceOptions);
    const second = constructNativeTrace(secondDocument, defaultTraceOptions);

    expect(deterministicTraceJson(first)).toBe(deterministicTraceJson(second));
    expect(firstDocument.metrics.pathElements).toBe(1716);
    expect(first.metrics.points).toBeGreaterThan(
      PROVISIONAL_POINT_BUDGET.perIcon,
    );
    expect(first.exceedsProvisionalBudget).toBe(true);
  });

  it("locks adaptive canonical-document and native checksums for Chromium", () => {
    const document = mustParse(
      adaptiveDeterminismFixture,
      "adaptive-determinism.svg",
    );
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(deterministicDocumentChecksum(document)).toBe(
      adaptiveDeterminismChecksums.document,
    );
    expect(deterministicTraceChecksum(trace)).toBe(
      adaptiveDeterminismChecksums.trace,
    );
  });
});
