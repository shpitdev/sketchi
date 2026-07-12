import { exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  centroid,
  constructNativeTrace,
  filledRegionsForShape,
  parseSvgForFillSpike,
  type CanonicalSvgDocument,
  type NativeTraceOptions,
  type Point,
} from "../src";
import checkedEvidence from "../evidence/fill-spike-metrics.json";
import { corpusFixtures } from "./corpus-fixtures";

interface RasterizedSvg {
  readonly alpha: Uint8Array;
  readonly height: number;
  readonly viewBox: readonly [number, number, number, number];
  readonly width: number;
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
  return parseSvgForFillSpike(
    `<svg viewBox="0 0 100 100"><polygon fill="#000" points="${points}"/></svg>`,
    { sourceName: `circle-${pointCount}.svg` },
  );
}

describe("real Excalidraw renderer oracle", () => {
  const counterDocument = parseSvgForFillSpike(corpusFixtures.counter.source, {
    sourceName: corpusFixtures.counter.sourceName,
  });
  const counterRegion = counterDocument.shapes
    .flatMap(filledRegionsForShape)
    .find((region) => region.holes.length > 0);

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
    expect(evidence).toEqual(checkedEvidence.counterHoleMatrix);
    expect(keyhole?.elements).toBeLessThan(triangulation?.elements ?? 0);
    expect(keyhole?.points).toBeLessThan(triangulation?.points ?? 0);
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
      const document = parseSvgForFillSpike(
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

    expect(evidence).toEqual(checkedEvidence.fillRuleMatrix);
    expect(evidence[0]?.centerAlpha).toBeGreaterThan(0.9);
    expect(evidence[1]?.centerAlpha).toBeLessThan(0.12);
    expect(evidence[2]?.centerAlpha).toBeLessThan(0.12);
  });

  it("proves closed line fills at roughness 0/1/2 for solid and hachure", async () => {
    const rectangle = parseSvgForFillSpike(
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
    expect(candidateBudgetEvidence).toEqual(
      checkedEvidence.candidatePointBudgetMatrix,
    );
    expect(checkedEvidence.candidatePointThresholdDecision).toEqual({
      status: "provisional",
      perElement: 256,
      perIcon: 4096,
      evidenceScope: "synthetic circles at 64, 128, 256, and 512 points",
      limitation:
        "not representative enough for production rejection or simplification",
    });
    expect(roundnessEvidence).toEqual(checkedEvidence.roundnessMatrix);
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
