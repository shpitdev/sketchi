const rootSvgOpenPattern = /<\s*svg[\s>]/i;
const rootSvgClosePattern = /<\s*\/\s*svg\s*>/i;
const invalidTagPattern = /<\s*(script|foreignobject)\b/i;
const externalRefPattern =
  /(?:xlink:href|href)\s*=\s*["']\s*(?:https?:|data:|\/\/)/i;
const externalUrlPattern = /url\(\s*["']?\s*(?:https?:|data:|\/\/)/i;

export const MAX_SVG_BYTES = 256 * 1024;

export const validateSvgText = (svgText: string) => {
  if (
    !(rootSvgOpenPattern.test(svgText) && rootSvgClosePattern.test(svgText))
  ) {
    throw new Error("Invalid SVG: missing <svg> root element.");
  }
  if (invalidTagPattern.test(svgText)) {
    throw new Error("Invalid SVG: disallowed tags detected.");
  }
  if (externalRefPattern.test(svgText) || externalUrlPattern.test(svgText)) {
    throw new Error("Invalid SVG: external references are not allowed.");
  }
};
