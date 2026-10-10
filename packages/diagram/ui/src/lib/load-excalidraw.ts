declare global {
	interface Window {
		EXCALIDRAW_ASSET_PATH?: string | string[];
	}
}

/**
 * Excalidraw resolves its font files against this path and only falls back to
 * the esm.sh CDN when they fail to load. Every surface that renders Excalidraw
 * serves them from its own origin at `/fonts/<Family>/<file>` through the
 * `excalidrawFonts` Vite plugin (scripts/lib/excalidraw-fonts.mjs).
 */
export const EXCALIDRAW_ASSET_PATH = "/";

/**
 * Loads Excalidraw with self-hosted assets. Font faces are registered on first
 * use, so the asset path must be set before the module is first imported.
 */
export function loadExcalidraw(): Promise<typeof import("@excalidraw/excalidraw")> {
	window.EXCALIDRAW_ASSET_PATH ??= EXCALIDRAW_ASSET_PATH;
	return import("@excalidraw/excalidraw");
}
