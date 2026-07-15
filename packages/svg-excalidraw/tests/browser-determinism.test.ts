import { describe, expect, it } from "vitest";

import {
  convertSvgToExcalidraw,
  deterministicLibraryChecksum,
  parseSvg,
  serializeExcalidrawLibrary,
} from "../src";
import {
  constructNativeTrace,
  deterministicTraceChecksum,
  deterministicTraceJson,
} from "../src/lib/native";
import { deterministicDocumentChecksum } from "../src/lib/parse";
import {
  adaptiveDeterminismChecksums,
  adaptiveDeterminismFixture,
  diagnosticDeterminismChecksum,
  diagnosticDeterminismFixture,
  nonzeroDecompositionFixture,
  nonzeroDecompositionTraceChecksum,
} from "./determinism-fixtures";

const corpusMulticolorFixture =
  '<svg style="flex:none;line-height:1" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><g transform="translate(36.685 30.72) scale(19.576)"><title>vLLM</title><path d="M0 4.973h9.324V23L0 4.973z" fill="#FDB515"></path><path d="M13.986 4.351L22.378 0l-6.216 23H9.324l4.662-18.649z" fill="#30A2FF"></path></g></svg>';

describe("browser construction determinism", () => {
  it("matches production conversion and library serialization checksums", () => {
    const parsed = parseSvg(corpusMulticolorFixture, {
      sourceName: "ai-infrastructure/vllm.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const converted = convertSvgToExcalidraw(parsed.document, {
      fillStyle: "hachure",
      roughness: 2,
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      return;
    }
    const serialized = serializeExcalidrawLibrary([
      {
        elements: converted.elements,
        id: `svg:${converted.sourceHash}`,
        name: "vLLM",
      },
    ]);

    expect(deterministicLibraryChecksum(serialized)).toBe("d224b974");
    expect(serialized).toBe(
      serializeExcalidrawLibrary([
        {
          elements: converted.elements,
          id: `svg:${converted.sourceHash}`,
          name: "vLLM",
        },
      ]),
    );
  });

  it("matches the Node checksum byte-for-byte in Chromium", () => {
    const parsed = parseSvg(corpusMulticolorFixture, {
      sourceName: "ai-infrastructure/vllm.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }
    const document = parsed.document;
    const first = constructNativeTrace(document, {
      strategy: "keyhole",
      roughness: 1,
      fillStyle: "solid",
    });
    const second = constructNativeTrace(document, {
      strategy: "keyhole",
      roughness: 1,
      fillStyle: "solid",
    });

    expect(deterministicTraceJson(first)).toBe(deterministicTraceJson(second));
    expect(deterministicTraceChecksum(first)).toBe("6977f090");
  });

  it("matches adaptive parsing and nested use checksums from Node", () => {
    const parsed = parseSvg(adaptiveDeterminismFixture, {
      sourceName: "adaptive-determinism.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }
    const trace = constructNativeTrace(parsed.document, {
      strategy: "keyhole",
      roughness: 1,
      fillStyle: "solid",
    });

    expect(deterministicDocumentChecksum(parsed.document)).toBe(
      adaptiveDeterminismChecksums.document,
    );
    expect(deterministicTraceChecksum(trace)).toBe(
      adaptiveDeterminismChecksums.trace,
    );
  });

  it("matches code-unit diagnostic ordering from Node", () => {
    const parsed = parseSvg(diagnosticDeterminismFixture, {
      sourceName: "non-ascii-diagnostics.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }

    expect(
      parsed.document.diagnostics.map((entry) => entry.sourcePath),
    ).toEqual(["svg/unsupported#z[1]", "svg/unsupported#ä[0]"]);
    expect(deterministicDocumentChecksum(parsed.document)).toBe(
      diagnosticDeterminismChecksum,
    );
  });

  it("matches nonzero planar decomposition output from Node", () => {
    const parsed = parseSvg(nonzeroDecompositionFixture, {
      sourceName: "ai-apps-agents/agentvoice.svg",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }
    const trace = constructNativeTrace(parsed.document, {
      fillStyle: "solid",
      roughness: 1,
      strategy: "keyhole",
    });

    expect(trace.diagnostics).toEqual([]);
    expect(deterministicTraceChecksum(trace)).toBe(
      nonzeroDecompositionTraceChecksum,
    );
  });

  it("matches Chromium's SVG transform-list composition", () => {
    const transform =
      "translate(10 20) scale(2 3) rotate(30) skewX(10) skewY(-5)";
    const source = `<svg viewBox="0 0 100 100"><g transform="${transform}"><line x1="2" y1="4" x2="8" y2="9" stroke="#000"/></g></svg>`;
    const parsed = parseSvg(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }

    const host = document.createElement("div");
    host.innerHTML = `<svg><g transform="${transform}"></g></svg>`;
    const group = host.querySelector("g");
    if (!(group instanceof SVGGraphicsElement)) {
      throw new Error("Expected SVG graphics element");
    }
    const matrix = group.transform.baseVal.consolidate()?.matrix;
    if (!matrix) {
      throw new Error("Expected consolidated SVG transform matrix");
    }
    const points = parsed.document.shapes[0]?.subpaths[0]?.points;
    expect(points?.[0]?.x).toBeCloseTo(matrix.a * 2 + matrix.c * 4 + matrix.e);
    expect(points?.[0]?.y).toBeCloseTo(matrix.b * 2 + matrix.d * 4 + matrix.f);
    expect(points?.[1]?.x).toBeCloseTo(matrix.a * 8 + matrix.c * 9 + matrix.e);
    expect(points?.[1]?.y).toBeCloseTo(matrix.b * 8 + matrix.d * 9 + matrix.f);
  });
});
