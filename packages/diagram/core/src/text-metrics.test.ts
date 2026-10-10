import { describe, expect, it } from "vitest";

import {
  DEFAULT_GLYPH_UNITS,
  estimateTextWidth,
  textLineUnits,
  wrapTextToUnits,
  wrapTextToWidth,
} from "./text-metrics";

const EIGHTEEN_GLYPHS = 18 * DEFAULT_GLYPH_UNITS;

describe("label text metrics", () => {
  it("weights glyphs by the width Excalidraw paints them at", () => {
    expect(textLineUnits("review")).toBe(6 * 62);
    expect(textLineUnits("QA")).toBe(2 * 62);
    expect(textLineUnits("品質")).toBe(2 * 100);
    expect(textLineUnits("한글")).toBe(2 * 100);
    // One astral emoji is one glyph, and its variation selector is zero-width.
    expect(textLineUnits("🚀")).toBe(130);
    expect(textLineUnits("❤️")).toBe(130);
    expect(estimateTextWidth("ab\n品質保証", 10)).toBe(40);
  });

  it("wraps lowercase Latin at eighteen glyphs per line", () => {
    expect(
      wrapTextToUnits(
        "review the certificate of analysis and record deviations",
        EIGHTEEN_GLYPHS,
      ),
    ).toBe("review the\ncertificate of\nanalysis and\nrecord deviations");
    expect(
      wrapTextToUnits("supercalifragilisticexpialidocious", EIGHTEEN_GLYPHS),
    ).toBe("supercalifragilist\nicexpialidocious");
  });

  it("breaks unspaced CJK between glyphs and keeps authored line breaks", () => {
    expect(wrapTextToUnits("品質保証レビュー承認待ち", 1000)).toBe(
      "品質保証レビュー承認\n待ち",
    );
    expect(wrapTextToUnits("one\ntwo", EIGHTEEN_GLYPHS)).toBe("one\ntwo");
  });

  it("never splits a surrogate pair", () => {
    expect(wrapTextToUnits("🚀🚀🚀", 200).split("\n")).toEqual([
      "🚀",
      "🚀",
      "🚀",
    ]);
  });

  it("converts a pixel width to whole units without floating-point drift", () => {
    const line = "a".repeat(18);
    expect(wrapTextToWidth(line, 18 * 0.62 * 14, 14)).toBe(line);
  });
});
