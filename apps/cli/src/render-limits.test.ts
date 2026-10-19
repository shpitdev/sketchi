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

	it("measures unrotated elements by their own extent, and rotated ones by their radius", () => {
		// A tall Gantt gridline beside a wide axis: the drawing is 2,400 × 1,800.
		const tall = [
			{ x: 0, y: 0, width: 2_400, height: 0, angle: 0 },
			{ x: 1_200, y: 0, width: 0, height: 1_800, angle: 0 },
			// An elbow route's points stay inside the drawing even past its start-to-end box.
			{
				x: 100,
				y: 100,
				width: 10,
				height: 10,
				angle: 0,
				points: [
					[0, 0],
					[-90, 0],
					[-90, 10],
					[10, 10],
				],
			},
		];
		assert.isUndefined(renderLimitDiagnostic(tall));
		const rotated = renderLimitDiagnostic(tall.map((element) => ({ ...element, angle: 0.3 })));
		assert.strictEqual(rotated?.code, "canvas_area");
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
