import { hexRgb, inkBox, markFeatures, type MarkPixels, squareAround } from "@sketchi/icon-catalog";
import type {
	IconImagePrepare,
	IconImagingJob,
	IconImagingResult,
	IconSource,
	PreparedIconImage,
} from "@sketchi/icon-draw";

/**
 * The icon draw service's raster work, run in the export harness page: decode
 * a logo, measure it on white paper the way the catalog measures its marks,
 * and draw it trimmed and square; then export the round's Excalidraw scenes.
 */

/** Must match the catalog's look-alike render size, so features compare like for like. */
const MEASURE_SIZE = 256;
/** White space around the trimmed mark, as a share of its longer side. */
const MARGIN = 0.08;

export type IconScenePngExport = (
	scene: unknown,
	options: { backgroundColor: string; padding: number; scale: number },
) => Promise<string>;

function utf8Base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function decode(source: IconSource): Promise<HTMLImageElement> {
	const image = new Image();
	image.decoding = "async";
	image.src =
		source.kind === "svg"
			? `data:image/svg+xml;base64,${utf8Base64(source.svg)}`
			: `data:${source.mimeType};base64,${source.base64}`;
	await image.decode();
	return image;
}

function paper(width: number, height: number) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Canvas 2D is unavailable.");
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, width, height);
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	return { canvas, context };
}

function pixelsOf(context: CanvasRenderingContext2D, width: number, height: number): MarkPixels {
	const data = context.getImageData(0, 0, width, height);
	return { data: data.data, width, height };
}

/** Snap every pixel to the nearest palette color or paper. */
function quantize(context: CanvasRenderingContext2D, size: number, palette: readonly string[]) {
	const colors = [...palette.map(hexRgb), [255, 255, 255] as const];
	const image = context.getImageData(0, 0, size, size);
	const { data } = image;
	for (let offset = 0; offset < data.length; offset += 4) {
		let best = colors[0] ?? ([255, 255, 255] as const);
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const color of colors) {
			const distance =
				((data[offset] ?? 0) - color[0]) ** 2 +
				((data[offset + 1] ?? 0) - color[1]) ** 2 +
				((data[offset + 2] ?? 0) - color[2]) ** 2;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = color;
			}
		}
		data[offset] = best[0];
		data[offset + 1] = best[1];
		data[offset + 2] = best[2];
		data[offset + 3] = 255;
	}
	context.putImageData(image, 0, 0);
}

async function prepare(item: IconImagePrepare): Promise<PreparedIconImage | undefined> {
	const image = await decode(item.source);
	const naturalWidth = image.naturalWidth || MEASURE_SIZE;
	const naturalHeight = image.naturalHeight || MEASURE_SIZE;
	const fit = MEASURE_SIZE / Math.max(naturalWidth, naturalHeight);
	const width = Math.max(1, Math.round(naturalWidth * fit));
	const height = Math.max(1, Math.round(naturalHeight * fit));
	const measured = paper(width, height);
	measured.context.drawImage(image, 0, 0, width, height);
	const pixels = pixelsOf(measured.context, width, height);
	const features = markFeatures(pixels);
	const box = inkBox(pixels);
	if (!features || !box) return undefined;

	// Draw the whole logo scaled so its trimmed square fills the output; an SVG
	// rasterizes at that scale rather than being cropped from a small bitmap.
	const square = squareAround(box, MARGIN);
	const scale = item.size / square.width;
	const out = paper(item.size, item.size);
	out.context.drawImage(image, -square.x * scale, -square.y * scale, width * scale, height * scale);
	if (item.quantize) {
		quantize(
			out.context,
			item.size,
			features.palette.map(([color]) => color),
		);
	}
	const png = out.canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
	return { png, features };
}

export async function runIconImagingJob(
	job: IconImagingJob,
	exportPng: IconScenePngExport,
): Promise<IconImagingResult> {
	const prepared: Record<string, PreparedIconImage> = {};
	for (const item of job.prepare) {
		const image = await prepare(item);
		if (image) prepared[item.id] = image;
	}
	const exported: Record<string, string> = {};
	for (const item of job.exports) {
		exported[item.id] = await exportPng(item.scene, {
			backgroundColor: "#ffffff",
			padding: item.padding,
			scale: item.scale,
		});
	}
	return { prepared, exported };
}
