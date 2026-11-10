import { sanitizeSvg, SVG_INPUT_MAX_BYTES } from "@sketchi/icon-catalog";
import { Effect, Result, Schema } from "effect";

import { IconInputError } from "./errors.js";

export const ICON_NAME_MAX_LENGTH = 48;
/** Largest decoded raster accepted. */
export const ICON_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ICON_IMAGE_MAX_SIDE = 4096;
export const ICON_IMAGE_MIN_SIDE = 16;
/** A request carries one SVG or one base64 raster; this bounds the JSON around it. */
export const ICON_DRAW_REQUEST_MAX_BYTES = Math.ceil((ICON_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024;

export const IconDrawRequestSchema = Schema.Struct({
	name: Schema.String,
	svg: Schema.optional(Schema.String),
	/** A PNG, JPEG or WebP file as base64, or as a `data:` URL. */
	image: Schema.optional(Schema.String),
	/** The author model; omitted uses the service default. */
	model: Schema.optional(Schema.String),
});
export interface IconDrawRequest extends Schema.Schema.Type<typeof IconDrawRequestSchema> {}

export type RasterMimeType = "image/png" | "image/jpeg" | "image/webp";

/** What the caller handed over, made safe and measured. */
export type IconSource =
	| {
			readonly kind: "svg";
			readonly svg: string;
			/** Exact `#rrggbb` paints of the drawing, most used first. */
			readonly colors: readonly string[];
	  }
	| {
			readonly kind: "raster";
			readonly mimeType: RasterMimeType;
			readonly base64: string;
			readonly width: number;
			readonly height: number;
	  };

export interface IconDrawInput {
	readonly name: string;
	readonly source: IconSource;
}

const PATH_DATA = /\sd="([^"]*)"/gu;
/** A path command and its arguments; `e` is not a command, so an exponent stays in its number. */
const PATH_COMMAND = /([mzlhvcsqta])([^mzlhvcsqta]*)/giu;
const PATH_NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu;
/** Numbers each curve command takes; a command repeats for every further set. */
const CURVE_ARITY: Readonly<Record<string, number>> = { c: 6, s: 4, q: 4, t: 2, a: 7 };

/**
 * Curve segments in an SVG's path data, each repeat of a command counted: how
 * much of a mark is drawn freehand. Geometric marks need a few; an animal, a
 * face or a detailed emblem needs dozens.
 */
export function svgCurveSegments(svg: string): number {
	let segments = 0;
	for (const [, data = ""] of svg.matchAll(PATH_DATA)) {
		for (const [, command = "", args = ""] of data.matchAll(PATH_COMMAND)) {
			const arity = CURVE_ARITY[command.toLowerCase()];
			if (arity)
				segments += Math.max(1, Math.floor((args.match(PATH_NUMBER)?.length ?? 0) / arity));
		}
	}
	return segments;
}

function inputError(code: string, message: string, hint: string) {
	return IconInputError.make({ code, message, hint });
}

function decodeBase64(value: string): Uint8Array | undefined {
	try {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return bytes;
	} catch {
		return undefined;
	}
}

function uint16(bytes: Uint8Array, offset: number, littleEndian = false): number {
	const first = bytes[offset] ?? 0;
	const second = bytes[offset + 1] ?? 0;
	return littleEndian ? first | (second << 8) : (first << 8) | second;
}

function uint24le(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function uint32(bytes: Uint8Array, offset: number): number {
	return (
		(((bytes[offset] ?? 0) << 24) |
			((bytes[offset + 1] ?? 0) << 16) |
			((bytes[offset + 2] ?? 0) << 8) |
			(bytes[offset + 3] ?? 0)) >>>
		0
	);
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
	String.fromCharCode(...bytes.subarray(offset, offset + length));

/** The file type and pixel size from a raster's header, without decoding it. */
export function rasterHeader(
	bytes: Uint8Array,
):
	| { readonly mimeType: RasterMimeType; readonly width: number; readonly height: number }
	| undefined {
	if (bytes.length >= 24 && uint32(bytes, 0) === 0x89504e47 && ascii(bytes, 12, 4) === "IHDR") {
		return { mimeType: "image/png", width: uint32(bytes, 16), height: uint32(bytes, 20) };
	}
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) return undefined;
			const marker = bytes[offset + 1] ?? 0;
			const length = uint16(bytes, offset + 2);
			const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
			if (isFrame) {
				return {
					mimeType: "image/jpeg",
					height: uint16(bytes, offset + 5),
					width: uint16(bytes, offset + 7),
				};
			}
			offset += 2 + length;
		}
		return undefined;
	}
	if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
		const chunk = ascii(bytes, 12, 4);
		if (chunk === "VP8 ") {
			return {
				mimeType: "image/webp",
				width: uint16(bytes, 26, true) & 0x3fff,
				height: uint16(bytes, 28, true) & 0x3fff,
			};
		}
		if (chunk === "VP8L") {
			const bits =
				(bytes[21] ?? 0) |
				((bytes[22] ?? 0) << 8) |
				((bytes[23] ?? 0) << 16) |
				((bytes[24] ?? 0) << 24);
			return {
				mimeType: "image/webp",
				width: (bits & 0x3fff) + 1,
				height: ((bits >>> 14) & 0x3fff) + 1,
			};
		}
		if (chunk === "VP8X") {
			return {
				mimeType: "image/webp",
				width: uint24le(bytes, 24) + 1,
				height: uint24le(bytes, 27) + 1,
			};
		}
	}
	return undefined;
}

const DATA_URL = /^data:([\w/+.-]+)?(;[\w=-]+)*;base64,/iu;

/** Check a draw request and turn its logo into a safe, measured source. */
export const prepareIconInput = Effect.fn("iconDraw.prepareInput")(function* (request: unknown) {
	const decoded = Schema.decodeUnknownResult(IconDrawRequestSchema)(request);
	if (Result.isFailure(decoded)) {
		return yield* inputError(
			"invalid_request",
			"The request must be a JSON object with a name and an svg or image.",
			'Send { "name": "Acme", "svg": "<svg ...>" } or { "name": "Acme", "image": "<base64 PNG>" }.',
		);
	}
	const { name: rawName, svg, image } = decoded.success;
	const name = rawName.trim().replace(/\s+/gu, " ");
	if (!name || name.length > ICON_NAME_MAX_LENGTH) {
		return yield* inputError(
			"invalid_name",
			`The name must be 1-${ICON_NAME_MAX_LENGTH} characters.`,
			"Send the brand or product name the logo belongs to.",
		);
	}
	if ((svg === undefined) === (image === undefined)) {
		return yield* inputError(
			"one_source_required",
			"Send exactly one of svg or image.",
			"Put SVG markup in svg, or a base64 PNG, JPEG or WebP in image.",
		);
	}
	if (svg !== undefined) {
		const sanitized = sanitizeSvg(svg);
		if (!sanitized.ok) {
			return yield* inputError(
				sanitized.issue,
				sanitized.message,
				sanitized.issue === "svg_too_large"
					? `Send an SVG under ${SVG_INPUT_MAX_BYTES / 1024} KB, or a PNG of it.`
					: "Send the logo as a standalone SVG file, or as a PNG.",
			);
		}
		return {
			name,
			source: { kind: "svg", svg: sanitized.value.svg, colors: sanitized.value.colors },
		} satisfies IconDrawInput;
	}
	const base64 = (image ?? "").replace(DATA_URL, "").replace(/\s+/gu, "");
	const bytes = decodeBase64(base64);
	if (!bytes || bytes.length === 0) {
		return yield* inputError(
			"invalid_image",
			"The image is not valid base64.",
			"Send the file's bytes as base64, or as a data: URL.",
		);
	}
	if (bytes.length > ICON_IMAGE_MAX_BYTES) {
		return yield* inputError(
			"image_too_large",
			`The image exceeds ${ICON_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`,
			"Send a smaller export of the logo; 512 px is plenty.",
		);
	}
	const header = rasterHeader(bytes);
	if (!header) {
		return yield* inputError(
			"unsupported_image",
			"The image is not a PNG, JPEG or WebP file.",
			"Send a PNG, JPEG or WebP, or the SVG itself.",
		);
	}
	const { width, height } = header;
	if (
		Math.max(width, height) > ICON_IMAGE_MAX_SIDE ||
		Math.min(width, height) < ICON_IMAGE_MIN_SIDE
	) {
		return yield* inputError(
			"image_size",
			`The image must be ${ICON_IMAGE_MIN_SIDE}-${ICON_IMAGE_MAX_SIDE} px on each side; it is ${width}x${height}.`,
			"Send an export of the logo between 64 and 1024 px.",
		);
	}
	return {
		name,
		source: { kind: "raster", mimeType: header.mimeType, base64, width, height },
	} satisfies IconDrawInput;
});
