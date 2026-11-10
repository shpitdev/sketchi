import {
	inkBox,
	markFeatures,
	sanitizeSvg,
	squareAround,
	type SvgViewBox,
} from "@sketchi/icon-catalog";
import {
	IconImaging,
	IconImagingError,
	type IconImagePrepare,
	type IconImagingJob,
	type IconImagingResult,
	type PreparedIconImage,
} from "@sketchi/icon-draw";
import { Resvg } from "@resvg/resvg-wasm";
import { Effect, Layer } from "effect";

import { exportScenePng, initializeResvg } from "./excalidraw-export.js";

/**
 * The draw service's raster work in Node: the steps of Studio's harness page
 * (apps/playground/src/features/icons/icon-job.ts) with resvg in place of a
 * browser canvas. resvg is also what measured the catalog's look-alike
 * features, so a mark's features here match its look-alike entry.
 */

/** Must match the catalog's look-alike render size. */
const MEASURE_SIZE = 256;
/** White space around the trimmed mark, as a share of its longer side. */
const MARGIN = 0.08;
const PAPER = "#ffffff";

const ROOT_TAG = /<svg\b[^>]*>/u;
const SIZING_ATTRIBUTES = /\s(?:viewBox|width|height|preserveAspectRatio)\s*=\s*(["'])[^"']*\1/gu;

/** The same drawing framed on `box` (in its own units) and drawn `size` px square. */
export function reframeSvg(svg: string, box: SvgViewBox, size: number): string {
	return svg.replace(ROOT_TAG, (tag) => {
		const stripped = tag.replace(SIZING_ATTRIBUTES, "");
		const attributes = ` viewBox="${box.minX} ${box.minY} ${box.width} ${box.height}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"`;
		return `${stripped.slice(0, -1).replace(/\/$/u, "")}${attributes}>`;
	});
}

function render(svg: string, fit: { readonly mode: "width" | "height"; readonly value: number }) {
	const rasterizer = new Resvg(svg, { background: PAPER, fitTo: fit });
	try {
		const image = rasterizer.render();
		try {
			return {
				pixels: Uint8Array.from(image.pixels),
				width: image.width,
				height: image.height,
				png: Uint8Array.from(image.asPng()),
			};
		} finally {
			image.free();
		}
	} finally {
		rasterizer.free();
	}
}

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

/** Measure a logo on paper, then draw it trimmed to its ink and square. Undefined when it draws nothing. */
export function prepareSvg(item: IconImagePrepare): PreparedIconImage | undefined {
	if (item.source.kind !== "svg") {
		throw new Error("The batch draws catalog SVGs only.");
	}
	const sanitized = sanitizeSvg(item.source.svg);
	if (!sanitized.ok) throw new Error(sanitized.message);
	const { svg, viewBox } = sanitized.value;
	const measured = render(svg, {
		mode: viewBox.width >= viewBox.height ? "width" : "height",
		value: MEASURE_SIZE,
	});
	const pixels = { data: measured.pixels, width: measured.width, height: measured.height };
	const features = markFeatures(pixels);
	const box = inkBox(pixels);
	if (!features || !box) return undefined;
	const square = squareAround(box, MARGIN);
	const unitsPerPixel = viewBox.width / measured.width;
	const framed = reframeSvg(
		svg,
		{
			minX: viewBox.minX + square.x * unitsPerPixel,
			minY: viewBox.minY + square.y * unitsPerPixel,
			width: square.width * unitsPerPixel,
			height: square.height * unitsPerPixel,
		},
		item.size,
	);
	const out = render(framed, { mode: "width", value: item.size });
	return { png: base64(out.png), features };
}

export async function runImagingJob(job: IconImagingJob): Promise<IconImagingResult> {
	await initializeResvg();
	const prepared: Record<string, PreparedIconImage> = {};
	for (const item of job.prepare) {
		const image = prepareSvg(item);
		if (image) prepared[item.id] = image;
	}
	const exported: Record<string, string> = {};
	for (const item of job.exports) {
		exported[item.id] = base64(
			await exportScenePng(item.scene, {
				backgroundColor: PAPER,
				padding: item.padding,
				scale: item.scale,
			}),
		);
	}
	return { prepared, exported };
}

/** `IconImaging` in this process. */
export const NodeIconImaging = Layer.succeed(IconImaging, {
	run: (job: IconImagingJob) =>
		Effect.tryPromise({
			try: () => runImagingJob(job),
			catch: (cause) =>
				IconImagingError.make({
					cause,
					message: cause instanceof Error ? cause.message : "Imaging failed.",
					stage: job.exports.length > 0 ? "export" : "prepare",
				}),
		}),
});
