// @vitest-environment node

import { describe, expect, it } from "vitest";

import { corpusFixtures } from "../../tests/corpus-fixtures";
import { convertSvgToExcalidraw } from "./convert";
import { serializeExcalidrawLibrary } from "./library";
import { parseSvg } from "./parse";

function mustParse(source: string, sourceName = "inline.svg") {
  const parsed = parseSvg(source, { sourceName });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  return parsed.document;
}

describe("production native conversion", () => {
  it("fails closed with typed diagnostics for unsupported SVG semantics", () => {
    const document = mustParse(
      corpusFixtures.realClip.source,
      corpusFixtures.realClip.sourceName,
    );
    const result = convertSvgToExcalidraw(document);

    expect(result).toMatchObject({
      ok: false,
      reason: "native-unsupported",
      elements: [],
      metrics: { elements: 0, points: 0, maxPointsPerElement: 0 },
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "native-capability-blocked",
    );
  });

  it("preserves source colors or applies an explicit monochrome profile", () => {
    const document = mustParse(
      corpusFixtures.multicolor.source,
      corpusFixtures.multicolor.sourceName,
    );
    const preserved = convertSvgToExcalidraw(document, { roughness: 0 });
    const monochrome = convertSvgToExcalidraw(document, {
      colorProfile: { color: "#5f3dc4", kind: "monochrome" },
      roughness: 0,
    });

    expect(preserved.ok).toBe(true);
    expect(monochrome.ok).toBe(true);
    if (!(preserved.ok && monochrome.ok)) {
      return;
    }
    expect(
      new Set(preserved.elements.map((element) => element.backgroundColor)),
    ).toEqual(new Set(["#fdb515", "#30a2ff"]));
    expect(
      new Set(monochrome.elements.map((element) => element.backgroundColor)),
    ).toEqual(new Set(["#5f3dc4"]));
    expect(monochrome.options).toEqual({
      colorProfile: { color: "#5f3dc4", kind: "monochrome" },
      fillStyle: "solid",
      provisionalPointBudget: { perElement: 256, perIcon: 4096 },
      roughness: 0,
    });
  });

  it("retains gradient flattening and provisional budgets as warnings", () => {
    const gradient = convertSvgToExcalidraw(
      mustParse(
        corpusFixtures.gradient.source,
        corpusFixtures.gradient.sourceName,
      ),
    );
    const stress = convertSvgToExcalidraw(
      mustParse(
        corpusFixtures.linuxStress.source,
        corpusFixtures.linuxStress.sourceName,
      ),
    );

    expect(gradient.ok).toBe(true);
    expect(gradient.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "gradient-flattened",
    );
    expect(stress.ok).toBe(true);
    expect(stress.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "provisional-point-budget-per-icon",
    );
  });

  it("is byte deterministic and serializes stable v2 library JSON", () => {
    const document = mustParse(
      corpusFixtures.counter.source,
      corpusFixtures.counter.sourceName,
    );
    const first = convertSvgToExcalidraw(document, {
      fillStyle: "hachure",
      roughness: 2,
    });
    const second = convertSvgToExcalidraw(document, {
      fillStyle: "hachure",
      roughness: 2,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!(first.ok && second.ok)) {
      return;
    }

    const serialize = () =>
      serializeExcalidrawLibrary([
        {
          elements: first.elements,
          id: `svg:${first.sourceHash}`,
          name: "AI21",
        },
      ]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(serialize()).toBe(serialize());
    expect(JSON.parse(serialize())).toMatchObject({
      type: "excalidrawlib",
      version: 2,
      source: "https://sketchi.app",
      libraryItems: [
        {
          id: `svg:${first.sourceHash}`,
          name: "AI21",
          created: 1,
          status: "published",
        },
      ],
    });
  });

  it("decomposes self-intersecting nonzero topology into simple elements", () => {
    const document = mustParse(
      '<svg viewBox="0 0 20 20"><path fill="#000" d="M0 0L20 20L0 20L20 0Z"/></svg>',
    );
    const result = convertSvgToExcalidraw(document);

    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(2);
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.code),
    ).not.toContain("native-unsupported-topology");
  });

  it.each([0.4, 0.51])(
    "preserves both lobes of a sub-unit bow-tie at a huge offset (span %s)",
    (span) => {
      const origin = 999_999_999_999;
      const end = origin + span;
      const document = mustParse(
        `<svg><path fill="#000" d="M${origin} ${origin}L${end} ${end}L${origin} ${end}L${end} ${origin}Z"/></svg>`,
      );
      const result = convertSvgToExcalidraw(document, { roughness: 0 });

      expect(result.ok).toBe(true);
      expect(result.elements).toHaveLength(2);
      expect(result.metrics.elements).toBe(2);
      expect(result.metrics.points).toBeGreaterThan(0);
    },
  );

  it("fails closed instead of returning partial output when quantization collapses a contour", () => {
    const document = mustParse(
      '<svg><path fill="#000" d="M0 0L999999999999 999999999999L0 999999999999L999999999999 0Z M10.1 10.1L10.4 10.4L10.1 10.4L10.4 10.1Z"/></svg>',
    );
    const result = convertSvgToExcalidraw(document, { roughness: 0 });

    expect(result.ok).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.metrics).toEqual({
      elements: 0,
      maxPointsPerElement: 0,
      points: 0,
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "native-unsupported-topology",
    );
  });

  it("fails closed when exact-integer limits would let Clipper drop a thin contour", () => {
    const document = mustParse(
      '<svg><path fill="#000" d="M0 0L1000000000 999999999L1000100000 1000099999Z M-20 0L-10 10L-20 10L-10 0Z"/></svg>',
    );
    const result = convertSvgToExcalidraw(document, { roughness: 0 });

    expect(result.ok).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.metrics).toEqual({
      elements: 0,
      maxPointsPerElement: 0,
      points: 0,
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "native-unsupported-topology",
    );
  });

  it.each([
    [
      "20,000,000",
      "M0 0L20000000 19999999L20100000 20099999Z M30000000 0L40000000 10000000L30000000 10000000L40000000 0Z",
    ],
    [
      "40,000,000",
      "M0 0L40000000 39999999L40100000 40099999Z M50000000 0L60000000 10000000L50000000 10000000L60000000 0Z",
    ],
  ])(
    "fails closed when Clipper drops a thin contour around %s below its integer limit",
    (_coordinate, path) => {
      const document = mustParse(`<svg><path fill="#000" d="${path}"/></svg>`);
      const result = convertSvgToExcalidraw(document, { roughness: 0 });

      expect(result.ok).toBe(false);
      expect(result.elements).toEqual([]);
      expect(result.metrics).toEqual({
        elements: 0,
        maxPointsPerElement: 0,
        points: 0,
      });
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "native-unsupported-topology",
      );
    },
  );

  it.each([
    {
      name: "missingFill",
      path: "M0 0L40000000 39999999L40100000 40099999L0 0L50000000 0L60000000 0L60000000 10000000L50000000 10000000L50000000 0L0 0Z",
    },
    {
      name: "missingHole",
      path: "M0 0H60100000V60100000H0V0L60100000 60099999L60000000 59999999L0 0Z",
    },
  ])(
    "fails closed instead of returning one partial element for $name",
    ({ path }) => {
      const document = mustParse(`<svg><path fill="#000" d="${path}"/></svg>`);
      const result = convertSvgToExcalidraw(document, { roughness: 0 });

      expect(result.ok).toBe(false);
      expect(result.elements).toEqual([]);
      expect(result.metrics).toEqual({
        elements: 0,
        maxPointsPerElement: 0,
        points: 0,
      });
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "native-unsupported-topology",
      );
    },
  );

  it("fails closed when nonzero topology cannot be decomposed safely", () => {
    const document = mustParse(
      '<svg viewBox="0 0 2000000000000 2000000000000"><path fill="#000" d="M0 0L2000000000000 2000000000000L0 2000000000000L2000000000000 0Z"/></svg>',
    );
    const result = convertSvgToExcalidraw(document);

    expect(result.ok).toBe(false);
    expect(result.elements).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "native-unsupported-topology",
    );
  });

  it("preserves one self-intersecting evenodd contour as one native line", () => {
    const document = mustParse(
      '<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="evenodd" d="M0 0L20 20L0 20L20 0Z"/></svg>',
    );
    const result = convertSvgToExcalidraw(document, { roughness: 0 });

    expect(result.ok).toBe(true);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.points).toHaveLength(5);
  });

  it("keeps compound evenodd parity in one transparently bridged element", () => {
    const result = convertSvgToExcalidraw(
      mustParse(
        '<svg viewBox="0 0 30 10"><path fill="#000" fill-rule="evenodd" d="M0 0H10V10H0Z M20 0H30V10H20Z"/></svg>',
      ),
      { roughness: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      backgroundColor: "#000000",
      strokeColor: "transparent",
      strokeWidth: 0.5,
    });
  });

  it("separates fill and stroke when their opacity differs", () => {
    const result = convertSvgToExcalidraw(
      mustParse(
        '<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="#f00" fill-opacity=".25" stroke="#00f" stroke-opacity=".8" stroke-width="2"/></svg>',
      ),
      { roughness: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toMatchObject({
      backgroundColor: "#ff0000",
      opacity: 25,
      strokeColor: "#ff0000",
      strokeWidth: 0.5,
    });
    expect(result.elements[1]).toMatchObject({
      backgroundColor: "transparent",
      opacity: 80,
      strokeColor: "#0000ff",
      strokeWidth: 2,
    });
  });

  it("preserves each source stroke when nonzero overlap is decomposed", () => {
    const result = convertSvgToExcalidraw(
      mustParse(
        '<svg><path fill="#f00" stroke="#00f" stroke-width="2" d="M0 0H20V20H0Z M10 0H30V20H10Z"/></svg>',
      ),
      { roughness: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const fillElements = result.elements.filter(
      ({ backgroundColor }) => backgroundColor !== "transparent",
    );
    const strokeElements = result.elements.filter(
      ({ backgroundColor }) => backgroundColor === "transparent",
    );
    expect(fillElements).toHaveLength(1);
    expect(fillElements[0]).toMatchObject({
      backgroundColor: "#ff0000",
      strokeColor: "#ff0000",
    });
    expect(strokeElements).toHaveLength(2);
    expect(
      strokeElements.map(({ points, strokeColor, strokeWidth }) => ({
        points: points.length,
        strokeColor,
        strokeWidth,
      })),
    ).toEqual([
      { points: 5, strokeColor: "#0000ff", strokeWidth: 2 },
      { points: 5, strokeColor: "#0000ff", strokeWidth: 2 },
    ]);
  });

  it("preserves source strokes when opposite nonzero winding cancels the fill", () => {
    const result = convertSvgToExcalidraw(
      mustParse(
        '<svg><path fill="#f00" stroke="#00f" stroke-width="2" d="M0 0V20H20V0Z M0 0H20V20H0Z"/></svg>',
      ),
      { roughness: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.elements).toHaveLength(2);
    expect(
      result.elements.map(
        ({ backgroundColor, points, strokeColor, strokeWidth }) => ({
          backgroundColor,
          points: points.length,
          strokeColor,
          strokeWidth,
        }),
      ),
    ).toEqual([
      {
        backgroundColor: "transparent",
        points: 5,
        strokeColor: "#0000ff",
        strokeWidth: 2,
      },
      {
        backgroundColor: "transparent",
        points: 5,
        strokeColor: "#0000ff",
        strokeWidth: 2,
      },
    ]);
  });

  it("suppresses an explicit zero-width source stroke", () => {
    const result = convertSvgToExcalidraw(
      mustParse(
        '<svg viewBox="0 0 20 20"><rect width="20" height="20" fill="#f00" stroke="#00f" stroke-width="0"/></svg>',
      ),
      { roughness: 0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({
      backgroundColor: "#ff0000",
      strokeColor: "#ff0000",
      strokeWidth: 0.5,
    });
  });
});
