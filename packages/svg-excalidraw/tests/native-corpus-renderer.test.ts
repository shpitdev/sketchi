import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { exportToSvg, restoreElements } from "@excalidraw/excalidraw";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { convertSvgToExcalidraw, parseSvg } from "../src";

const RASTER_SIZE = 128;

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

  for (const relativePath of paths) {
    const source = readFileSync(resolve(corpusRoot, relativePath), "utf8");
    const parsed = parseSvg(source, { sourceName: relativePath });
    if (!parsed.ok) {
      continue;
    }
    const converted = convertSvgToExcalidraw(parsed.document, {
      fillStyle: "solid",
      roughness: 0,
    });
    if (!converted.ok) {
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
    files: rows.length,
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
    expect(renderer.rows).toHaveLength(renderer.files);
    expect(renderer.meanIou).toBeGreaterThanOrEqual(0.97);
    expect(renderer.p10Iou).toBeGreaterThanOrEqual(0.94);
    expect(renderer.minIou).toBeGreaterThanOrEqual(0.65);
    expect(renderer.minTolerantOverlap).toBeGreaterThanOrEqual(0.95);
    expect(renderer.belowTolerant["0.95"]).toBe(0);
  }, 600_000);
});
