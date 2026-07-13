import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  convertSvgToExcalidraw,
  parseSvg,
  type CanonicalSvgDocument,
} from "../src";
import { isBlockingSvgDiagnostic } from "../src/lib/capabilities";
import {
  contoursAreNestedOrDisjoint,
  keyholeBridgeIsSafe,
  regionsFromRings,
} from "../src/lib/geometry";

const RASTER_SIZE = 128;

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

interface BlockedDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourcePath?: string | null;
}

interface BlockedRow {
  readonly blockerCodes: readonly string[];
  readonly conversionCodes: readonly string[];
  readonly diagnostics: readonly BlockedDiagnostic[];
  readonly path: string;
}

function blockerSummary(rows: readonly BlockedRow[]) {
  const signatures = new Map<string, { count: number; paths: string[] }>();
  const codes = new Map<string, { count: number; paths: string[] }>();
  for (const row of rows) {
    const signature = row.blockerCodes.join("+");
    const signatureEntry = signatures.get(signature) ?? {
      count: 0,
      paths: [],
    };
    signatureEntry.count += 1;
    signatureEntry.paths.push(row.path);
    signatures.set(signature, signatureEntry);
    for (const code of row.blockerCodes) {
      const codeEntry = codes.get(code) ?? { count: 0, paths: [] };
      codeEntry.count += 1;
      codeEntry.paths.push(row.path);
      codes.set(code, codeEntry);
    }
  }
  const sortedEntries = (
    entries: ReadonlyMap<string, { count: number; paths: string[] }>,
  ) =>
    [...entries.entries()]
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          right.count - left.count ||
          (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
      )
      .map(([key, value]) => ({ key, ...value }));
  return {
    byCode: sortedEntries(codes),
    bySignature: sortedEntries(signatures),
    rows,
  };
}

function preDecompositionTopologyDiagnostic(
  document: CanonicalSvgDocument,
): BlockedDiagnostic | null {
  for (const shape of document.shapes) {
    if (shape.fill === null || shape.fillRule === "evenodd") {
      continue;
    }
    const rings = shape.subpaths.map((subpath) => subpath.points);
    if (!contoursAreNestedOrDisjoint(rings)) {
      return {
        code: "native-unsupported-topology",
        message:
          "Intersecting, touching, or self-intersecting contours cannot be represented safely as native Excalidraw fill geometry.",
        sourcePath: shape.sourcePath,
      };
    }
    if (
      regionsFromRings(rings, shape.fillRule).some(
        (region) => !keyholeBridgeIsSafe(region),
      )
    ) {
      return {
        code: "native-unsupported-topology",
        message:
          "The fill contains a hole that cannot be bridged without crossing an unfilled region.",
        sourcePath: shape.sourcePath,
      };
    }
  }
  return null;
}

async function alphaMask(source: string | Buffer): Promise<Uint8Array> {
  const { data, info } = await sharp(source)
    .trim({ background: { alpha: 0, b: 0, g: 0, r: 0 } })
    .resize(RASTER_SIZE, RASTER_SIZE, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: "contain",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = data[index * info.channels + 3] ?? 0;
  }
  return alpha;
}

function silhouette(mask: Uint8Array): readonly boolean[] {
  return Array.from(mask, (alpha) => alpha > 16);
}

function filledPixels(mask: readonly boolean[]): number {
  return mask.filter(Boolean).length;
}

function intersectionOverUnion(
  left: readonly boolean[],
  right: readonly boolean[],
  offsetX = 0,
  offsetY = 0,
): number {
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < RASTER_SIZE; y += 1) {
    for (let x = 0; x < RASTER_SIZE; x += 1) {
      const leftPixel = left[y * RASTER_SIZE + x] ?? false;
      const rightX = x + offsetX;
      const rightY = y + offsetY;
      const rightPixel =
        rightX >= 0 &&
        rightX < RASTER_SIZE &&
        rightY >= 0 &&
        rightY < RASTER_SIZE
          ? (right[rightY * RASTER_SIZE + rightX] ?? false)
          : false;
      if (leftPixel && rightPixel) {
        intersection += 1;
      }
      if (leftPixel || rightPixel) {
        union += 1;
      }
    }
  }
  return union === 0 ? 1 : intersection / union;
}

function alignedIntersectionOverUnion(
  left: readonly boolean[],
  right: readonly boolean[],
): number {
  let best = 0;
  // Sharp and Excalidraw independently snap the same vector bounds to raster
  // pixels. Search a bounded two-pixel window so subpixel origin choices do
  // not masquerade as geometry loss while shape differences remain visible.
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      best = Math.max(
        best,
        intersectionOverUnion(left, right, offsetX, offsetY),
      );
    }
  }
  return best;
}

function hasPixelWithin(
  mask: readonly boolean[],
  x: number,
  y: number,
  radius: number,
): boolean {
  for (
    let candidateY = Math.max(0, y - radius);
    candidateY <= Math.min(RASTER_SIZE - 1, y + radius);
    candidateY += 1
  ) {
    for (
      let candidateX = Math.max(0, x - radius);
      candidateX <= Math.min(RASTER_SIZE - 1, x + radius);
      candidateX += 1
    ) {
      if (mask[candidateY * RASTER_SIZE + candidateX]) {
        return true;
      }
    }
  }
  return false;
}

function tolerantSilhouetteOverlap(
  left: readonly boolean[],
  right: readonly boolean[],
): number {
  let matched = 0;
  let pixels = 0;
  for (let y = 0; y < RASTER_SIZE; y += 1) {
    for (let x = 0; x < RASTER_SIZE; x += 1) {
      if (left[y * RASTER_SIZE + x]) {
        pixels += 1;
        if (hasPixelWithin(right, x, y, 2)) {
          matched += 1;
        }
      }
      if (right[y * RASTER_SIZE + x]) {
        pixels += 1;
        if (hasPixelWithin(left, x, y, 2)) {
          matched += 1;
        }
      }
    }
  }
  return pixels === 0 ? 1 : matched / pixels;
}

async function rendererReport() {
  const corpusRoot = resolve(
    process.cwd(),
    "apps/icons/public/output/upload-ready/svg",
  );
  const paths = readdirSync(corpusRoot, { recursive: true })
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.endsWith(".svg"),
    )
    .sort();
  const rows = [];
  const baselineBlockedRows: BlockedRow[] = [];
  const blockedRows: BlockedRow[] = [];

  for (const relativePath of paths) {
    const source = readFileSync(resolve(corpusRoot, relativePath), "utf8");
    const parsed = parseSvg(source, { sourceName: relativePath });
    if (!parsed.ok) {
      const row = {
        blockerCodes: sortedUnique(parsed.diagnostics.map(({ code }) => code)),
        conversionCodes: [],
        diagnostics: parsed.diagnostics,
        path: relativePath,
      };
      baselineBlockedRows.push(row);
      blockedRows.push(row);
      continue;
    }
    const converted = convertSvgToExcalidraw(parsed.document, {
      fillStyle: "solid",
      roughness: 0,
    });
    const blockingDiagnostics = converted.capability.diagnostics.filter(
      isBlockingSvgDiagnostic,
    );
    const baselineTopology = preDecompositionTopologyDiagnostic(
      parsed.document,
    );
    const baselineDiagnostics =
      baselineTopology &&
      !blockingDiagnostics.some(
        ({ code }) => code === "native-unsupported-topology",
      )
        ? [...blockingDiagnostics, baselineTopology]
        : blockingDiagnostics;
    const baselineBlockerCodes = sortedUnique(
      baselineDiagnostics.map(({ code }) => code),
    );
    if (baselineBlockerCodes.length > 0) {
      baselineBlockedRows.push({
        blockerCodes: baselineBlockerCodes,
        conversionCodes: converted.ok
          ? []
          : sortedUnique(converted.diagnostics.map(({ code }) => code)),
        diagnostics: baselineDiagnostics,
        path: relativePath,
      });
    }
    if (!converted.ok) {
      blockedRows.push({
        blockerCodes: sortedUnique(blockingDiagnostics.map(({ code }) => code)),
        conversionCodes: sortedUnique(
          converted.diagnostics.map(({ code }) => code),
        ),
        diagnostics: blockingDiagnostics,
        path: relativePath,
      });
      continue;
    }
    const restored = restoreElements(converted.elements, null, {
      refreshDimensions: false,
      repairBindings: false,
    });
    const exportPadding = Math.ceil(
      Math.max(1, ...restored.map((element) => element.strokeWidth)),
    );
    const nativeSvg = await exportToSvg({
      elements: restored,
      appState: {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
      },
      files: null,
      // Excalidraw element bounds exclude the outside half of a stroke. Without
      // padding, exportToSvg clips boundary strokes and produces a false
      // fidelity failure even though the editable scene geometry is correct.
      exportPadding,
      skipInliningFonts: true,
    });
    const masks = await Promise.all([
      alphaMask(Buffer.from(source)),
      alphaMask(Buffer.from(nativeSvg.outerHTML)),
    ]);
    const sourceMask = masks[0] ? silhouette(masks[0]) : undefined;
    const nativeMask = masks[1] ? silhouette(masks[1]) : undefined;
    if (!(sourceMask && nativeMask)) {
      throw new Error(`Missing raster mask for ${relativePath}`);
    }
    rows.push({
      path: relativePath,
      elements: converted.metrics.elements,
      points: converted.metrics.points,
      maxPointsPerElement: converted.metrics.maxPointsPerElement,
      iou: Number(
        alignedIntersectionOverUnion(sourceMask, nativeMask).toFixed(4),
      ),
      tolerantOverlap: Number(
        tolerantSilhouetteOverlap(sourceMask, nativeMask).toFixed(4),
      ),
      sourcePixels: filledPixels(sourceMask),
      nativePixels: filledPixels(nativeMask),
    });
  }

  const ious = rows.map((row) => row.iou).sort((left, right) => left - right);
  const tolerantOverlaps = rows
    .map((row) => row.tolerantOverlap)
    .sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    ious[Math.min(ious.length - 1, Math.floor(ious.length * fraction))] ?? 0;
  return {
    corpusFiles: paths.length,
    files: rows.length,
    blockedFiles: blockedRows.length,
    blockers: blockerSummary(blockedRows),
    coverage: {
      beforeDecomposition: {
        blockedFiles: baselineBlockedRows.length,
        nativeFiles: paths.length - baselineBlockedRows.length,
      },
      afterDecomposition: {
        blockedFiles: blockedRows.length,
        nativeFiles: rows.length,
      },
    },
    baselineBlockers: blockerSummary(baselineBlockedRows),
    rasterSize: RASTER_SIZE,
    meanIou: Number(
      (ious.reduce((total, value) => total + value, 0) / ious.length).toFixed(
        4,
      ),
    ),
    minIou: ious[0] ?? 0,
    minTolerantOverlap: tolerantOverlaps[0] ?? 0,
    p10Iou: percentile(0.1),
    p50Iou: percentile(0.5),
    p90Iou: percentile(0.9),
    below: {
      "0.50": ious.filter((iou) => iou < 0.5).length,
      "0.75": ious.filter((iou) => iou < 0.75).length,
      "0.90": ious.filter((iou) => iou < 0.9).length,
    },
    belowTolerant: {
      "0.90": tolerantOverlaps.filter((overlap) => overlap < 0.9).length,
      "0.95": tolerantOverlaps.filter((overlap) => overlap < 0.95).length,
    },
    rows,
  };
}

describe("full corpus Excalidraw renderer", () => {
  it("renders every native-capable icon and writes a CI-only report", async () => {
    const started = performance.now();
    const renderer = await rendererReport();
    const reportPath = resolve(
      process.cwd(),
      process.env.SVG_NATIVE_CORPUS_REPORT ??
        ".memory/svg-native-corpus/native-renderer.json",
    );
    mkdirSync(resolve(reportPath, ".."), { recursive: true });
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        { benchmarkMs: Math.round(performance.now() - started), renderer },
        null,
        2,
      )}\n`,
    );

    expect(renderer.files).toBeGreaterThan(0);
    expect(renderer.corpusFiles).toBe(1_412);
    expect(renderer.coverage.beforeDecomposition).toEqual({
      blockedFiles: 298,
      nativeFiles: 1_114,
    });
    expect(renderer.coverage.afterDecomposition).toEqual({
      blockedFiles: 85,
      nativeFiles: 1_327,
    });
    expect(renderer.files).toBeGreaterThanOrEqual(1_327);
    expect(renderer.blockedFiles).toBeLessThanOrEqual(85);
    expect(renderer.corpusFiles).toBe(renderer.files + renderer.blockedFiles);
    expect(renderer.rows).toHaveLength(renderer.files);
    expect(renderer.blockers.rows).toHaveLength(renderer.blockedFiles);
    expect(renderer.baselineBlockers.rows).toHaveLength(298);
    expect(
      renderer.blockers.rows.every((row) => row.blockerCodes.length > 0),
    ).toBe(true);
    expect(
      renderer.baselineBlockers.rows.every(
        (row) => row.blockerCodes.length > 0,
      ),
    ).toBe(true);
    expect(
      renderer.blockers.bySignature.reduce(
        (total, signature) => total + signature.count,
        0,
      ),
    ).toBe(renderer.blockedFiles);
    expect(
      renderer.baselineBlockers.bySignature.reduce(
        (total, signature) => total + signature.count,
        0,
      ),
    ).toBe(298);
    const rowsByPath = new Map(renderer.rows.map((row) => [row.path, row]));
    for (const path of [
      "ai-apps-agents/agentvoice.svg",
      "ai-ecosystem/perplexity.svg",
    ]) {
      expect(rowsByPath.get(path)?.tolerantOverlap).toBeGreaterThanOrEqual(
        0.99,
      );
    }
    expect(renderer.meanIou).toBeGreaterThanOrEqual(0.97);
    expect(renderer.p10Iou).toBeGreaterThanOrEqual(0.94);
    expect(renderer.minIou).toBeGreaterThanOrEqual(0.65);
    expect(renderer.minTolerantOverlap).toBeGreaterThanOrEqual(0.95);
    expect(renderer.belowTolerant["0.95"]).toBe(0);
  }, 600_000);
});
