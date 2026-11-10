import type { SketchiIcon } from "./manifest.js";

/** Largest catalog SVG accepted as an embedded diagram node logo. */
export const NODE_LOGO_MAX_BYTES = 64 * 1024;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_ROOT_TAG = /<svg\b[^>]*>/u;
const VIEW_BOX_ATTRIBUTE = /\sviewBox\s*=\s*(["'])([^"']*)\1/u;

/**
 * Node logos are compact brand marks. Wordmarks are unreadable at node scale,
 * and oversized sources would bloat every scene, drawing file, and PNG.
 */
export function isNodeLogoEligible(icon: Pick<SketchiIcon, "bytes" | "variant">): boolean {
	return icon.variant === undefined && icon.bytes <= NODE_LOGO_MAX_BYTES;
}

/** A wordmark a diagram may place as a standalone icon, never inside a node. */
export function isStandaloneWordmark(icon: Pick<SketchiIcon, "bytes" | "variant">): boolean {
	return icon.variant === "text" && icon.bytes <= NODE_LOGO_MAX_BYTES;
}

/**
 * Give a catalog SVG the intrinsic size image decoders need. Chrome sizes a
 * viewBox-only SVG image as 300x150, which distorts it when a canvas draws it
 * into a square node-logo box. This mirrors Excalidraw's own normalizeSVG.
 */
export function normalizeNodeLogoSvg(svg: string): string {
	const root = SVG_ROOT_TAG.exec(svg);
	if (!root) {
		throw new Error("Node logo source has no <svg> root element.");
	}
	const tag = root[0];
	const viewBox = VIEW_BOX_ATTRIBUTE.exec(tag)?.[2]
		?.trim()
		.split(/[\s,]+/u)
		.map(Number);
	if (
		!viewBox ||
		viewBox.length !== 4 ||
		viewBox.some((value) => !Number.isFinite(value)) ||
		!((viewBox[2] ?? 0) > 0 && (viewBox[3] ?? 0) > 0)
	) {
		throw new Error("Node logo source has no valid viewBox.");
	}
	const additions = [
		/\sxmlns\s*=/u.test(tag) ? "" : ` xmlns="${SVG_NAMESPACE}"`,
		/\swidth\s*=/u.test(tag) ? "" : ` width="${viewBox[2]}"`,
		/\sheight\s*=/u.test(tag) ? "" : ` height="${viewBox[3]}"`,
	].join("");
	if (!additions) return svg;
	const insertAt = root.index + 4;
	return `${svg.slice(0, insertAt)}${additions}${svg.slice(insertAt)}`;
}

/** The diagram ink a plate takes behind a mark lost on the paper. */
const NODE_LOGO_PLATE = "#1e1e1e";
const INVERT_FILTER_ID = "sketchi-node-logo-invert";

/**
 * A node logo ready for diagram paper, which is light. A mark lost on a light
 * surface is inverted (a neutral mark) or drawn on a dark plate (a
 * multicolor one) inside its own SVG. Excalidraw's dark theme inverts SVG
 * images with the canvas, so the same treatment keeps the mark visible there.
 */
export function nodeLogoSvgForPaper(svg: string, icon: Pick<SketchiIcon, "onLight">): string {
	const normalized = normalizeNodeLogoSvg(svg);
	if (!icon.onLight) return normalized;
	const root = SVG_ROOT_TAG.exec(normalized);
	const close = normalized.lastIndexOf("</svg>");
	const viewBox =
		root &&
		VIEW_BOX_ATTRIBUTE.exec(root[0])?.[2]
			?.trim()
			.split(/[\s,]+/u)
			.map(Number);
	if (!root || close < 0 || !viewBox) {
		throw new Error("Node logo source has no <svg> root element.");
	}
	const [minX = 0, minY = 0, width = 0, height = 0] = viewBox;
	const open = normalized.slice(0, root.index + root[0].length);
	const inner = normalized.slice(root.index + root[0].length, close);
	const tail = normalized.slice(close);
	if (icon.onLight === "plate") {
		const radius = Math.round(Math.min(width, height) * 0.18);
		return `${open}<rect x="${minX}" y="${minY}" width="${width}" height="${height}" rx="${radius}" fill="${NODE_LOGO_PLATE}"/>${inner}${tail}`;
	}
	return `${open}<filter id="${INVERT_FILTER_ID}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter><g filter="url(#${INVERT_FILTER_ID})">${inner}</g>${tail}`;
}
