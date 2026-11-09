import type { MarkFeatures } from "@sketchi/icon-catalog";
import { Context, type Effect } from "effect";

import type { IconImagingError } from "./errors.js";
import type { IconSource } from "./input.js";
import type { IconScene } from "./scenes.js";

/** Draw a logo square on white paper, trimmed to its ink, and measure it. */
export interface IconImagePrepare {
	readonly id: string;
	readonly source: IconSource;
	/** Side of the square PNG, in pixels. */
	readonly size: number;
	/** Snap every pixel to the mark's palette, so compression noise and blends do not read as colors. */
	readonly quantize: boolean;
}

/** Export an Excalidraw scene to PNG with Excalidraw's own renderer. */
export interface IconImageExport {
	readonly id: string;
	readonly scene: IconScene;
	readonly padding: number;
	readonly scale: number;
}

export interface IconImagingJob {
	readonly prepare: readonly IconImagePrepare[];
	readonly exports: readonly IconImageExport[];
}

export interface PreparedIconImage {
	/** Base64 PNG. */
	readonly png: string;
	/** Measured on the untrimmed drawing at the catalog's look-alike size. */
	readonly features: MarkFeatures;
}

export interface IconImagingResult {
	/** Base64 PNGs by export id. */
	readonly exported: Readonly<Record<string, string>>;
	/** Prepared images by id; an id is missing when its image drew nothing. */
	readonly prepared: Readonly<Record<string, PreparedIconImage>>;
}

/**
 * Raster work the service cannot do in a Worker: decoding logos, measuring
 * their pixels and exporting Excalidraw scenes. Studio runs it in Browser
 * Rendering; tests provide their own.
 */
export class IconImaging extends Context.Service<
	IconImaging,
	{
		readonly run: (job: IconImagingJob) => Effect.Effect<IconImagingResult, IconImagingError>;
	}
>()("@sketchi/icon-draw/IconImaging") {}
