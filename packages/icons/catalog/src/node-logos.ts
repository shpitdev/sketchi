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
export function isNodeLogoEligible(
  icon: Pick<SketchiIcon, "bytes" | "variant">,
): boolean {
  return icon.variant === undefined && icon.bytes <= NODE_LOGO_MAX_BYTES;
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
