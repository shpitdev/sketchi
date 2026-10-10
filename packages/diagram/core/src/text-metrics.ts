/**
 * Deterministic label metrics shared by layout, validation, and the Excalidraw
 * adapter. Widths are integer hundredths of an em so wrapping never depends on
 * floating-point accumulation. The estimates are calibrated against Excalidraw's
 * own Excalifont/Xiaolai measurement in Chromium and err wide: an estimate below
 * the painted width clips glyphs, because Excalidraw draws bound text into a
 * canvas sized from the element's stored width.
 */

/**
 * Average Latin glyph advance: lowercase Excalifont paints at ~0.52em and
 * capitals at ~0.68em, so mixed text keeps headroom.
 */
export const DEFAULT_GLYPH_UNITS = 62;
/** CJK ideographs, kana, Hangul, and fullwidth forms paint at a full em. */
const WIDE_GLYPH_UNITS = 100;
/** Color emoji paint at ~1.25em in Chromium. */
const EMOJI_GLYPH_UNITS = 130;

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFE00-\uFE0F]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function glyphUnits(glyph: string): number {
  if (ZERO_WIDTH.test(glyph)) {
    return 0;
  }
  if (EMOJI.test(glyph)) {
    return EMOJI_GLYPH_UNITS;
  }
  return isWide(glyph.codePointAt(0) ?? 0)
    ? WIDE_GLYPH_UNITS
    : DEFAULT_GLYPH_UNITS;
}

/** Estimated advance of one line in hundredths of an em. */
export function textLineUnits(line: string): number {
  let units = 0;
  for (const glyph of line) {
    units += glyphUnits(glyph);
  }
  return units;
}

/** Estimated width in pixels of the widest line. */
export function estimateTextWidth(text: string, fontSize: number): number {
  const units = Math.max(...text.split("\n").map(textLineUnits));
  return (units * fontSize) / 100;
}

function splitLongWord(word: string, maxUnits: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentUnits = 0;
  for (const glyph of word) {
    const units = glyphUnits(glyph);
    if (current && currentUnits + units > maxUnits) {
      chunks.push(current);
      current = "";
      currentUnits = 0;
    }
    current += glyph;
    currentUnits += units;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function wrapLine(line: string, maxUnits: number): string[] {
  if (textLineUnits(line) <= maxUnits) {
    return [line];
  }

  const wrapped: string[] = [];
  let current = "";

  for (const word of line.split(" ")) {
    if (textLineUnits(word) > maxUnits) {
      if (current) {
        wrapped.push(current);
        current = "";
      }
      wrapped.push(...splitLongWord(word, maxUnits));
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (textLineUnits(candidate) <= maxUnits) {
      current = candidate;
      continue;
    }

    wrapped.push(current);
    current = word;
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped;
}

/**
 * Greedy word wrap at spaces; words wider than a line break between glyphs,
 * which is also the correct break opportunity for unspaced CJK text.
 */
export function wrapTextToUnits(text: string, maxUnits: number): string {
  return text
    .split("\n")
    .flatMap((line) => wrapLine(line, maxUnits))
    .join("\n");
}

export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
): string {
  return wrapTextToUnits(text, Math.floor((maxWidth * 100) / fontSize + 1e-6));
}
