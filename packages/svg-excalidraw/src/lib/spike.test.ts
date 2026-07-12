// @vitest-environment node

import { describe, expect, it } from "vitest";

import checkedEvidence from "../../evidence/fill-spike-metrics.json";
import { corpusFixtures } from "../../tests/corpus-fixtures";
import { filledRegionsForShape } from "./native";
import {
  constructNativeTrace,
  deterministicTraceChecksum,
  deterministicTraceJson,
  PROVISIONAL_POINT_BUDGET,
} from "./native";
import { parseSvgForFillSpike } from "./parse";

const defaultTraceOptions = {
  fillStyle: "solid",
  roughness: 1,
  strategy: "keyhole",
} as const;

describe("fill-first canonical spike IR", () => {
  it("finds a genuine counter in the AI21 wordmark", () => {
    const document = parseSvgForFillSpike(corpusFixtures.counter.source, {
      sourceName: corpusFixtures.counter.sourceName,
    });
    const regions = document.shapes.flatMap(filledRegionsForShape);

    expect(document.capabilities.evenOdd).toBe(true);
    expect(regions.some((region) => region.holes.length > 0)).toBe(true);
  });

  it("preserves direct multicolor paint", () => {
    const document = parseSvgForFillSpike(corpusFixtures.multicolor.source, {
      sourceName: corpusFixtures.multicolor.sourceName,
    });

    expect(document.capabilities.multicolor).toBe(true);
    expect(document.shapes.map((shape) => shape.fill?.color)).toEqual([
      "#fdb515",
      "#30a2ff",
    ]);
  });

  it("flattens a corpus gradient to a deterministic representative color", () => {
    const document = parseSvgForFillSpike(corpusFixtures.gradient.source, {
      sourceName: corpusFixtures.gradient.sourceName,
    });

    expect(document.capabilities.gradient).toBe(true);
    expect(document.warnings).toContain(
      "gradient-flattened-to-representative-color",
    );
    expect(document.shapes[0]?.fill).toMatchObject({
      color: "#d211ec",
      source: "gradient",
    });
  });

  it("resolves style-driven paint from a corpus style block", () => {
    const document = parseSvgForFillSpike(corpusFixtures.stylePaint.source, {
      sourceName: corpusFixtures.stylePaint.sourceName,
    });

    expect(document.capabilities.stylePaint).toBe(true);
    expect(document.shapes[0]?.fill).toMatchObject({
      color: "#4285f4",
      source: "style",
    });
  });

  it("detects a real path clip and refuses to label it as native", () => {
    const document = parseSvgForFillSpike(corpusFixtures.realClip.source, {
      sourceName: corpusFixtures.realClip.sourceName,
    });
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(document.capabilities.realClip).toBe(true);
    expect(document.warnings).toContain("real-clip-native-unsupported");
    expect(trace.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^native-unsupported-real-clip:/),
      ]),
    );
    expect(trace.elements).toHaveLength(0);
  });

  it("keeps stroke-only corpus geometry unfilled", () => {
    const document = parseSvgForFillSpike(corpusFixtures.strokeOnly.source, {
      sourceName: corpusFixtures.strokeOnly.sourceName,
    });
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(document.capabilities.strokeOnly).toBe(true);
    expect(document.shapes.map((shape) => shape.strokeWidth)).toEqual([
      47.94, 47.94,
    ]);
    expect(trace.elements).toHaveLength(2);
    expect(
      trace.elements.every(
        (element) => element.backgroundColor === "transparent",
      ),
    ).toBe(true);
  });

  it("implicitly closes open fill subpaths without closing their strokes", () => {
    const document = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#f00" stroke="#000" d="M1 1h18v18H1"/></svg>',
    );
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(document.metrics.openSubpaths).toBe(1);
    expect(trace.elements).toHaveLength(2);
    expect(trace.elements[0]?.backgroundColor).toBe("#ff0000");
    expect(trace.elements[0]?.strokeColor).toBe("#ff0000");
    expect(trace.elements[0]?.strokeWidth).toBe(0.5);
    expect(trace.elements[0]?.points.at(-1)).toEqual(
      trace.elements[0]?.points[0],
    );
    expect(trace.elements[1]?.backgroundColor).toBe("transparent");
    expect(trace.elements[1]?.strokeColor).toBe("#000000");
    expect(trace.elements[1]?.strokeWidth).toBe(1);
    expect(trace.elements[1]?.points.at(-1)).not.toEqual(
      trace.elements[1]?.points[0],
    );
  });

  it("uses nonzero winding instead of treating every nested contour as a hole", () => {
    const sameWinding = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="nonzero" d="M0 0H20V20H0 M5 5H15V15H5"/></svg>',
    );
    const oppositeWinding = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="nonzero" d="M0 0H20V20H0 M5 5V15H15V5"/></svg>',
    );
    const evenOdd = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="evenodd" d="M0 0H20V20H0 M5 5H15V15H5"/></svg>',
    );
    const clipRuleOnly = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#000" clip-rule="evenodd" d="M0 0H20V20H0 M5 5H15V15H5"/></svg>',
    );

    expect(sameWinding.shapes[0]?.fillRule).toBe("nonzero");
    expect(filledRegionsForShape(sameWinding.shapes[0] ?? failShape())).toEqual(
      [expect.objectContaining({ holes: [] })],
    );
    expect(
      filledRegionsForShape(oppositeWinding.shapes[0] ?? failShape())[0]?.holes,
    ).toHaveLength(1);
    expect(
      filledRegionsForShape(evenOdd.shapes[0] ?? failShape())[0]?.holes,
    ).toHaveLength(1);
    expect(clipRuleOnly.shapes[0]?.fillRule).toBe("nonzero");
    expect(
      filledRegionsForShape(clipRuleOnly.shapes[0] ?? failShape())[0]?.holes,
    ).toHaveLength(0);
  });

  it("diagnoses intersecting nonzero contours instead of misclassifying them", () => {
    const document = parseSvgForFillSpike(
      '<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="nonzero" d="M0 0H12V12H0 M8 8H20V20H8"/></svg>',
    );
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(trace.elements).toHaveLength(0);
    expect(trace.diagnostics).toContain(
      "native-unsupported-nonzero-intersecting-contours:shape:0",
    );
  });

  it("does not connect disjoint M subpaths", () => {
    const document = parseSvgForFillSpike(
      corpusFixtures.v1DisjointMultipath.source,
      {
        sourceName: corpusFixtures.v1DisjointMultipath.sourceName,
      },
    );
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(document.capabilities.disjointMultipath).toBe(true);
    expect(trace.elements).toHaveLength(4);
    expect(
      new Set(
        trace.elements.map(
          (element) =>
            `${element.x + element.width / 2 < 256 ? "left" : "right"}-${
              element.y + element.height / 2 < 256 ? "top" : "bottom"
            }`,
        ),
      ),
    ).toEqual(
      new Set(["left-top", "right-top", "left-bottom", "right-bottom"]),
    );
    expect(trace.elements.every((element) => element.width < 256)).toBe(true);
    expect(trace.elements.every((element) => element.height < 256)).toBe(true);
  });

  it("implicitly closes every filled Linux path and reports the provisional threshold", () => {
    const document = parseSvgForFillSpike(corpusFixtures.linuxStress.source, {
      sourceName: corpusFixtures.linuxStress.sourceName,
    });
    const trace = constructNativeTrace(document, defaultTraceOptions);

    const implicitlyClosedFilledShapes = document.shapes.filter(
      (shape) =>
        shape.fill !== null &&
        shape.subpaths.length > 0 &&
        shape.subpaths.every((subpath) => !subpath.closed),
    ).length;
    expect({
      fixture: corpusFixtures.linuxStress.sourceName,
      sourceBytes: Buffer.byteLength(corpusFixtures.linuxStress.source),
      pathElements: document.metrics.pathElements,
      implicitlyClosedFilledShapes,
      constructedPoints: trace.metrics.points,
      provisionalIconThreshold: PROVISIONAL_POINT_BUDGET.perIcon,
    }).toEqual(checkedEvidence.linuxStress);
    expect(implicitlyClosedFilledShapes).toBe(1584);
    expect(document.metrics.points).toBeGreaterThan(
      PROVISIONAL_POINT_BUDGET.perIcon,
    );
    expect(trace.exceedsProvisionalBudget).toBe(true);
    expect(trace.metrics.points).toBe(92105);
    expect(
      trace.diagnostics.some((diagnostic) =>
        diagnostic.startsWith("provisional-point-budget-per-icon:"),
      ),
    ).toBe(true);
  });

  it("constructs byte-identical elements with stable ids, seeds, and ordering", () => {
    const firstDocument = parseSvgForFillSpike(corpusFixtures.counter.source, {
      sourceName: corpusFixtures.counter.sourceName,
    });
    const secondDocument = parseSvgForFillSpike(corpusFixtures.counter.source, {
      sourceName: corpusFixtures.counter.sourceName,
    });
    const first = constructNativeTrace(firstDocument, defaultTraceOptions);
    const second = constructNativeTrace(secondDocument, defaultTraceOptions);

    expect(deterministicTraceJson(first)).toBe(deterministicTraceJson(second));
    expect(first.elements.every((element) => element.type === "line")).toBe(
      true,
    );
  });

  it("matches the browser construction checksum", () => {
    const document = parseSvgForFillSpike(corpusFixtures.multicolor.source, {
      sourceName: corpusFixtures.multicolor.sourceName,
    });
    const trace = constructNativeTrace(document, defaultTraceOptions);

    expect(trace.diagnostics).toEqual([]);
    expect(trace.elements).toHaveLength(2);
    expect(deterministicTraceChecksum(trace)).toBe("6977f090");
  });
});

function failShape(): never {
  throw new Error("Expected parsed shape");
}
