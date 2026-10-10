export interface PngExportOptions {
	backgroundColor: string;
	padding: number;
	scale: number;
}

interface ExcalidrawExportScene {
	appState?: Record<string, unknown>;
	elements?: unknown[];
	files?: Record<string, unknown>;
}

type ExportToBlob = (typeof import("@excalidraw/excalidraw"))["exportToBlob"];

/** Chrome canvas ceilings: per-side length and total pixels. */
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 64_000_000;

/**
 * exportToBlob ignores appState.exportScale unless maxWidthOrHeight is set, so
 * the scale is applied here, reduced only as far as the canvas ceilings need.
 */
export function exportDimensions(
	width: number,
	height: number,
	requestedScale: number,
): { readonly height: number; readonly scale: number; readonly width: number } {
	const scale = Math.min(
		requestedScale,
		MAX_CANVAS_SIDE / Math.max(width, height, 1),
		Math.sqrt(MAX_CANVAS_PIXELS / Math.max(width * height, 1)),
	);
	return {
		width: Math.floor(width * scale),
		height: Math.floor(height * scale),
		scale,
	};
}

function isExportScene(value: unknown): value is ExcalidrawExportScene {
	return Boolean(value) && typeof value === "object";
}

/**
 * Rasterize an Excalidraw scene to a base64 PNG with Excalidraw's own export.
 * Files are forwarded so node logos and other images paint; exportToBlob waits
 * for every image to decode before drawing.
 */
export async function exportExcalidrawPngBase64(
	exportToBlob: ExportToBlob,
	scene: unknown,
	options: PngExportOptions,
): Promise<string> {
	const exportScene = isExportScene(scene) ? scene : {};
	const appState = exportScene.appState ?? {};
	const backgroundColor =
		options.backgroundColor ??
		(typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : "#ffffff");

	const blob = await exportToBlob({
		elements: (Array.isArray(exportScene.elements)
			? exportScene.elements
			: []) as Parameters<ExportToBlob>[0]["elements"],
		appState: {
			...appState,
			exportBackground: true,
			exportScale: options.scale,
			viewBackgroundColor: backgroundColor,
		},
		exportPadding: options.padding,
		files: (exportScene.files ?? null) as Parameters<ExportToBlob>[0]["files"],
		getDimensions: (width: number, height: number) =>
			exportDimensions(width, height, options.scale),
		mimeType: "image/png",
	});

	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let index = 0; index < bytes.byteLength; index += 1) {
		binary += String.fromCharCode(bytes[index] ?? 0);
	}
	return btoa(binary);
}
