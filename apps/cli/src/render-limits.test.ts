import { assert, describe, it } from "@effect/vitest";

import {
  MAX_RENDER_CANVAS_AREA,
  MAX_RENDER_OUTPUT_PIXELS,
  MAX_RENDER_FILE_BYTES,
  PNG_EXPORT_SCALE,
  adaptivePngExportScale,
  renderFilesDiagnostic,
  renderLimitDiagnostic,
} from "./render-limits.js";

describe("PNG render limits", () => {
  it("admits bounded production-sized geometry after the documented increase", () => {
    const failure = renderLimitDiagnostic([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 1_700, y: 2_600, width: 100, height: 100 },
    ]);
    assert.isUndefined(failure);
    assert.strictEqual(MAX_RENDER_CANVAS_AREA, 6_291_456);
  });

  it("reduces export scale to keep raster allocation bounded", () => {
    const scale = adaptivePngExportScale(2_000, 4_000);
    assert.isNumber(scale);
    if (typeof scale !== "number") return;
    assert.isBelow(scale, PNG_EXPORT_SCALE);
    assert.isAtLeast(scale, 1);
    assert.isAtMost(2_000 * scale * (4_000 * scale), MAX_RENDER_OUTPUT_PIXELS);
  });

  it("counts only files that live image elements reference", () => {
    const large = { dataURL: "x".repeat(MAX_RENDER_FILE_BYTES + 1) };
    const files = { live: { dataURL: "small" }, orphan: large, gone: large };
    const elements = [
      { type: "image", fileId: "live" },
      { type: "image", fileId: "gone", isDeleted: true },
      { type: "image", fileId: "constructor" },
    ];
    assert.isUndefined(renderFilesDiagnostic(files, elements));

    const failure = renderFilesDiagnostic(files, [
      ...elements,
      { type: "image", fileId: "orphan" },
    ]);
    assert.strictEqual(failure?.code, "file_bytes");
  });

  it("fails closed when the minimum-scale allocation remains too large", () => {
    const failure = adaptivePngExportScale(6_000, 6_000);
    assert.isNotNumber(failure);
    if (typeof failure === "number") return;
    assert.strictEqual(failure.code, "output_pixels");
  });
});
