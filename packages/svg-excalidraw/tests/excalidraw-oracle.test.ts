import {
  exportToSvg,
  loadLibraryFromBlob,
  restoreElements,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  convertSvgToExcalidraw,
  parseSvg,
  serializeExcalidrawLibrary,
  type CanonicalSvgDocument,
  type Point,
} from "../src";
import { centroid } from "../src/lib/geometry";
import { constructNativeTrace, filledRegionsForShape } from "../src/lib/native";
import type { NativeTraceOptions } from "../src/lib/types";
import { corpusFixtures } from "./corpus-fixtures";

interface RasterizedSvg {
  readonly alpha: Uint8Array;
  readonly height: number;
  readonly viewBox: readonly [number, number, number, number];
  readonly width: number;
}

function mustParse(source: string, sourceName = "inline.svg") {
  const result = parseSvg(source, { sourceName });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.document;
}

async function renderDocument(
  document: CanonicalSvgDocument,
  options: NativeTraceOptions,
) {
  const trace = constructNativeTrace(document, options);
  const restored = restoreElements(trace.elements, null, {
    refreshDimensions: false,
    repairBindings: false,
  });
  const svg = await exportToSvg({
    elements: restored,
    appState: {
      exportBackground: false,
      viewBackgroundColor: "#ffffff",
    },
    files: null,
    exportPadding: 0,
    skipInliningFonts: true,
  });
  return { restored, svg, trace };
}

async function rasterize(svg: SVGSVGElement): Promise<RasterizedSvg> {
  const viewBoxValues = (svg.getAttribute("viewBox") ?? "0 0 1 1")
    .split(/\s+/)
    .map(Number);
  const { data, info } = await sharp(Buffer.from(svg.outerHTML))
    .resize(512, 512, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    alpha[pixel] = data[pixel * info.channels + 3] ?? 0;
  }
  return {
    alpha,
    width: info.width,
    height: info.height,
    viewBox: [
      viewBoxValues[0] ?? 0,
      viewBoxValues[1] ?? 0,
      viewBoxValues[2] ?? 1,
      viewBoxValues[3] ?? 1,
    ],
  };
}

function alphaRatioNear(
  raster: RasterizedSvg,
  point: Point,
  radiusInSceneUnits: number,
): number {
  const [viewX, viewY, viewWidth, viewHeight] = raster.viewBox;
  const centerX = ((point.x - viewX) / viewWidth) * raster.width;
  const centerY = ((point.y - viewY) / viewHeight) * raster.height;
  const radiusX = Math.max(1, (radiusInSceneUnits / viewWidth) * raster.width);
  const radiusY = Math.max(
    1,
    (radiusInSceneUnits / viewHeight) * raster.height,
  );
  let opaque = 0;
  let sampled = 0;
  for (
    let y = Math.max(0, Math.floor(centerY - radiusY));
    y <= Math.min(raster.height - 1, Math.ceil(centerY + radiusY));
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.floor(centerX - radiusX));
      x <= Math.min(raster.width - 1, Math.ceil(centerX + radiusX));
      x += 1
    ) {
      const normalizedX = (x - centerX) / radiusX;
      const normalizedY = (y - centerY) / radiusY;
      if (normalizedX ** 2 + normalizedY ** 2 <= 1) {
        sampled += 1;
        if ((raster.alpha[y * raster.width + x] ?? 0) > 16) {
          opaque += 1;
        }
      }
    }
  }
  return sampled === 0 ? 0 : opaque / sampled;
}

function alphaCoverage(raster: RasterizedSvg): number {
  return (
    raster.alpha.reduce((total, alpha) => total + (alpha > 16 ? 1 : 0), 0) /
    raster.alpha.length
  );
}

function maskIntersectionOverUnion(
  left: RasterizedSvg,
  right: RasterizedSvg,
): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.alpha.length; index += 1) {
    const leftFilled = (left.alpha[index] ?? 0) > 16;
    const rightFilled = (right.alpha[index] ?? 0) > 16;
    if (leftFilled && rightFilled) {
      intersection += 1;
    }
    if (leftFilled || rightFilled) {
      union += 1;
    }
  }
  return union === 0 ? 1 : intersection / union;
}

function circleDocument(pointCount: number): CanonicalSvgDocument {
  const vertexCount = Math.max(3, pointCount - 1);
  const points = Array.from({ length: vertexCount }, (_, index) => {
    const angle = (index / vertexCount) * Math.PI * 2;
    return `${50 + Math.cos(angle) * 45},${50 + Math.sin(angle) * 45}`;
  }).join(" ");
  return mustParse(
    `<svg viewBox="0 0 100 100"><polygon fill="#000" points="${points}"/></svg>`,
    `circle-${pointCount}.svg`,
  );
}

describe("real Excalidraw renderer oracle", () => {
  const counterDocument = mustParse(
    corpusFixtures.counter.source,
    corpusFixtures.counter.sourceName,
  );
  const counterRegion = counterDocument.shapes
    .flatMap((shape) => filledRegionsForShape(shape) ?? [])
    .find((region) => region.holes.length > 0);

  it("loads deterministic library output and restores native editable elements", async () => {
    const converted = convertSvgToExcalidraw(counterDocument, {
      fillStyle: "solid",
      roughness: 1,
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      return;
    }
    const serialized = serializeExcalidrawLibrary([
      {
        elements: converted.elements,
        id: `svg:${converted.sourceHash}`,
        name: "AI21",
      },
    ]);
    const loaded = await loadLibraryFromBlob(
      new Blob([serialized], { type: "application/vnd.excalidrawlib+json" }),
    );
    const restored = restoreElements(loaded[0]?.elements ?? [], null, {
      refreshDimensions: false,
      repairBindings: false,
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      id: `svg:${converted.sourceHash}`,
      name: "AI21",
      created: 1,
      status: "published",
    });
    expect(restored).toHaveLength(converted.elements.length);
    expect(restored.every((element) => element.type === "line")).toBe(true);
    expect(restored.some((element) => element.type === "image")).toBe(false);
    expect(JSON.parse(serializeLibraryAsJSON(loaded))).toMatchObject({
      type: "excalidrawlib",
      version: 2,
      libraryItems: [{ id: `svg:${converted.sourceHash}` }],
    });
  });

  it("preserves representative edits across save, reload, and re-export", async () => {
    const converted = convertSvgToExcalidraw(counterDocument, {
      fillStyle: "solid",
      roughness: 1,
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      return;
    }
    const original = converted.elements[0];
    expect(original).toBeDefined();
    if (!original) {
      return;
    }
    const loadAndRestore = async (serialized: string) => {
      const items = await loadLibraryFromBlob(
        new Blob([serialized], {
          type: "application/vnd.excalidrawlib+json",
        }),
      );
      return restoreElements(items[0]?.elements ?? [], null, {
        refreshDimensions: false,
        repairBindings: false,
      });
    };
    const serialize = (
      elements: Parameters<
        typeof serializeExcalidrawLibrary
      >[0][number]["elements"],
    ) =>
      serializeExcalidrawLibrary([
        {
          elements,
          id: `svg:${converted.sourceHash}`,
          name: "Edited AI21",
        },
      ]);
    const baseline = await loadAndRestore(serialize(converted.elements));
    const baselineElement = baseline.find(
      (element) => element.id === original.id,
    );
    expect(baselineElement).toBeDefined();
    if (!baselineElement) {
      return;
    }

    const editedElements = converted.elements.map((element, index) =>
      index === 0
        ? {
            ...element,
            backgroundColor: "#ff006e",
            groupIds: ["edited:group"],
            strokeColor: "#ff006e",
            version: element.version + 1,
            x: element.x + 37,
            y: element.y + 19,
          }
        : element,
    );
    const restored = await loadAndRestore(serialize(editedElements));
    const edited = restored.find((element) => element.id === original.id);
    expect(edited).toMatchObject({
      backgroundColor: "#ff006e",
      groupIds: ["edited:group"],
      strokeColor: "#ff006e",
      x: baselineElement.x + 37,
      y: baselineElement.y + 19,
    });
    if (!edited) {
      return;
    }

    const reloaded = await loadAndRestore(serialize(restored));
    expect(
      reloaded.find((element) => element.id === original.id),
    ).toMatchObject({
      backgroundColor: edited.backgroundColor,
      groupIds: edited.groupIds,
      strokeColor: edited.strokeColor,
      x: edited.x,
      y: edited.y,
    });
  });

  it("round-trips and renders keyhole and true hole-eliminating triangulation", async () => {
    expect(counterRegion).toBeDefined();
    const hole = counterRegion?.holes[0];
    expect(hole).toBeDefined();
    const holeCenter = centroid(hole ?? []);
    const combinations = [
      ...(["keyhole", "triangulation"] as const).flatMap((strategy) =>
        ([0, 1, 2] as const).flatMap((roughness) =>
          (["solid", "hachure"] as const).map((fillStyle) => ({
            strategy,
            roughness,
            fillStyle,
          })),
        ),
      ),
    ];
    const evidence = [];

    for (const options of combinations) {
      const rendered = await renderDocument(counterDocument, options);
      const raster = await rasterize(rendered.svg);
      const holeAlpha = alphaRatioNear(raster, holeCenter, 1.5);
      evidence.push({
        ...options,
        elements: rendered.trace.metrics.elements,
        points: rendered.trace.metrics.points,
        svgBytes: Buffer.byteLength(rendered.svg.outerHTML),
        holeAlpha: Number(holeAlpha.toFixed(4)),
      });

      expect(rendered.restored).toHaveLength(rendered.trace.elements.length);
      expect(rendered.svg.querySelectorAll("path").length).toBeGreaterThan(0);
      expect(holeAlpha).toBeLessThan(0.12);
    }

    const keyhole = evidence.find(
      (entry) =>
        entry.strategy === "keyhole" &&
        entry.roughness === 1 &&
        entry.fillStyle === "solid",
    );
    const triangulation = evidence.find(
      (entry) =>
        entry.strategy === "triangulation" &&
        entry.roughness === 1 &&
        entry.fillStyle === "solid",
    );
    expect(keyhole?.elements).toBeLessThan(triangulation?.elements ?? 0);
    expect(keyhole?.points).toBeLessThan(triangulation?.points ?? 0);
  });

  it("preserves a self-intersecting evenodd contour as one native line", async () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#000" fill-rule="evenodd" d="M0 0L20 20L0 20L20 0Z"/></svg>';
    const document = mustParse(source);
    const converted = convertSvgToExcalidraw(document, { roughness: 0 });
    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      return;
    }
    const rendered = await renderDocument(document, {
      strategy: "keyhole",
      roughness: 0,
      fillStyle: "solid",
      compoundEvenOdd: true,
      fillCarrierStrokeWidth: 0.5,
    });
    const host = window.document.createElement("div");
    host.innerHTML = source;
    const sourceSvg = host.querySelector("svg");
    if (!(sourceSvg instanceof SVGSVGElement)) {
      throw new Error("Expected source SVG element");
    }

    expect(converted.elements).toHaveLength(1);
    expect(
      maskIntersectionOverUnion(
        await rasterize(sourceSvg),
        await rasterize(rendered.svg),
      ),
    ).toBeGreaterThan(0.9);
  });

  it("preserves compound evenodd parity across islands, overlaps, and deep nesting", async () => {
    const sources = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20"><path fill="#000" fill-rule="evenodd" d="M0 0H20V20H0Z M5 5H15V15H5Z M40 0H60V20H40Z M45 5H55V15H45Z"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><path fill="#000" fill-rule="evenodd" d="M0 0H20V20H0Z M10 0H30V20H10Z"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path fill="#000" fill-rule="evenodd" d="M0 0H30V30H0Z M5 5H25V25H5Z M10 10H20V20H10Z"/></svg>',
    ];

    for (const source of sources) {
      const document = mustParse(source);
      const converted = convertSvgToExcalidraw(document, { roughness: 0 });
      expect(converted.ok).toBe(true);
      if (!converted.ok) {
        continue;
      }
      const rendered = await renderDocument(document, {
        strategy: "keyhole",
        roughness: 0,
        fillStyle: "solid",
        compoundEvenOdd: true,
        fillCarrierStrokeWidth: 0.5,
      });
      const host = window.document.createElement("div");
      host.innerHTML = source;
      const sourceSvg = host.querySelector("svg");
      if (!(sourceSvg instanceof SVGSVGElement)) {
        throw new Error("Expected source SVG element");
      }

      expect(converted.elements).toHaveLength(1);
      expect(converted.elements[0]?.strokeColor).toBe("transparent");
      expect(
        maskIntersectionOverUnion(
          await rasterize(sourceSvg),
          await rasterize(rendered.svg),
        ),
      ).toBeGreaterThan(0.95);
    }
  });

  it("renders nonzero winding and evenodd nesting with different topology", async () => {
    const cases = [
      {
        name: "nonzero-same-winding",
        fillRule: "nonzero",
        innerPath: "M5 5H15V15H5",
      },
      {
        name: "nonzero-opposite-winding",
        fillRule: "nonzero",
        innerPath: "M5 5V15H15V5",
      },
      {
        name: "evenodd-same-winding",
        fillRule: "evenodd",
        innerPath: "M5 5H15V15H5",
      },
    ] as const;
    const evidence = [];
    for (const testCase of cases) {
      const document = mustParse(
        `<svg viewBox="0 0 20 20"><path fill="#000" fill-rule="${testCase.fillRule}" d="M0 0H20V20H0 ${testCase.innerPath}"/></svg>`,
      );
      const rendered = await renderDocument(document, {
        strategy: "keyhole",
        roughness: 0,
        fillStyle: "solid",
      });
      const centerAlpha = alphaRatioNear(
        await rasterize(rendered.svg),
        { x: 10, y: 10 },
        1,
      );
      evidence.push({
        name: testCase.name,
        centerAlpha: Number(centerAlpha.toFixed(4)),
      });
    }

    expect(evidence[0]?.centerAlpha).toBeGreaterThan(0.9);
    expect(evidence[1]?.centerAlpha).toBeLessThan(0.12);
    expect(evidence[2]?.centerAlpha).toBeLessThan(0.12);
  });

  it("proves closed line fills at roughness 0/1/2 for solid and hachure", async () => {
    const rectangle = mustParse(
      '<svg viewBox="0 0 100 100"><path fill="#ff0000" d="M0 0h100v100H0z"/></svg>',
    );
    const outputs = new Set<string>();
    for (const roughness of [0, 1, 2] as const) {
      for (const fillStyle of ["solid", "hachure"] as const) {
        const rendered = await renderDocument(rectangle, {
          strategy: "keyhole",
          roughness,
          fillStyle,
        });
        const raster = await rasterize(rendered.svg);
        outputs.add(rendered.svg.outerHTML);
        expect(rendered.trace.elements[0]?.points.at(-1)).toEqual(
          rendered.trace.elements[0]?.points[0],
        );
        expect(alphaCoverage(raster)).toBeGreaterThan(
          fillStyle === "solid" ? 0.8 : 0.05,
        );
      }
    }
    expect(outputs.size).toBe(6);
  });

  it("measures candidate point thresholds and sparse curved-line fidelity", async () => {
    const reference = await renderDocument(circleDocument(512), {
      strategy: "keyhole",
      roughness: 0,
      fillStyle: "solid",
      roundness: "sharp",
    });
    const referenceRaster = await rasterize(reference.svg);
    const candidateBudgetEvidence = [];
    for (const pointCount of [64, 128, 256, 512]) {
      for (const roughness of [1, 2] as const) {
        for (const fillStyle of ["solid", "hachure"] as const) {
          const rendered = await renderDocument(circleDocument(pointCount), {
            strategy: "keyhole",
            roughness,
            fillStyle,
            roundness: "sharp",
          });
          const raster = await rasterize(rendered.svg);
          expect(rendered.trace.metrics.maxPointsPerElement).toBe(pointCount);
          expect(rendered.trace.exceedsProvisionalBudget).toBe(
            pointCount > 256,
          );
          candidateBudgetEvidence.push({
            pointCount,
            roughness,
            fillStyle,
            svgBytes: Buffer.byteLength(rendered.svg.outerHTML),
            iou: Number(
              maskIntersectionOverUnion(referenceRaster, raster).toFixed(4),
            ),
          });
        }
      }
    }
    const roundnessEvidence = [];
    for (const pointCount of [16, 32, 64]) {
      for (const roundness of ["sharp", "curved"] as const) {
        const rendered = await renderDocument(circleDocument(pointCount), {
          strategy: "keyhole",
          roughness: 1,
          fillStyle: "solid",
          roundness,
        });
        const raster = await rasterize(rendered.svg);
        roundnessEvidence.push({
          pointCount,
          roundness,
          svgBytes: Buffer.byteLength(rendered.svg.outerHTML),
          iou: Number(
            maskIntersectionOverUnion(referenceRaster, raster).toFixed(4),
          ),
        });
      }
    }
    expect(candidateBudgetEvidence).toHaveLength(16);
    expect(roundnessEvidence).toHaveLength(6);
    const candidateThreshold = candidateBudgetEvidence.find(
      (entry) =>
        entry.pointCount === 256 &&
        entry.roughness === 2 &&
        entry.fillStyle === "solid",
    );
    const aboveCandidateThreshold = candidateBudgetEvidence.find(
      (entry) =>
        entry.pointCount === 512 &&
        entry.roughness === 2 &&
        entry.fillStyle === "solid",
    );
    expect(aboveCandidateThreshold?.svgBytes ?? 0).toBeGreaterThan(
      (candidateThreshold?.svgBytes ?? 0) * 1.9,
    );
    expect(aboveCandidateThreshold?.iou ?? 1).toBeLessThan(
      candidateThreshold?.iou ?? 0,
    );
    for (const pointCount of [16, 32, 64]) {
      const sharpEvidence = roundnessEvidence.find(
        (entry) =>
          entry.pointCount === pointCount && entry.roundness === "sharp",
      );
      const curvedEvidence = roundnessEvidence.find(
        (entry) =>
          entry.pointCount === pointCount && entry.roundness === "curved",
      );
      expect(curvedEvidence?.iou ?? 1).toBeLessThanOrEqual(
        sharpEvidence?.iou ?? 0,
      );
    }
  });
});
